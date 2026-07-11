// Copyright 2024 The Altcoinchain Authors
// This file is part of the go-altcoinchain library.
//
// The go-altcoinchain library is free software: you can redistribute it and/or modify
// it under the terms of the GNU Lesser General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// The go-altcoinchain library is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
// GNU Lesser General Public License for more details.
//
// You should have received a copy of the GNU Lesser General Public License
// along with the go-altcoinchain library. If not, see <http://www.gnu.org/licenses/>.

// Package hybrid implements a hybrid PoW/PoS consensus engine for Altcoinchain.
// It wraps the existing ethash PoW engine and adds PoS finality through validator
// attestations. Miners create blocks using PoW, and validators with 32+ ALT stake
// attest to blocks for finality.
//
// Block Rewards (2 ALT total per block):
//   - 1 ALT to the PoW miner who found the block
//   - 1 ALT to the PoS validator pool (distributed based on stake)
package hybrid

import (
	"errors"
	"math/big"
	"sync"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/consensus"
	"github.com/ethereum/go-ethereum/consensus/ethash"
	"github.com/ethereum/go-ethereum/core/state"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/log"
	"github.com/ethereum/go-ethereum/rpc"
	"github.com/ethereum/go-ethereum/trie"
	lru "github.com/hashicorp/golang-lru"
)

var (
	// ErrNotHybrid is returned when hybrid consensus is not enabled
	ErrNotHybrid = errors.New("hybrid consensus not enabled")
	// ErrInvalidAttestation is returned when an attestation is invalid
	ErrInvalidAttestation = errors.New("invalid attestation")
	// ErrDuplicateAttestation is returned when a validator has already attested
	ErrDuplicateAttestation = errors.New("duplicate attestation from validator")
	// ErrValidatorNotActive is returned when a validator is not active
	ErrValidatorNotActive = errors.New("validator not active")
	// ErrInsufficientStake is returned when validator has insufficient stake
	ErrInsufficientStake = errors.New("insufficient stake")

	// HybridBlockReward is the total block reward in hybrid mode (2 ALT)
	HybridBlockReward = big.NewInt(2e18)
	// HybridMinerReward is the PoW miner reward (1 ALT)
	HybridMinerReward = big.NewInt(1e18)
	// HybridValidatorReward is the PoS validator reward (1 ALT)
	HybridValidatorReward = big.NewInt(1e18)
)

// Config contains the configuration parameters of the hybrid consensus engine.
type Config struct {
	// Period is the minimum time between blocks (in seconds)
	Period uint64 `json:"period"`
	// FinalityThreshold is the percentage of stake required for finality (e.g., 67)
	FinalityThreshold uint64 `json:"finalityThreshold"`
	// AttestationWindow is the number of blocks to keep attestations for
	AttestationWindow uint64 `json:"attestationWindow"`
	// StakingContract is the address of the staking contract
	StakingContract common.Address `json:"stakingContract"`
	// MinStake is the minimum stake required to be a validator (in wei)
	MinStake *big.Int `json:"minStake"`
	// MinerRewardPercent is the percentage of block reward for miners (e.g., 70)
	MinerRewardPercent uint64 `json:"minerRewardPercent"`
	// ValidatorRewardPercent is the percentage for validators (e.g., 30)
	ValidatorRewardPercent uint64 `json:"validatorRewardPercent"`
}

// DefaultConfig returns the default hybrid consensus configuration.
func DefaultConfig() *Config {
	return &Config{
		Period:                 15,
		FinalityThreshold:      67,
		AttestationWindow:      32,
		StakingContract:        common.HexToAddress("0x45be3647d64fe1c251efc5054d4016271d42d12c"),
		MinStake:               new(big.Int).Mul(big.NewInt(32), big.NewInt(1e18)), // 32 ALT
		MinerRewardPercent:     70,
		ValidatorRewardPercent: 30,
	}
}

// Hybrid is a hybrid PoW/PoS consensus engine.
// It wraps ethash for PoW block production and adds PoS finality.
type Hybrid struct {
	config *Config
	ethash *ethash.Ethash

	// Attestation tracking
	attestations *lru.Cache // blockHash -> *BlockAttestations
	finalized    *lru.Cache // blockNumber -> blockHash (finalized blocks)

	// Validator tracking
	validators     map[common.Address]*ValidatorInfo
	validatorsLock sync.RWMutex

	// Finality tracking
	finalityTracker *FinalityTracker

	// Pending validator reward for current block
	pendingValidatorReward *big.Int

	// Slashing detection
	slashingDetector *SlashingDetector

	log log.Logger
	mu  sync.RWMutex
}

