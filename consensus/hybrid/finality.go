// Copyright 2024 The Altcoinchain Authors
// This file is part of the go-altcoinchain library.

package hybrid

import (
	"math/big"
	"sync"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/log"
	lru "github.com/hashicorp/golang-lru"
)

// FinalityTracker tracks block finality based on validator attestations.
// A block is considered finalized when it has attestations from validators
// representing at least 67% of the total stake.
type FinalityTracker struct {
	hybrid *Hybrid

	// Finalized blocks: blockNumber -> blockHash
	finalized *lru.Cache

	// Last finalized block number
	lastFinalized uint64

	log log.Logger
	mu  sync.RWMutex
}

// FinalityStatus represents the finality status of a block.
type FinalityStatus struct {
	BlockNumber     uint64         `json:"blockNumber"`
	BlockHash       common.Hash    `json:"blockHash"`
	IsFinalized     bool           `json:"isFinalized"`
	AttesterCount   int            `json:"attesterCount"`
	TotalValidators int            `json:"totalValidators"`
	AttestingStake  *big.Int       `json:"attestingStake"`
	TotalStake      *big.Int       `json:"totalStake"`
	StakePercent    float64        `json:"stakePercent"`
	Threshold       uint64         `json:"threshold"`
}

// NewFinalityTracker creates a new finality tracker.
func NewFinalityTracker(hybrid *Hybrid) *FinalityTracker {
	finalized, _ := lru.New(1000)
	return &FinalityTracker{
		hybrid:    hybrid,
		finalized: finalized,
		log:       log.New("module", "finality"),
	}
}

// CheckFinality checks if a block has reached finality based on attestations.
func (ft *FinalityTracker) CheckFinality(blockHash common.Hash, attestations *BlockAttestations) bool {
	ft.mu.Lock()
	defer ft.mu.Unlock()

	// Don't re-check already finalized blocks
	if ft.isFinalized(attestations.BlockNumber) {
		return true
	}

	// Get validators and calculate stake
	validators := ft.hybrid.GetValidators()
	totalStake := ft.hybrid.GetTotalStake()

	// If no validators, can't finalize
	if totalStake.Sign() == 0 {
		return false
	}

	// Calculate attesting stake
	attestingStake := attestations.TotalStake(validators)

	// Calculate percentage: (attestingStake * 100) / totalStake
	percentage := new(big.Int).Mul(attestingStake, big.NewInt(100))
	percentage.Div(percentage, totalStake)

	threshold := ft.hybrid.config.FinalityThreshold

	if percentage.Uint64() >= threshold {
		// Block is finalized!
		ft.finalized.Add(attestations.BlockNumber, blockHash)
		if attestations.BlockNumber > ft.lastFinalized {
			ft.lastFinalized = attestations.BlockNumber
		}

		ft.log.Info("Block finalized",
			"number", attestations.BlockNumber,
			"hash", blockHash.Hex(),
			"attesters", len(attestations.Attestations),
			"stake%", percentage.Uint64(),
		)

		return true
	}

	ft.log.Debug("Block not yet finalized",
		"number", attestations.BlockNumber,
		"hash", blockHash.Hex(),
		"attesters", len(attestations.Attestations),
		"stake%", percentage.Uint64(),
		"threshold", threshold,
	)

	return false
}

// IsFinalized returns whether a block has been finalized.
func (ft *FinalityTracker) IsFinalized(blockNumber uint64) bool {
	ft.mu.RLock()
	defer ft.mu.RUnlock()
	return ft.isFinalized(blockNumber)
}

// isFinalized is the internal implementation (assumes lock is held).
func (ft *FinalityTracker) isFinalized(blockNumber uint64) bool {
	_, ok := ft.finalized.Get(blockNumber)
	return ok
}

