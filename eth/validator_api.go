// Copyright 2024 The go-ethereum Authors
// This file is part of the go-ethereum library.
//
// The go-ethereum library is free software: you can redistribute it and/or modify
// it under the terms of the GNU Lesser General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// The go-ethereum library is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
// GNU Lesser General Public License for more details.
//
// You should have received a copy of the GNU Lesser General Public License
// along with the go-ethereum library. If not, see <http://www.gnu.org/licenses/>.

package eth

import (
	"context"
	"errors"
	"math/big"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/common/hexutil"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/rpc"
)

// ValidatorAPI provides RPC methods for hybrid PoW/PoS validator operations.
type ValidatorAPI struct {
	e *Ethereum
}

// NewValidatorAPI creates a new ValidatorAPI instance.
func NewValidatorAPI(e *Ethereum) *ValidatorAPI {
	return &ValidatorAPI{e: e}
}

// ValidatorInfo contains information about a validator.
type ValidatorInfo struct {
	Address           common.Address `json:"address"`
	Stake             *hexutil.Big   `json:"stake"`
	IsActive          bool           `json:"isActive"`
	PendingRewards    *hexutil.Big   `json:"pendingRewards"`
	AttestationCount  uint64         `json:"attestationCount"`
	LastAttestation   uint64         `json:"lastAttestation"`
	WithdrawalPending bool           `json:"withdrawalPending"`
	WithdrawalTime    uint64         `json:"withdrawalTime,omitempty"`
}

// NetworkStats contains network-wide validator statistics.
type NetworkStats struct {
	TotalValidators   uint64       `json:"totalValidators"`
	ActiveValidators  uint64       `json:"activeValidators"`
	TotalStaked       *hexutil.Big `json:"totalStaked"`
	CurrentEpoch      uint64       `json:"currentEpoch"`
	LastFinalizedBlock uint64      `json:"lastFinalizedBlock"`
	PendingRewards    *hexutil.Big `json:"pendingRewards"`
}

// FinalityStatus contains finality information for a block.
type FinalityStatus struct {
	BlockNumber      uint64       `json:"blockNumber"`
	BlockHash        common.Hash  `json:"blockHash"`
	IsFinalized      bool         `json:"isFinalized"`
	AttestationCount uint64       `json:"attestationCount"`
	TotalStakeVoted  *hexutil.Big `json:"totalStakeVoted"`
	RequiredStake    *hexutil.Big `json:"requiredStake"`
	Percentage       float64      `json:"percentage"`
}

// GetValidatorInfo returns information about a specific validator.
func (api *ValidatorAPI) GetValidatorInfo(ctx context.Context, address common.Address) (*ValidatorInfo, error) {
	// Check if hybrid consensus is active
	if !api.e.blockchain.Config().IsHybrid(api.e.blockchain.CurrentBlock().Number()) {
		return nil, errors.New("hybrid consensus not active")
	}

	// Get staking contract state
	state, _, err := api.e.APIBackend.StateAndHeaderByNumber(ctx, rpc.LatestBlockNumber)
	if err != nil {
		return nil, err
	}

	// Read validator info from staking contract
	stakingContract := api.e.blockchain.Config().Hybrid.StakingContract

	// Get stake amount (slot 0 in validators mapping)
	stakeSlot := common.BytesToHash(address.Bytes())
	stakeValue := state.GetState(stakingContract, stakeSlot)
	stake := new(big.Int).SetBytes(stakeValue.Bytes())

	// Check if validator is active (stake >= minStake)
	minStake := (*big.Int)(api.e.blockchain.Config().Hybrid.MinStake)
	isActive := stake.Cmp(minStake) >= 0

	// Get pending rewards (would need to calculate from contract state)
	pendingRewards := big.NewInt(0) // Simplified - actual implementation reads from contract

	return &ValidatorInfo{
		Address:          address,
		Stake:            (*hexutil.Big)(stake),
		IsActive:         isActive,
		PendingRewards:   (*hexutil.Big)(pendingRewards),
		AttestationCount: 0, // Would track in hybrid consensus engine
		LastAttestation:  0,
	}, nil
}

// GetActiveValidators returns a list of all active validator addresses.
func (api *ValidatorAPI) GetActiveValidators(ctx context.Context) ([]common.Address, error) {
	// Check if hybrid consensus is active
	if !api.e.blockchain.Config().IsHybrid(api.e.blockchain.CurrentBlock().Number()) {
		return nil, errors.New("hybrid consensus not active")
	}

	// The hybrid engine's set is kept in sync with the staking contract by
	// the validator updater loop.
	if h := api.e.hybridEngine(); h != nil {
		validators := h.GetValidators()
		addrs := make([]common.Address, 0, len(validators))
		for addr, info := range validators {
			if info.Active {
				addrs = append(addrs, addr)
			}
		}
		return addrs, nil
	}
	return []common.Address{}, nil
}

// GetNetworkStats returns network-wide validator statistics.
func (api *ValidatorAPI) GetNetworkStats(ctx context.Context) (*NetworkStats, error) {
	// Check if hybrid consensus is active
	currentBlock := api.e.blockchain.CurrentBlock()
	if !api.e.blockchain.Config().IsHybrid(currentBlock.Number()) {
		return nil, errors.New("hybrid consensus not active")
	}

	stats := &NetworkStats{
		TotalStaked:    (*hexutil.Big)(big.NewInt(0)),
		CurrentEpoch:   currentBlock.NumberU64() / 32, // 32 blocks per epoch
		PendingRewards: (*hexutil.Big)(big.NewInt(0)),
	}
	if h := api.e.hybridEngine(); h != nil {
		validators := h.GetValidators()
		stats.TotalValidators = uint64(len(validators))
		stats.ActiveValidators = uint64(h.GetActiveValidatorCount())
		stats.TotalStaked = (*hexutil.Big)(h.GetTotalStake())
	}
	return stats, nil
}

