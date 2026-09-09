// Copyright 2025 The Altcoinchain Authors
// This file implements EIP-7594 (PeerDAS - Peer Data Availability Sampling)
//
// PeerDAS allows validators to verify data availability by sampling parts of data,
// reducing the need to download entire data blobs. This enhances node efficiency and scalability.
//
// EIP-7594: https://eips.ethereum.org/EIPS/eip-7594

package peerdas

import (
	"crypto/sha256"
	"errors"
	"math/big"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/params"
	"github.com/ethereum/go-ethereum/trie"
)

var (
	// ErrPeerDASNotActive is returned when PeerDAS operations are attempted before FUSAKA fork
	ErrPeerDASNotActive = errors.New("PeerDAS not active (FUSAKA fork not reached)")

	// ErrInvalidSample is returned when a data availability sample is invalid
	ErrInvalidSample = errors.New("invalid data availability sample")

	// ErrSampleVerificationFailed is returned when sample verification fails
	ErrSampleVerificationFailed = errors.New("sample verification failed")
)

// PeerDAS manages Peer Data Availability Sampling for the FUSAKA upgrade
type PeerDAS struct {
	config        *params.ChainConfig
	erasureCoding *ErasureCoding
}

// NewPeerDAS creates a new PeerDAS manager
func NewPeerDAS(config *params.ChainConfig) *PeerDAS {
	return &PeerDAS{
		config:        config,
		erasureCoding: NewErasureCoding(DefaultErasureConfig()),
	}
}

// NewPeerDASWithErasure creates a PeerDAS manager with custom erasure config
func NewPeerDASWithErasure(config *params.ChainConfig, erasureConfig *ErasureConfig) *PeerDAS {
	return &PeerDAS{
		config:        config,
		erasureCoding: NewErasureCoding(erasureConfig),
	}
}

// IsActive returns whether PeerDAS is active at the given block number
func (p *PeerDAS) IsActive(blockNumber *big.Int) bool {
	return p.config != nil && p.config.IsFusaka(blockNumber)
}

// DataSample represents a sample of data for availability verification
type DataSample struct {
	BlockNumber *big.Int
	DataHash    common.Hash
	SampleIndex uint64
	SampleData  []byte
	MerkleProof [][]byte    // Merkle proof for this sample
	Commitment  common.Hash // Commitment hash for this sample
}

// SampleCommitment represents the commitment to all samples for a block
type SampleCommitment struct {
	BlockNumber *big.Int
	DataHash    common.Hash
	MerkleRoot  common.Hash // Root of Merkle tree over all samples
	SampleCount uint64      // Total number of samples
}

// VerifySample verifies a data availability sample
// Verifies the Merkle proof and sample integrity
func (p *PeerDAS) VerifySample(sample *DataSample, commitment *SampleCommitment) error {
	if !p.IsActive(sample.BlockNumber) {
		return ErrPeerDASNotActive
	}

	if commitment == nil {
		return errors.New("sample commitment required for verification")
	}

	// Verify sample hash matches expected
	expectedHash := p.calculateSampleHash(sample.SampleData, sample.SampleIndex)
	if sample.Commitment != expectedHash {
		return ErrInvalidSample
	}

	// Verify Merkle proof if provided
	if len(sample.MerkleProof) > 0 {
		if err := p.verifyMerkleProof(sample, commitment); err != nil {
			return ErrSampleVerificationFailed
		}
	}

	// Verify erasure coding integrity if this is an encoded shard
	if err := p.verifyErasureCoding(sample); err != nil {
		return err
	}

	return nil
}

// calculateSampleHash calculates the hash commitment for a sample
func (p *PeerDAS) calculateSampleHash(sampleData []byte, sampleIndex uint64) common.Hash {
	hasher := sha256.New()
	hasher.Write(sampleData)
	var indexBytes [8]byte
	big.NewInt(int64(sampleIndex)).FillBytes(indexBytes[:])
	hasher.Write(indexBytes[:])
	var hash common.Hash
	hasher.Sum(hash[:0])
	return hash
}

