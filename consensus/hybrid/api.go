// Copyright 2024 The Altcoinchain Authors
// This file is part of the go-altcoinchain library.

package hybrid

import (
	"context"
	"math/big"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/common/hexutil"
	"github.com/ethereum/go-ethereum/consensus"
	"github.com/ethereum/go-ethereum/rpc"
)

// API provides validator-related RPC methods.
type API struct {
	hybrid *Hybrid
	chain  consensus.ChainHeaderReader
}

// NewAPI creates a new API instance.
func NewAPI(hybrid *Hybrid, chain consensus.ChainHeaderReader) *API {
	return &API{
		hybrid: hybrid,
		chain:  chain,
	}
}

// ValidatorInfoResult is the result of getValidatorInfo RPC call.
type ValidatorInfoResult struct {
	Address         common.Address `json:"address"`
	Stake           *big.Int       `json:"stake"`
	Active          bool           `json:"active"`
	LastAttestation uint64         `json:"lastAttestation"`
}

// GetValidatorInfo returns information about a specific validator.
func (api *API) GetValidatorInfo(ctx context.Context, addr common.Address) (*ValidatorInfoResult, error) {
	validators := api.hybrid.GetValidators()
	info, exists := validators[addr]
	if !exists {
		return &ValidatorInfoResult{
			Address: addr,
			Stake:   big.NewInt(0),
			Active:  false,
		}, nil
	}

	return &ValidatorInfoResult{
		Address:         info.Address,
		Stake:           info.Stake,
		Active:          info.Active,
		LastAttestation: info.LastAttestation,
	}, nil
}

// GetActiveValidators returns the list of active validator addresses.
func (api *API) GetActiveValidators(ctx context.Context) ([]common.Address, error) {
	validators := api.hybrid.GetValidators()
	active := make([]common.Address, 0)

	for addr, info := range validators {
		if info.Active {
			active = append(active, addr)
		}
	}

	return active, nil
}

// NetworkStatsResult contains network-wide validator statistics.
type NetworkStatsResult struct {
	TotalValidators   int      `json:"totalValidators"`
	ActiveValidators  int      `json:"activeValidators"`
	TotalStaked       *big.Int `json:"totalStaked"`
	MinStake          *big.Int `json:"minStake"`
	LastFinalizedBlock uint64   `json:"lastFinalizedBlock"`
	FinalityThreshold uint64   `json:"finalityThreshold"`
}

// GetNetworkStats returns network-wide validator statistics.
func (api *API) GetNetworkStats(ctx context.Context) (*NetworkStatsResult, error) {
	validators := api.hybrid.GetValidators()

	totalCount := len(validators)
	activeCount := 0
	totalStaked := big.NewInt(0)

	for _, info := range validators {
		if info.Active {
			activeCount++
			totalStaked.Add(totalStaked, info.Stake)
		}
	}

	return &NetworkStatsResult{
		TotalValidators:    totalCount,
		ActiveValidators:   activeCount,
		TotalStaked:        totalStaked,
		MinStake:           (*big.Int)(api.hybrid.config.MinStake),
		LastFinalizedBlock: api.hybrid.finalityTracker.GetLastFinalizedBlock(),
		FinalityThreshold:  api.hybrid.config.FinalityThreshold,
	}, nil
}

// GetFinalityStatus returns the finality status of a block.
func (api *API) GetFinalityStatus(ctx context.Context, blockNumber rpc.BlockNumber) (*FinalityStatus, error) {
	var number uint64
	if blockNumber == rpc.LatestBlockNumber || blockNumber == rpc.PendingBlockNumber {
		header := api.chain.CurrentHeader()
		number = header.Number.Uint64()
	} else {
		number = uint64(blockNumber)
	}

	header := api.chain.GetHeaderByNumber(number)
	if header == nil {
		return nil, nil
	}

	return api.hybrid.finalityTracker.GetFinalityStatus(number, header.Hash()), nil
}

// GetAttestations returns attestations for a specific block.
func (api *API) GetAttestations(ctx context.Context, blockHash common.Hash) (*BlockAttestationsResult, error) {
	attestations := api.hybrid.GetAttestations(blockHash)
	if attestations == nil {
		return nil, nil
	}

	result := &BlockAttestationsResult{
		BlockHash:   attestations.BlockHash,
		BlockNumber: attestations.BlockNumber,
		Attesters:   make([]AttesterInfo, 0, len(attestations.Attestations)),
	}

	validators := api.hybrid.GetValidators()
	for addr, att := range attestations.Attestations {
		stake := big.NewInt(0)
		if info, exists := validators[addr]; exists {
			stake = info.Stake
		}

		result.Attesters = append(result.Attesters, AttesterInfo{
			Validator: addr,
			Stake:     stake,
			Signature: att.Signature,
		})
	}

	return result, nil
}