// ValidatorInfo contains information about a validator
type ValidatorInfo struct {
	Address         common.Address
	Stake           *big.Int
	Active          bool
	LastAttestation uint64 // Block number of last attestation
}

// New creates a new hybrid consensus engine.
func New(config *Config, ethashConfig ethash.Config, notify []string, noverify bool) *Hybrid {
	if config == nil {
		config = DefaultConfig()
	}

	attestations, _ := lru.New(int(config.AttestationWindow * 2))
	finalized, _ := lru.New(1000)

	h := &Hybrid{
		config:       config,
		ethash:       ethash.New(ethashConfig, notify, noverify),
		attestations: attestations,
		finalized:    finalized,
		validators:   make(map[common.Address]*ValidatorInfo),
		log:          log.New("consensus", "hybrid"),
	}

	h.finalityTracker = NewFinalityTracker(h)
	h.slashingDetector = NewSlashingDetector(h)

	return h
}

// NewFaker creates a fake hybrid consensus engine for testing.
func NewFaker() *Hybrid {
	config := DefaultConfig()
	attestations, _ := lru.New(int(config.AttestationWindow * 2))
	finalized, _ := lru.New(1000)

	h := &Hybrid{
		config:       config,
		ethash:       ethash.NewFaker(),
		attestations: attestations,
		finalized:    finalized,
		validators:   make(map[common.Address]*ValidatorInfo),
		log:          log.New("consensus", "hybrid"),
	}

	h.finalityTracker = NewFinalityTracker(h)
	h.slashingDetector = NewSlashingDetector(h)

	return h
}

// Author implements consensus.Engine, returning the header's coinbase as the
// block author (miner).
func (h *Hybrid) Author(header *types.Header) (common.Address, error) {
	return h.ethash.Author(header)
}

// VerifyHeader checks whether a header conforms to the consensus rules.
func (h *Hybrid) VerifyHeader(chain consensus.ChainHeaderReader, header *types.Header, seal bool) error {
	// First verify using ethash rules
	return h.ethash.VerifyHeader(chain, header, seal)
}

// VerifyHeaders is similar to VerifyHeader, but verifies a batch of headers concurrently.
func (h *Hybrid) VerifyHeaders(chain consensus.ChainHeaderReader, headers []*types.Header, seals []bool) (chan<- struct{}, <-chan error) {
	return h.ethash.VerifyHeaders(chain, headers, seals)
}

// VerifyUncles verifies that the given block's uncles conform to the consensus rules.
func (h *Hybrid) VerifyUncles(chain consensus.ChainReader, block *types.Block) error {
	return h.ethash.VerifyUncles(chain, block)
}

// Prepare initializes the consensus fields of a block header.
func (h *Hybrid) Prepare(chain consensus.ChainHeaderReader, header *types.Header) error {
	return h.ethash.Prepare(chain, header)
}

// Finalize runs any post-transaction state modifications (e.g. block rewards).
// In hybrid mode, this distributes rewards between miners and validators.
func (h *Hybrid) Finalize(chain consensus.ChainHeaderReader, header *types.Header, statedb *state.StateDB, txs []*types.Transaction, uncles []*types.Header) {
	config := chain.Config()

	// Check if hybrid consensus is active
	if config.Hybrid == nil || !config.IsHybrid(header.Number) {
		// Fall back to pure ethash
		h.ethash.Finalize(chain, header, statedb, txs, uncles)
		return
	}

	// Hybrid block rewards: 1 ALT to PoW miner, 1 ALT to PoS validators
	// Total: 2 ALT per block
	minerReward := new(big.Int).Set(HybridMinerReward)
	validatorReward := new(big.Int).Set(HybridValidatorReward)

	// Calculate uncle rewards (reduced in hybrid mode)
	// Uncle creators get 1/8 of miner reward, miner gets small bonus
	r := new(big.Int)
	for _, uncle := range uncles {
		r.Add(uncle.Number, big.NewInt(8))
		r.Sub(r, header.Number)
		r.Mul(r, HybridMinerReward)
		r.Div(r, big.NewInt(8))
		// Uncle reward
		uncleCreatorReward := new(big.Int).Set(r)
		statedb.AddBalance(uncle.Coinbase, uncleCreatorReward)

		// Miner gets 1/32 of miner reward per uncle included
		r.Div(HybridMinerReward, big.NewInt(32))
		minerReward.Add(minerReward, r)
	}

	// Credit miner
	statedb.AddBalance(header.Coinbase, minerReward)

	// Distribute validator rewards to online validators
	// The reward is split among all validators who attested recently
	stakingContract := h.config.StakingContract
	onlineValidators := h.getOnlineValidators()

	if len(onlineValidators) > 0 {
		// Split reward among online validators
		rewardPerValidator := new(big.Int).Div(validatorReward, big.NewInt(int64(len(onlineValidators))))

		for range onlineValidators {
			// Add the reward to staking contract, earmarked per online validator.
			// The contract's distributeRewards function will handle distribution
			statedb.AddBalance(stakingContract, rewardPerValidator)
		}

		h.log.Debug("Validator rewards distributed",
			"block", header.Number,
			"onlineValidators", len(onlineValidators),
			"rewardPerValidator", rewardPerValidator)
	} else {
		// No online validators, reward goes to staking contract pool
		statedb.AddBalance(stakingContract, validatorReward)
		h.log.Debug("No online validators, reward to contract pool",
			"block", header.Number,
			"reward", validatorReward)
	}

	// Store the validator reward for tracking/logging
	h.mu.Lock()
	h.pendingValidatorReward = validatorReward
	h.mu.Unlock()

	h.log.Debug("Hybrid block finalized",
		"block", header.Number,
		"minerReward", minerReward,
		"validatorReward", validatorReward,
		"stakingContract", stakingContract)

	header.Root = statedb.IntermediateRoot(config.IsEIP158(header.Number))
}

