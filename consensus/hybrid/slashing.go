// Copyright 2024 The Altcoinchain Authors
// This file is part of the go-altcoinchain library.

package hybrid

import (
	"strconv"
	"sync"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/log"
	lru "github.com/hashicorp/golang-lru"
)

// SlashingReason describes why a validator should be slashed.
type SlashingReason string

const (
	// SlashDoubleAttestation is when a validator attests to two different blocks at the same height
	SlashDoubleAttestation SlashingReason = "double_attestation"
	// SlashSurroundVoting is when a validator's attestation surrounds another
	SlashSurroundVoting SlashingReason = "surround_voting"
	// SlashOffline is when a validator has been offline for too long
	SlashOffline SlashingReason = "offline"
)

// SlashableOffense represents a detected slashable offense.
type SlashableOffense struct {
	Validator     common.Address
	Reason        SlashingReason
	Evidence      []byte // Encoded evidence (e.g., two conflicting attestations)
	BlockNumber   uint64
	DetectedBlock uint64
	// First and Second are the two conflicting signed attestations that prove a
	// double-sign. They are the payload an honest node submits to the staking
	// contract's slashWithEvidence for on-chain, deterministic enforcement.
	First  *Attestation
	Second *Attestation
}

// SlashingDetector detects slashable offenses by validators.
type SlashingDetector struct {
	hybrid *Hybrid

	// Track attestations by validator: validator -> blockNumber -> blockHash
	validatorAttestations *lru.Cache

	// Track detected offenses
	pendingSlashes []SlashableOffense

	// Offline tracking: validator -> last seen block
	lastSeen map[common.Address]uint64

	// Configuration
	offlineThreshold uint64 // Blocks before considered offline

	log log.Logger
	mu  sync.RWMutex
}

// NewSlashingDetector creates a new slashing detector.
func NewSlashingDetector(hybrid *Hybrid) *SlashingDetector {
	attestations, _ := lru.New(10000)
	return &SlashingDetector{
		hybrid:                hybrid,
		validatorAttestations: attestations,
		pendingSlashes:        make([]SlashableOffense, 0),
		lastSeen:              make(map[common.Address]uint64),
		offlineThreshold:      1000, // ~4 hours at 15s blocks
		log:                   log.New("module", "slashing"),
	}
}

// CheckAttestation checks if an attestation is slashable.
// Returns a SlashableOffense if slashable, nil otherwise.
func (sd *SlashingDetector) CheckAttestation(attestation *Attestation) *SlashableOffense {
	sd.mu.Lock()
	defer sd.mu.Unlock()

	validator := attestation.Validator
	blockNumber := attestation.BlockNumber
	blockHash := attestation.BlockHash

	// Update last seen
	sd.lastSeen[validator] = blockNumber

	// Get validator's attestation history
	key := attestationKey(validator, blockNumber)

	if existing, ok := sd.validatorAttestations.Get(key); ok {
		prev := existing.(*Attestation)
		// Double attestation check: same block number, different hash
		if prev.BlockHash != blockHash {
			offense := &SlashableOffense{
				Validator:     validator,
				Reason:        SlashDoubleAttestation,
				BlockNumber:   blockNumber,
				DetectedBlock: blockNumber,
				First:         prev,
				Second:        attestation,
			}

			sd.log.Warn("Double attestation detected",
				"validator", validator.Hex(),
				"blockNumber", blockNumber,
				"hash1", prev.BlockHash.Hex(),
				"hash2", blockHash.Hex(),
			)

			sd.pendingSlashes = append(sd.pendingSlashes, *offense)
			return offense
		}
	}

	// Store this full attestation (signature retained so a later conflicting
	// attestation yields a complete, submittable evidence pair).
	sd.validatorAttestations.Add(key, attestation)

	// Check for surround voting (simplified check)
	if offense := sd.checkSurroundVoting(attestation); offense != nil {
		sd.pendingSlashes = append(sd.pendingSlashes, *offense)
		return offense
	}

	return nil
}

// checkSurroundVoting checks for surround voting offense.
// Surround voting occurs when an attestation's source/target range
// surrounds or is surrounded by another attestation from the same validator.
func (sd *SlashingDetector) checkSurroundVoting(attestation *Attestation) *SlashableOffense {
	// Simplified implementation: In a full implementation, we'd track
	// source and target epochs for each attestation and check for
	// surround voting conditions.
	//
	// For now, we just do basic double-voting detection.
	// Full surround voting detection would require:
	// 1. Track source epoch for each attestation
	// 2. Check if new attestation surrounds any previous one
	// 3. Check if new attestation is surrounded by any previous one

	return nil
}

// CheckOfflineValidators checks for validators that have been offline too long.
func (sd *SlashingDetector) CheckOfflineValidators(currentBlock uint64) []SlashableOffense {
	sd.mu.Lock()
	defer sd.mu.Unlock()

	var offenses []SlashableOffense

	validators := sd.hybrid.GetValidators()
	for addr, info := range validators {
		if !info.Active {
			continue
		}

		lastSeen, exists := sd.lastSeen[addr]
		if !exists {
			// Never seen, use activation block if known
			lastSeen = info.LastAttestation
		}

		if currentBlock-lastSeen > sd.offlineThreshold {
			offense := SlashableOffense{
				Validator:     addr,
				Reason:        SlashOffline,
				BlockNumber:   lastSeen,
				DetectedBlock: currentBlock,
			}

			sd.log.Warn("Offline validator detected",
				"validator", addr.Hex(),
				"lastSeen", lastSeen,
				"currentBlock", currentBlock,
				"blocksOffline", currentBlock-lastSeen,
			)

			offenses = append(offenses, offense)
		}
	}

	return offenses
}