// BlockAttestationsResult contains attestation data for a block.
type BlockAttestationsResult struct {
	BlockHash   common.Hash    `json:"blockHash"`
	BlockNumber uint64         `json:"blockNumber"`
	Attesters   []AttesterInfo `json:"attesters"`
}

// AttesterInfo contains information about an individual attester.
type AttesterInfo struct {
	Validator common.Address `json:"validator"`
	Stake     *big.Int       `json:"stake"`
	Signature []byte         `json:"signature"`
}

// GetPendingSlashes returns pending slashing offenses.
func (api *API) GetPendingSlashes(ctx context.Context) ([]SlashableOffense, error) {
	return api.hybrid.slashingDetector.GetPendingSlashes(), nil
}

// SubmitAttestation feeds a raw, externally-signed attestation into the engine
// exactly as if it had arrived over gossip. DEBUG/TEST ONLY: it is the injection
// point used to reproduce a double-sign (submit two attestations for the same
// height with different hashes) and observe automatic evidence-based slashing.
func (api *API) SubmitAttestation(ctx context.Context, validator common.Address, blockNumber uint64, blockHash common.Hash, signature hexutil.Bytes) error {
	att := &Attestation{
		Validator:   validator,
		BlockHash:   blockHash,
		BlockNumber: blockNumber,
		Signature:   signature,
	}
	return api.hybrid.AddAttestation(att)
}

// GetConfig returns the hybrid consensus configuration.
func (api *API) GetConfig(ctx context.Context) (*ConfigResult, error) {
	config := api.hybrid.config
	return &ConfigResult{
		Period:                 config.Period,
		FinalityThreshold:      config.FinalityThreshold,
		AttestationWindow:      config.AttestationWindow,
		StakingContract:        config.StakingContract,
		MinStake:               (*big.Int)(config.MinStake),
		MinerRewardPercent:     config.MinerRewardPercent,
		ValidatorRewardPercent: config.ValidatorRewardPercent,
	}, nil
}

// ConfigResult contains hybrid consensus configuration.
type ConfigResult struct {
	Period                 uint64         `json:"period"`
	FinalityThreshold      uint64         `json:"finalityThreshold"`
	AttestationWindow      uint64         `json:"attestationWindow"`
	StakingContract        common.Address `json:"stakingContract"`
	MinStake               *big.Int       `json:"minStake"`
	MinerRewardPercent     uint64         `json:"minerRewardPercent"`
	ValidatorRewardPercent uint64         `json:"validatorRewardPercent"`
}

// CanAttest returns whether a validator can attest to blocks.
func (api *API) CanAttest(ctx context.Context, addr common.Address) (bool, error) {
	validators := api.hybrid.GetValidators()
	info, exists := validators[addr]
	if !exists {
		return false, nil
	}

	// Must be active and have minimum stake
	return info.Active && info.Stake.Cmp((*big.Int)(api.hybrid.config.MinStake)) >= 0, nil
}

// GetValidatorStake returns the stake amount for a validator.
func (api *API) GetValidatorStake(ctx context.Context, addr common.Address) (*big.Int, error) {
	validators := api.hybrid.GetValidators()
	info, exists := validators[addr]
	if !exists {
		return big.NewInt(0), nil
	}
	return info.Stake, nil
}

// MergedMiningAPI provides merged-mining RPC methods (namespace "mm") used by
// the WATTx merged-mining pool to bind an ALT block to a WATTx aux block.
type MergedMiningAPI struct {
	hybrid *Hybrid
}

// NewMergedMiningAPI creates a new merged-mining API instance.
func NewMergedMiningAPI(hybrid *Hybrid) *MergedMiningAPI {
	return &MergedMiningAPI{hybrid: hybrid}
}

// SetCommitment sets the WATTx aux block hash embedded into each new ALT block's
// extraData (RPC: mm_setCommitment). The pool calls this whenever its aux block
// template changes; the value takes effect in the next block template geth
// builds. Passing the zero hash clears it. Returns true on success.
func (api *MergedMiningAPI) SetCommitment(ctx context.Context, commitment common.Hash) (bool, error) {
	api.hybrid.SetMergedCommitment(commitment)
	return true, nil
}

// GetCommitment returns the current merged-mining commitment (RPC:
// mm_getCommitment), or the zero hash if none is set.
func (api *MergedMiningAPI) GetCommitment(ctx context.Context) (common.Hash, error) {
	commit, _ := api.hybrid.MergedCommitment()
	return commit, nil
}

// IsFinalized returns whether a block number has been finalized.
func (api *API) IsFinalized(ctx context.Context, blockNumber uint64) (bool, error) {
	return api.hybrid.IsFinalized(blockNumber), nil
}

// GetLastFinalizedBlock returns the last finalized block number.
func (api *API) GetLastFinalizedBlock(ctx context.Context) (uint64, error) {
	return api.hybrid.finalityTracker.GetLastFinalizedBlock(), nil
}
