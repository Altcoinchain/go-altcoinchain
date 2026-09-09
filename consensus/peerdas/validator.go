// Copyright 2025 The Altcoinchain Authors
// This file implements block validation integration for EIP-7594 (PeerDAS)
//
// Provides hooks for integrating data availability sampling into the
// block validation pipeline.

package peerdas

import (
	"errors"
	"math/big"
	"sync"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
)

var (
	ErrDataUnavailable        = errors.New("block data not available")
	ErrInsufficientSamples    = errors.New("insufficient samples for DA verification")
	ErrCommitmentMismatch     = errors.New("data availability commitment mismatch")
	ErrValidationNotSupported = errors.New("PeerDAS validation not supported before FUSAKA")
)

// DACommitment represents a data availability commitment included in block header
type DACommitment struct {
	BlockNumber    *big.Int    // Block number
	BlockHash      common.Hash // Block hash
	DataRoot       common.Hash // Merkle root of encoded data
	BlobHash       common.Hash // Hash of original blob data
	ShardCount     uint64      // Number of shards (data + parity)
	DataShardCount uint64      // Number of data shards only
}

// BlockDAProof contains the data availability proof for a block
type BlockDAProof struct {
	Commitment   *DACommitment      // The commitment being proven
	Samples      []*DataSample      // Sampled shards
	SampleCount  uint64             // Number of samples taken
	IsComplete   bool               // Whether all required samples verified
	RecoveryData *ErasureEncodedData // For reconstruction if needed
}

// DAValidator handles data availability validation for blocks
type DAValidator struct {
	peerdas  *PeerDAS
	protocol *Protocol

	// Pending validations
	pendingValidations sync.Map // blockHash -> *pendingValidation

	// Configuration
	minSampleRatio float64 // Minimum ratio of samples needed (e.g., 0.5)
	sampleCount    int     // Number of samples to request per block
}

type pendingValidation struct {
	commitment *DACommitment
	samples    []*DataSample
	complete   bool
}

// NewDAValidator creates a new data availability validator
func NewDAValidator(p *PeerDAS, proto *Protocol) *DAValidator {
	return &DAValidator{
		peerdas:        p,
		protocol:       proto,
		minSampleRatio: 0.5,          // Need 50% of samples
		sampleCount:    4,            // Sample 4 shards by default
	}
}

// SetSampleParameters configures sampling parameters
func (v *DAValidator) SetSampleParameters(minRatio float64, sampleCount int) {
	v.minSampleRatio = minRatio
	v.sampleCount = sampleCount
}

// CreateCommitment creates a DA commitment for block data
func (v *DAValidator) CreateCommitment(blockNumber *big.Int, blockHash common.Hash, data []byte) (*DACommitment, *ErasureEncodedData, error) {
	if !v.peerdas.IsActive(blockNumber) {
		return nil, nil, ErrValidationNotSupported
	}

	// Encode data with erasure coding
	encoded, err := v.peerdas.EncodeBlockData(data, blockNumber)
	if err != nil {
		return nil, nil, err
	}

	// Calculate commitment
	commitment := &DACommitment{
		BlockNumber:    blockNumber,
		BlockHash:      blockHash,
		DataRoot:       calculateDataRoot(encoded.Shards),
		BlobHash:       encoded.DataHash,
		ShardCount:     uint64(len(encoded.Shards)),
		DataShardCount: uint64(v.peerdas.erasureCoding.DataShards),
	}

	return commitment, encoded, nil
}

// ValidateCommitment validates that a block's DA commitment is properly formed
func (v *DAValidator) ValidateCommitment(commitment *DACommitment) error {
	if commitment == nil {
		return errors.New("nil commitment")
	}
	if commitment.BlockNumber == nil {
		return errors.New("missing block number")
	}
	if commitment.DataRoot == (common.Hash{}) {
		return errors.New("empty data root")
	}
	if commitment.ShardCount == 0 {
		return errors.New("zero shard count")
	}
	if commitment.DataShardCount == 0 || commitment.DataShardCount > commitment.ShardCount {
		return errors.New("invalid data shard count")
	}
	return nil
}

// ValidateDataAvailability validates data availability for a block through sampling
func (v *DAValidator) ValidateDataAvailability(commitment *DACommitment) (*BlockDAProof, error) {
	if !v.peerdas.IsActive(commitment.BlockNumber) {
		return nil, ErrValidationNotSupported
	}

	if err := v.ValidateCommitment(commitment); err != nil {
		return nil, err
	}

	// Select random sample indices
	indices := v.selectSampleIndices(commitment.ShardCount)

	// Request samples from network
	samples, err := v.protocol.RequestSamples(
		commitment.BlockNumber,
		commitment.BlockHash,
		indices,
	)
	if err != nil {
		return nil, err
	}

	// Check if we have enough samples
	minRequired := int(float64(len(indices)) * v.minSampleRatio)
	if len(samples) < minRequired {
		return nil, ErrInsufficientSamples
	}

	// Verify each sample
	sampleCommitment := &SampleCommitment{
		BlockNumber: commitment.BlockNumber,
		DataHash:    commitment.BlobHash,
		MerkleRoot:  commitment.DataRoot,
		SampleCount: commitment.ShardCount,
	}

	verifiedSamples := make([]*DataSample, 0, len(samples))
	for _, sample := range samples {
		if err := v.peerdas.VerifySample(sample, sampleCommitment); err == nil {
			verifiedSamples = append(verifiedSamples, sample)
		}
	}

	// Determine if validation passed
	isComplete := len(verifiedSamples) >= minRequired

	proof := &BlockDAProof{
		Commitment:  commitment,
		Samples:     verifiedSamples,
		SampleCount: uint64(len(verifiedSamples)),
		IsComplete:  isComplete,
	}

	if !isComplete {
		return proof, ErrDataUnavailable
	}

	return proof, nil
}