// GetFinalizedBlock returns the hash of the finalized block at the given number.
func (ft *FinalityTracker) GetFinalizedBlock(blockNumber uint64) (common.Hash, bool) {
	ft.mu.RLock()
	defer ft.mu.RUnlock()

	if hash, ok := ft.finalized.Get(blockNumber); ok {
		return hash.(common.Hash), true
	}
	return common.Hash{}, false
}

// GetLastFinalizedBlock returns the last finalized block number.
func (ft *FinalityTracker) GetLastFinalizedBlock() uint64 {
	ft.mu.RLock()
	defer ft.mu.RUnlock()
	return ft.lastFinalized
}

// GetFinalityStatus returns detailed finality status for a block.
func (ft *FinalityTracker) GetFinalityStatus(blockNumber uint64, blockHash common.Hash) *FinalityStatus {
	ft.mu.RLock()
	defer ft.mu.RUnlock()

	validators := ft.hybrid.GetValidators()
	totalStake := ft.hybrid.GetTotalStake()
	totalValidators := ft.hybrid.GetActiveValidatorCount()

	status := &FinalityStatus{
		BlockNumber:     blockNumber,
		BlockHash:       blockHash,
		IsFinalized:     ft.isFinalized(blockNumber),
		TotalValidators: totalValidators,
		TotalStake:      totalStake,
		Threshold:       ft.hybrid.config.FinalityThreshold,
	}

	// Get attestations for this block
	attestations := ft.hybrid.GetAttestations(blockHash)
	if attestations != nil {
		status.AttesterCount = attestations.AttesterCount()
		status.AttestingStake = attestations.TotalStake(validators)

		if totalStake.Sign() > 0 {
			// Calculate percentage as float
			attestingFloat := new(big.Float).SetInt(status.AttestingStake)
			totalFloat := new(big.Float).SetInt(totalStake)
			percentFloat := new(big.Float).Quo(attestingFloat, totalFloat)
			percentFloat.Mul(percentFloat, big.NewFloat(100))
			status.StakePercent, _ = percentFloat.Float64()
		}
	} else {
		status.AttesterCount = 0
		status.AttestingStake = big.NewInt(0)
		status.StakePercent = 0
	}

	return status
}

// MarkFinalized manually marks a block as finalized.
// This is used during chain synchronization.
func (ft *FinalityTracker) MarkFinalized(blockNumber uint64, blockHash common.Hash) {
	ft.mu.Lock()
	defer ft.mu.Unlock()

	ft.finalized.Add(blockNumber, blockHash)
	if blockNumber > ft.lastFinalized {
		ft.lastFinalized = blockNumber
	}
}

// GetFinalizedRange returns all finalized blocks in a range.
func (ft *FinalityTracker) GetFinalizedRange(start, end uint64) map[uint64]common.Hash {
	ft.mu.RLock()
	defer ft.mu.RUnlock()

	result := make(map[uint64]common.Hash)
	for n := start; n <= end; n++ {
		if hash, ok := ft.finalized.Get(n); ok {
			result[n] = hash.(common.Hash)
		}
	}
	return result
}

// CanReorg returns whether a reorg to the given block is allowed.
// Reorgs past finalized blocks are not allowed.
func (ft *FinalityTracker) CanReorg(targetBlockNumber uint64) bool {
	ft.mu.RLock()
	defer ft.mu.RUnlock()

	// Can't reorg past the last finalized block
	return targetBlockNumber >= ft.lastFinalized
}

// PruneOldBlocks removes finality data for blocks older than the given number.
func (ft *FinalityTracker) PruneOldBlocks(beforeBlock uint64) {
	ft.mu.Lock()
	defer ft.mu.Unlock()

	// Note: LRU cache automatically prunes, but we can explicitly remove
	// entries if needed for memory management
	keys := ft.finalized.Keys()
	for _, key := range keys {
		if blockNum, ok := key.(uint64); ok && blockNum < beforeBlock {
			ft.finalized.Remove(key)
		}
	}
}