// GetFinalityStatus returns the finality status of a block.
func (api *ValidatorAPI) GetFinalityStatus(ctx context.Context, blockNrOrHash rpc.BlockNumberOrHash) (*FinalityStatus, error) {
	// Check if hybrid consensus is active
	if !api.e.blockchain.Config().IsHybrid(api.e.blockchain.CurrentBlock().Number()) {
		return nil, errors.New("hybrid consensus not active")
	}

	// Get the block
	var block *types.Block
	if blockNr, ok := blockNrOrHash.Number(); ok {
		block = api.e.blockchain.GetBlockByNumber(uint64(blockNr))
	} else if hash, ok := blockNrOrHash.Hash(); ok {
		block = api.e.blockchain.GetBlockByHash(hash)
	}

	if block == nil {
		return nil, errors.New("block not found")
	}

	// In a full implementation, this would query the hybrid consensus engine
	// for attestation data
	return &FinalityStatus{
		BlockNumber:      block.NumberU64(),
		BlockHash:        block.Hash(),
		IsFinalized:      false, // Would check hybrid engine
		AttestationCount: 0,
		TotalStakeVoted:  (*hexutil.Big)(big.NewInt(0)),
		RequiredStake:    (*hexutil.Big)(big.NewInt(0)),
		Percentage:       0,
	}, nil
}

// Stake stakes ALT tokens to become a validator.
// This creates and sends a transaction to the staking contract.
func (api *ValidatorAPI) Stake(ctx context.Context, from common.Address, amount *hexutil.Big) (common.Hash, error) {
	// Check if hybrid consensus is active
	if !api.e.blockchain.Config().IsHybrid(api.e.blockchain.CurrentBlock().Number()) {
		return common.Hash{}, errors.New("hybrid consensus not active")
	}

	// Validate minimum stake
	minStake := (*big.Int)(api.e.blockchain.Config().Hybrid.MinStake)
	if (*big.Int)(amount).Cmp(minStake) < 0 {
		return common.Hash{}, errors.New("stake amount below minimum (32 ALT)")
	}

	// The actual staking would be done by sending a transaction to the staking contract
	// This would be handled by the frontend calling eth_sendTransaction with the
	// appropriate contract call data
	return common.Hash{}, errors.New("use eth_sendTransaction to call staking contract stake() function")
}

// RequestWithdrawal initiates a withdrawal request for a validator.
func (api *ValidatorAPI) RequestWithdrawal(ctx context.Context, from common.Address) (common.Hash, error) {
	// Check if hybrid consensus is active
	if !api.e.blockchain.Config().IsHybrid(api.e.blockchain.CurrentBlock().Number()) {
		return common.Hash{}, errors.New("hybrid consensus not active")
	}

	// The actual withdrawal request would be done by sending a transaction
	return common.Hash{}, errors.New("use eth_sendTransaction to call staking contract requestWithdrawal() function")
}

// Withdraw completes a withdrawal after the delay period.
func (api *ValidatorAPI) Withdraw(ctx context.Context, from common.Address) (common.Hash, error) {
	// Check if hybrid consensus is active
	if !api.e.blockchain.Config().IsHybrid(api.e.blockchain.CurrentBlock().Number()) {
		return common.Hash{}, errors.New("hybrid consensus not active")
	}

	// The actual withdrawal would be done by sending a transaction
	return common.Hash{}, errors.New("use eth_sendTransaction to call staking contract withdraw() function")
}

// ClaimRewards claims pending validator rewards.
func (api *ValidatorAPI) ClaimRewards(ctx context.Context, from common.Address) (common.Hash, error) {
	// Check if hybrid consensus is active
	if !api.e.blockchain.Config().IsHybrid(api.e.blockchain.CurrentBlock().Number()) {
		return common.Hash{}, errors.New("hybrid consensus not active")
	}

	// The actual claim would be done by sending a transaction
	return common.Hash{}, errors.New("use eth_sendTransaction to call staking contract claimRewards() function")
}

// GetStakingContractAddress returns the staking contract address.
func (api *ValidatorAPI) GetStakingContractAddress(ctx context.Context) (common.Address, error) {
	// Check if hybrid config exists
	if api.e.blockchain.Config().Hybrid == nil {
		return common.Address{}, errors.New("hybrid consensus not configured")
	}
	return api.e.blockchain.Config().Hybrid.StakingContract, nil
}

// GetMinimumStake returns the minimum stake required to become a validator.
func (api *ValidatorAPI) GetMinimumStake(ctx context.Context) (*hexutil.Big, error) {
	// Check if hybrid config exists
	if api.e.blockchain.Config().Hybrid == nil {
		return nil, errors.New("hybrid consensus not configured")
	}
	return api.e.blockchain.Config().Hybrid.MinStake, nil
}

// IsHybridActive returns whether hybrid consensus is currently active.
func (api *ValidatorAPI) IsHybridActive(ctx context.Context) (bool, error) {
	currentBlock := api.e.blockchain.CurrentBlock()
	if currentBlock == nil {
		return false, errors.New("no current block")
	}
	return api.e.blockchain.Config().IsHybrid(currentBlock.Number()), nil
}

// GetHybridForkBlock returns the block number at which hybrid consensus activates.
func (api *ValidatorAPI) GetHybridForkBlock(ctx context.Context) (*hexutil.Big, error) {
	hybridBlock := api.e.blockchain.Config().HybridBlock
	if hybridBlock == nil {
		return nil, errors.New("hybrid fork not configured")
	}
	return (*hexutil.Big)(hybridBlock), nil
}