// ValidateWithFullData validates DA using full data (for block producers)
func (v *DAValidator) ValidateWithFullData(commitment *DACommitment, encoded *ErasureEncodedData) error {
	if !v.peerdas.IsActive(commitment.BlockNumber) {
		return ErrValidationNotSupported
	}

	// Verify data hash matches
	if encoded.DataHash != commitment.BlobHash {
		return ErrCommitmentMismatch
	}

	// Verify data root matches
	expectedRoot := calculateDataRoot(encoded.Shards)
	if expectedRoot != commitment.DataRoot {
		return ErrCommitmentMismatch
	}

	// Verify shard counts
	if uint64(len(encoded.Shards)) != commitment.ShardCount {
		return ErrCommitmentMismatch
	}

	return nil
}

// CanReconstructFromSamples checks if available samples can reconstruct the data
func (v *DAValidator) CanReconstructFromSamples(samples []*DataSample) bool {
	return v.peerdas.CanReconstructData(samples)
}

// ReconstructData reconstructs original data from samples
func (v *DAValidator) ReconstructData(proof *BlockDAProof) ([]byte, error) {
	if proof.RecoveryData == nil {
		return nil, errors.New("recovery data not available")
	}
	return v.peerdas.ReconstructData(proof.Samples, proof.RecoveryData)
}

// selectSampleIndices selects random indices to sample
func (v *DAValidator) selectSampleIndices(totalShards uint64) []uint64 {
	// Use block hash or other entropy for randomness
	// For now, use a simple distribution across all shards
	indices := make([]uint64, 0, v.sampleCount)

	if totalShards == 0 {
		return indices
	}

	step := totalShards / uint64(v.sampleCount)
	if step == 0 {
		step = 1
	}

	for i := 0; i < v.sampleCount && uint64(i)*step < totalShards; i++ {
		indices = append(indices, uint64(i)*step)
	}

	return indices
}

// StoreBlockSamples stores samples for a validated block
func (v *DAValidator) StoreBlockSamples(encoded *ErasureEncodedData) {
	if v.protocol == nil || encoded == nil {
		return
	}

	// Convert encoded shards to samples
	samples := make([]*DataSample, len(encoded.Shards))
	for i, shard := range encoded.Shards {
		samples[i] = &DataSample{
			BlockNumber: encoded.BlockNumber,
			DataHash:    encoded.DataHash,
			SampleIndex: uint64(shard.Index),
			SampleData:  shard.Data,
			Commitment:  shard.Commitment,
		}
	}

	v.protocol.StoreSamples(samples)
}

// AnnounceBlockSamples announces available samples to the network
func (v *DAValidator) AnnounceBlockSamples(commitment *DACommitment, encoded *ErasureEncodedData) error {
	if v.protocol == nil {
		return nil
	}

	indices := make([]uint64, len(encoded.Shards))
	for i, shard := range encoded.Shards {
		indices[i] = uint64(shard.Index)
	}

	return v.protocol.AnnounceSamples(
		commitment.BlockNumber,
		commitment.BlockHash,
		indices,
	)
}

// Helper functions

// calculateDataRoot calculates the Merkle root of encoded shards
func calculateDataRoot(shards []*EncodedShard) common.Hash {
	if len(shards) == 0 {
		return common.Hash{}
	}

	hashes := make([][]byte, len(shards))
	for i, shard := range shards {
		hashes[i] = shard.Commitment[:]
	}

	return buildMerkleRoot(hashes)
}

// buildMerkleRoot builds a Merkle tree root from hashes
func buildMerkleRoot(hashes [][]byte) common.Hash {
	if len(hashes) == 0 {
		return common.Hash{}
	}
	if len(hashes) == 1 {
		return common.BytesToHash(hashes[0])
	}

	level := hashes
	for len(level) > 1 {
		nextLevel := make([][]byte, 0, (len(level)+1)/2)
		for i := 0; i < len(level); i += 2 {
			if i+1 < len(level) {
				combined := append(level[i], level[i+1]...)
				hash := crypto.Keccak256(combined)
				nextLevel = append(nextLevel, hash)
			} else {
				combined := append(level[i], level[i]...)
				hash := crypto.Keccak256(combined)
				nextLevel = append(nextLevel, hash)
			}
		}
		level = nextLevel
	}

	return common.BytesToHash(level[0])
}

// BlockHeaderExtension extends block header with DA commitment (for integration)
type BlockHeaderExtension struct {
	DACommitmentHash common.Hash // Hash of DACommitment for header inclusion
}

// HashDACommitment creates a hash of the DA commitment for header inclusion
func HashDACommitment(c *DACommitment) common.Hash {
	if c == nil {
		return common.Hash{}
	}

	// Combine all commitment fields
	data := append(c.BlockHash.Bytes(), c.DataRoot.Bytes()...)
	data = append(data, c.BlobHash.Bytes()...)
	data = append(data, big.NewInt(int64(c.ShardCount)).Bytes()...)
	data = append(data, big.NewInt(int64(c.DataShardCount)).Bytes()...)

	return common.BytesToHash(crypto.Keccak256(data))
}