// GetPendingSlashes returns pending slashing offenses.
func (sd *SlashingDetector) GetPendingSlashes() []SlashableOffense {
	sd.mu.RLock()
	defer sd.mu.RUnlock()

	result := make([]SlashableOffense, len(sd.pendingSlashes))
	copy(result, sd.pendingSlashes)
	return result
}

// DrainPendingSlashes returns and clears the engine's detected offenses. The
// node-side slash submitter calls this and forwards each offense's evidence to
// the staking contract's slashWithEvidence. This is off-consensus (a normal
// transaction), so multiple nodes submitting the same evidence is harmless —
// the contract's already-slashed guard makes duplicates revert.
func (h *Hybrid) DrainPendingSlashes() []SlashableOffense {
	if h.slashingDetector == nil {
		return nil
	}
	return h.slashingDetector.DrainPendingSlashes()
}

// QueueOffense appends an offense to the pending queue. Exposed for the
// debug RPC used to exercise the on-chain enforcement path; the normal
// producer of offenses is CheckAttestation.
func (sd *SlashingDetector) QueueOffense(off SlashableOffense) {
	sd.mu.Lock()
	defer sd.mu.Unlock()
	sd.pendingSlashes = append(sd.pendingSlashes, off)
}

// DrainPendingSlashes returns the pending offenses and clears the queue, so an
// offense is enforced on-chain exactly once. Called by Finalize via
// processSlashing.
func (sd *SlashingDetector) DrainPendingSlashes() []SlashableOffense {
	sd.mu.Lock()
	defer sd.mu.Unlock()

	if len(sd.pendingSlashes) == 0 {
		return nil
	}
	result := make([]SlashableOffense, len(sd.pendingSlashes))
	copy(result, sd.pendingSlashes)
	sd.pendingSlashes = sd.pendingSlashes[:0]
	return result
}

// ClearPendingSlashes clears pending slashes after they've been processed.
func (sd *SlashingDetector) ClearPendingSlashes() {
	sd.mu.Lock()
	defer sd.mu.Unlock()
	sd.pendingSlashes = make([]SlashableOffense, 0)
}

// RemovePendingSlash removes a specific pending slash.
func (sd *SlashingDetector) RemovePendingSlash(validator common.Address, reason SlashingReason) {
	sd.mu.Lock()
	defer sd.mu.Unlock()

	newPending := make([]SlashableOffense, 0, len(sd.pendingSlashes))
	for _, s := range sd.pendingSlashes {
		if s.Validator != validator || s.Reason != reason {
			newPending = append(newPending, s)
		}
	}
	sd.pendingSlashes = newPending
}

// UpdateLastSeen updates the last seen block for a validator.
func (sd *SlashingDetector) UpdateLastSeen(validator common.Address, blockNumber uint64) {
	sd.mu.Lock()
	defer sd.mu.Unlock()
	sd.lastSeen[validator] = blockNumber
}

// GetLastSeen returns the last seen block for a validator.
func (sd *SlashingDetector) GetLastSeen(validator common.Address) (uint64, bool) {
	sd.mu.RLock()
	defer sd.mu.RUnlock()
	lastSeen, exists := sd.lastSeen[validator]
	return lastSeen, exists
}

// SetOfflineThreshold sets the number of blocks before a validator is considered offline.
func (sd *SlashingDetector) SetOfflineThreshold(blocks uint64) {
	sd.mu.Lock()
	defer sd.mu.Unlock()
	sd.offlineThreshold = blocks
}

// attestationKey identifies one validator's attestation AT ONE HEIGHT.
//
// It previously built the suffix with string(rune(blockNumber)), which encodes
// the number as a Unicode code point rather than as digits. Code points stop at
// 0x10FFFF (1,114,111), so every real ALT height overflowed to the replacement
// character U+FFFD and EVERY height collapsed onto the same key. Consequences,
// both observed live on 2026-09-09 at heights 7,226,200 / 7,226,240:
//
//   - a validator's second attestation was compared against its first, the
//     hashes differed (different blocks), and it was rejected as equivocation —
//     so finality worked exactly once per validator and then stopped forever;
//   - honest validators accrued bogus pendingSlashes. Those are harmless at the
//     contract (slashWithEvidence binds blockNumber into both signed digests, so
//     cross-height evidence recovers the wrong signer and reverts) but they do
//     burn gas on doomed submissions.
//
// Decimal digits keep one key per (validator, height), which is what the
// double-attestation check means by "same height, different hash".
func attestationKey(validator common.Address, blockNumber uint64) string {
	return validator.Hex() + "-" + strconv.FormatUint(blockNumber, 10)
}

// PruneOldData removes old attestation data to save memory.
func (sd *SlashingDetector) PruneOldData(beforeBlock uint64) {
	// LRU cache automatically handles this, but we can
	// manually prune lastSeen if needed
	sd.mu.Lock()
	defer sd.mu.Unlock()

	for addr, lastBlock := range sd.lastSeen {
		if lastBlock < beforeBlock {
			delete(sd.lastSeen, addr)
		}
	}
}