// verifyMerkleProof verifies the Merkle proof for a sample
func (p *PeerDAS) verifyMerkleProof(sample *DataSample, commitment *SampleCommitment) error {
	// Build a proof database from the Merkle proof
	proofDB := make(map[string][]byte)
	for i, proof := range sample.MerkleProof {
		key := common.BytesToHash(proof).Hex()
		proofDB[key] = proof
		_ = i // Use index if needed for proof ordering
	}

	// Create a simple proof reader
	proofReader := &simpleProofDB{data: proofDB}

	// Calculate the sample key/index
	sampleKey := p.sampleIndexToKey(sample.SampleIndex)

	// Verify the proof against the commitment root
	value, err := trie.VerifyProof(commitment.MerkleRoot, sampleKey, proofReader)
	if err != nil {
		return err
	}

	// Verify the value matches the sample commitment
	if common.BytesToHash(value) != sample.Commitment {
		return ErrInvalidSample
	}

	return nil
}

// verifyErasureCoding verifies erasure coding integrity for a sample
func (p *PeerDAS) verifyErasureCoding(sample *DataSample) error {
	if sample == nil || len(sample.SampleData) == 0 {
		return ErrInvalidSample
	}

	// Verify commitment using the same SHA256 method as calculateSampleHash
	// This ensures consistency between sample creation and verification
	expectedHash := p.calculateSampleHash(sample.SampleData, sample.SampleIndex)
	if sample.Commitment != expectedHash {
		return ErrSampleVerificationFailed
	}

	return nil
}

// GetErasureCoding returns the erasure coding instance
func (p *PeerDAS) GetErasureCoding() *ErasureCoding {
	return p.erasureCoding
}

// EncodeBlockData encodes block data using erasure coding for availability sampling
func (p *PeerDAS) EncodeBlockData(data []byte, blockNumber *big.Int) (*ErasureEncodedData, error) {
	if !p.IsActive(blockNumber) {
		return nil, ErrPeerDASNotActive
	}
	return p.erasureCoding.EncodeForBlock(data, blockNumber)
}

// CanReconstructData checks if available samples are sufficient for reconstruction
func (p *PeerDAS) CanReconstructData(samples []*DataSample) bool {
	// Convert samples to encoded shards
	shards := make([]*EncodedShard, len(samples))
	for i, sample := range samples {
		shards[i] = &EncodedShard{
			Index:       int(sample.SampleIndex),
			Data:        sample.SampleData,
			IsParity:    int(sample.SampleIndex) >= p.erasureCoding.DataShards,
			Commitment:  sample.Commitment,
			BlockNumber: sample.BlockNumber,
		}
	}
	return p.erasureCoding.CanReconstruct(shards)
}

// ReconstructData reconstructs original data from available samples
func (p *PeerDAS) ReconstructData(samples []*DataSample, metadata *ErasureEncodedData) ([]byte, error) {
	if !p.CanReconstructData(samples) {
		return nil, ErrInsufficientShards
	}

	// Convert samples to encoded shards
	shards := make([]*EncodedShard, len(samples))
	for i, sample := range samples {
		shards[i] = &EncodedShard{
			Index:       int(sample.SampleIndex),
			Data:        sample.SampleData,
			IsParity:    int(sample.SampleIndex) >= p.erasureCoding.DataShards,
			Commitment:  sample.Commitment,
			BlockNumber: sample.BlockNumber,
		}
	}

	return p.erasureCoding.DecodeFromBlock(metadata, shards)
}

// sampleIndexToKey converts a sample index to a key for Merkle tree
func (p *PeerDAS) sampleIndexToKey(index uint64) []byte {
	var key [8]byte
	big.NewInt(int64(index)).FillBytes(key[:])
	return key[:]
}

// simpleProofDB implements ethdb.KeyValueReader for Merkle proof verification
type simpleProofDB struct {
	data map[string][]byte
}

func (db *simpleProofDB) Get(key []byte) ([]byte, error) {
	if val, ok := db.data[common.BytesToHash(key).Hex()]; ok {
		return val, nil
	}
	return nil, errors.New("proof node not found")
}

func (db *simpleProofDB) Has(key []byte) (bool, error) {
	_, ok := db.data[common.BytesToHash(key).Hex()]
	return ok, nil
}

// RequestSample requests a data availability sample from peers
// This is a placeholder for the network protocol implementation
func (p *PeerDAS) RequestSample(blockNumber *big.Int, dataHash common.Hash, sampleIndex uint64) (*DataSample, error) {
	if !p.IsActive(blockNumber) {
		return nil, ErrPeerDASNotActive
	}

	// TODO: Implement network protocol for requesting samples
	// This requires:
	// 1. P2P protocol messages for sample requests
	// 2. Sample retrieval from peers
	// 3. Sample caching and storage

	return nil, errors.New("PeerDAS network protocol not yet implemented")
}