// FinalizeAndAssemble runs any post-transaction state modifications and assembles the final block.
func (h *Hybrid) FinalizeAndAssemble(chain consensus.ChainHeaderReader, header *types.Header, statedb *state.StateDB, txs []*types.Transaction, uncles []*types.Header, receipts []*types.Receipt) (*types.Block, error) {
	// Pre-fork blocks are pure ethash, rewards and assembly included.
	if config := chain.Config(); config.Hybrid == nil || !config.IsHybrid(header.Number) {
		return h.ethash.FinalizeAndAssemble(chain, header, statedb, txs, uncles, receipts)
	}
	// Hybrid mode: Finalize pays the split rewards and sets the state root.
	// Assemble directly — delegating to ethash.FinalizeAndAssemble would run
	// ethash.Finalize a second time and pay classic rewards on top, making
	// locally mined blocks fail state-root validation on import.
	h.Finalize(chain, header, statedb, txs, uncles)
	return types.NewBlock(header, txs, uncles, receipts, trie.NewStackTrie(nil)), nil
}

// SetThreads updates the mining threads on the wrapped ethash engine, keeping
// the miner's threaded-interface dispatch working through beacon -> hybrid -> ethash.
func (h *Hybrid) SetThreads(threads int) {
	h.ethash.SetThreads(threads)
}

// Seal generates a new sealing request for the given input block.
func (h *Hybrid) Seal(chain consensus.ChainHeaderReader, block *types.Block, results chan<- *types.Block, stop <-chan struct{}) error {
	return h.ethash.Seal(chain, block, results, stop)
}

// SealHash returns the hash of a block prior to it being sealed.
func (h *Hybrid) SealHash(header *types.Header) common.Hash {
	return h.ethash.SealHash(header)
}

// CalcDifficulty is the difficulty adjustment algorithm.
func (h *Hybrid) CalcDifficulty(chain consensus.ChainHeaderReader, time uint64, parent *types.Header) *big.Int {
	return h.ethash.CalcDifficulty(chain, time, parent)
}

// APIs returns the RPC APIs this consensus engine provides.
func (h *Hybrid) APIs(chain consensus.ChainHeaderReader) []rpc.API {
	apis := h.ethash.APIs(chain)

	// Add hybrid-specific APIs
	apis = append(apis, rpc.API{
		Namespace: "validator",
		Service:   NewAPI(h, chain),
	})

	return apis
}

// Close terminates any background threads maintained by the consensus engine.
func (h *Hybrid) Close() error {
	return h.ethash.Close()
}

// Hashrate returns the current mining hashrate.
func (h *Hybrid) Hashrate() float64 {
	return h.ethash.Hashrate()
}

// AddAttestation adds a new attestation from a validator.
func (h *Hybrid) AddAttestation(attestation *Attestation) error {
	h.mu.Lock()
	defer h.mu.Unlock()

	// Verify the attestation
	if err := h.verifyAttestation(attestation); err != nil {
		return err
	}

	// Check for slashing conditions
	if slashable := h.slashingDetector.CheckAttestation(attestation); slashable != nil {
		h.log.Warn("Slashable attestation detected", "validator", attestation.Validator, "reason", slashable.Reason)
		return ErrInvalidAttestation
	}

	// Get or create block attestations
	blockHash := attestation.BlockHash
	var blockAttestations *BlockAttestations
	if cached, ok := h.attestations.Get(blockHash); ok {
		blockAttestations = cached.(*BlockAttestations)
	} else {
		blockAttestations = &BlockAttestations{
			BlockHash:    blockHash,
			BlockNumber:  attestation.BlockNumber,
			Attestations: make(map[common.Address]*Attestation),
		}
	}

	// Check for duplicate
	if _, exists := blockAttestations.Attestations[attestation.Validator]; exists {
		return ErrDuplicateAttestation
	}

	// Add attestation
	blockAttestations.Attestations[attestation.Validator] = attestation
	h.attestations.Add(blockHash, blockAttestations)

	// Update validator's last attestation
	if validator, exists := h.validators[attestation.Validator]; exists {
		validator.LastAttestation = attestation.BlockNumber
	}

	// Check if block is now finalized
	h.finalityTracker.CheckFinality(blockHash, blockAttestations)

	h.log.Debug("Attestation added", "block", blockHash, "validator", attestation.Validator, "total", len(blockAttestations.Attestations))

	return nil
}