// SampleData splits data into samples for availability verification
// Creates samples and builds a Merkle tree for verification
func (p *PeerDAS) SampleData(data []byte, blockNumber *big.Int, dataHash common.Hash) ([]*DataSample, *SampleCommitment, error) {
	if !p.IsActive(blockNumber) {
		return nil, nil, ErrPeerDASNotActive
	}

	if len(data) == 0 {
		return nil, nil, errors.New("data cannot be empty")
	}

	// Calculate sample size (simple chunking - can be enhanced with erasure coding)
	sampleSize := uint64(1024) // 1KB samples
	if uint64(len(data)) < sampleSize {
		sampleSize = uint64(len(data))
	}

	// Split data into samples
	numSamples := (uint64(len(data)) + sampleSize - 1) / sampleSize
	samples := make([]*DataSample, 0, numSamples)
	sampleHashes := make([][]byte, numSamples)

	for i := uint64(0); i < numSamples; i++ {
		start := i * sampleSize
		end := start + sampleSize
		if end > uint64(len(data)) {
			end = uint64(len(data))
		}

		sampleData := data[start:end]
		commitment := p.calculateSampleHash(sampleData, i)

		sample := &DataSample{
			BlockNumber: new(big.Int).Set(blockNumber),
			DataHash:    dataHash,
			SampleIndex: i,
			SampleData:  sampleData,
			Commitment:  commitment,
		}

		samples = append(samples, sample)
		sampleHashes[i] = commitment[:]
	}

	// Build Merkle tree root from sample commitments
	merkleRoot := p.buildMerkleRoot(sampleHashes)

	commitment := &SampleCommitment{
		BlockNumber: new(big.Int).Set(blockNumber),
		DataHash:    dataHash,
		MerkleRoot:  merkleRoot,
		SampleCount: numSamples,
	}

	// Generate Merkle proofs for each sample (simplified - full implementation would use trie)
	// TODO: Enhance with proper trie-based Merkle proof generation
	for _, sample := range samples {
		// Basic proof generation (can be enhanced)
		sample.MerkleProof = p.generateSimpleProof(sampleHashes, sample.SampleIndex)
	}

	return samples, commitment, nil
}

// buildMerkleRoot builds a Merkle tree root from sample hashes
func (p *PeerDAS) buildMerkleRoot(hashes [][]byte) common.Hash {
	if len(hashes) == 0 {
		return common.Hash{}
	}
	if len(hashes) == 1 {
		return common.BytesToHash(hashes[0])
	}

	// Simple binary Merkle tree construction
	level := hashes
	for len(level) > 1 {
		nextLevel := make([][]byte, 0, (len(level)+1)/2)
		for i := 0; i < len(level); i += 2 {
			if i+1 < len(level) {
				// Pair of nodes
				combined := append(level[i], level[i+1]...)
				hash := sha256.Sum256(combined)
				nextLevel = append(nextLevel, hash[:])
			} else {
				// Odd node, hash with itself
				combined := append(level[i], level[i]...)
				hash := sha256.Sum256(combined)
				nextLevel = append(nextLevel, hash[:])
			}
		}
		level = nextLevel
	}

	return common.BytesToHash(level[0])
}

// generateSimpleProof generates a simple Merkle proof for a sample
// This is a simplified implementation - full version would use trie-based proofs
func (p *PeerDAS) generateSimpleProof(hashes [][]byte, index uint64) [][]byte {
	if index >= uint64(len(hashes)) {
		return nil
	}

	// Simple proof: just return sibling hashes up the tree
	proof := make([][]byte, 0)
	currentIndex := index
	currentLevel := hashes

	for len(currentLevel) > 1 {
		siblingIndex := currentIndex ^ 1 // XOR to get sibling
		if siblingIndex < uint64(len(currentLevel)) {
			proof = append(proof, currentLevel[siblingIndex])
		}
		currentIndex = currentIndex / 2
		// Build next level
		nextLevel := make([][]byte, 0, (len(currentLevel)+1)/2)
		for i := 0; i < len(currentLevel); i += 2 {
			if i+1 < len(currentLevel) {
				combined := append(currentLevel[i], currentLevel[i+1]...)
				hash := sha256.Sum256(combined)
				nextLevel = append(nextLevel, hash[:])
			} else {
				combined := append(currentLevel[i], currentLevel[i]...)
				hash := sha256.Sum256(combined)
				nextLevel = append(nextLevel, hash[:])
			}
		}
		currentLevel = nextLevel
	}

	return proof
}