// verifyAttestation verifies an attestation is valid.
func (h *Hybrid) verifyAttestation(attestation *Attestation) error {
	// Verify signature
	if !attestation.VerifySignature() {
		return ErrInvalidAttestation
	}

	// Check validator is active
	h.validatorsLock.RLock()
	validator, exists := h.validators[attestation.Validator]
	h.validatorsLock.RUnlock()

	if !exists || !validator.Active {
		return ErrValidatorNotActive
	}

	// Check validator has sufficient stake
	if validator.Stake.Cmp((*big.Int)(h.config.MinStake)) < 0 {
		return ErrInsufficientStake
	}

	return nil
}

// GetAttestations returns all attestations for a block.
func (h *Hybrid) GetAttestations(blockHash common.Hash) *BlockAttestations {
	h.mu.RLock()
	defer h.mu.RUnlock()

	if cached, ok := h.attestations.Get(blockHash); ok {
		return cached.(*BlockAttestations)
	}
	return nil
}

// IsFinalized returns whether a block has been finalized.
func (h *Hybrid) IsFinalized(blockNumber uint64) bool {
	return h.finalityTracker.IsFinalized(blockNumber)
}

// GetFinalizedBlock returns the hash of the finalized block at the given number.
func (h *Hybrid) GetFinalizedBlock(blockNumber uint64) (common.Hash, bool) {
	return h.finalityTracker.GetFinalizedBlock(blockNumber)
}

// UpdateValidators updates the validator set from the staking contract.
func (h *Hybrid) UpdateValidators(validators map[common.Address]*ValidatorInfo) {
	h.validatorsLock.Lock()
	defer h.validatorsLock.Unlock()
	h.validators = validators
}

// GetValidators returns the current validator set.
func (h *Hybrid) GetValidators() map[common.Address]*ValidatorInfo {
	h.validatorsLock.RLock()
	defer h.validatorsLock.RUnlock()

	// Return a copy
	result := make(map[common.Address]*ValidatorInfo)
	for addr, info := range h.validators {
		result[addr] = &ValidatorInfo{
			Address:         info.Address,
			Stake:           new(big.Int).Set(info.Stake),
			Active:          info.Active,
			LastAttestation: info.LastAttestation,
		}
	}
	return result
}

// GetTotalStake returns the total stake of all active validators.
func (h *Hybrid) GetTotalStake() *big.Int {
	h.validatorsLock.RLock()
	defer h.validatorsLock.RUnlock()

	total := big.NewInt(0)
	for _, v := range h.validators {
		if v.Active {
			total.Add(total, v.Stake)
		}
	}
	return total
}

// GetActiveValidatorCount returns the number of active validators.
func (h *Hybrid) GetActiveValidatorCount() int {
	h.validatorsLock.RLock()
	defer h.validatorsLock.RUnlock()

	count := 0
	for _, v := range h.validators {
		if v.Active {
			count++
		}
	}
	return count
}

// Config returns the hybrid consensus configuration.
func (h *Hybrid) Config() *Config {
	return h.config
}

// SetPendingValidatorReward sets the pending validator reward for current block.
func (h *Hybrid) SetPendingValidatorReward(reward *big.Int) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.pendingValidatorReward = reward
}

// GetPendingValidatorReward returns the pending validator reward for current block.
func (h *Hybrid) GetPendingValidatorReward() *big.Int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	if h.pendingValidatorReward == nil {
		return big.NewInt(0)
	}
	return new(big.Int).Set(h.pendingValidatorReward)
}

// getOnlineValidators returns validators who have attested within the attestation window.
func (h *Hybrid) getOnlineValidators() []common.Address {
	h.validatorsLock.RLock()
	defer h.validatorsLock.RUnlock()

	var online []common.Address
	for addr, v := range h.validators {
		if v.Active && v.LastAttestation > 0 {
			online = append(online, addr)
		}
	}
	return online
}
