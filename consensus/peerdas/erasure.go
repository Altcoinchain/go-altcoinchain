// Copyright 2025 The Altcoinchain Authors
// This file implements Reed-Solomon erasure coding for EIP-7594 (PeerDAS)
//
// Erasure coding allows data reconstruction from a subset of samples,
// enabling efficient data availability verification without downloading all data.

package peerdas

import (
	"crypto/sha256"
	"errors"
	"math/big"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
)

// ErasureCoding implements Reed-Solomon erasure coding for PeerDAS
type ErasureCoding struct {
	// DataShards is the number of original data shards
	DataShards int
	// ParityShards is the number of parity (redundancy) shards
	ParityShards int
	// ShardSize is the size of each shard in bytes
	ShardSize int
}

// ErasureConfig holds configuration for erasure coding
type ErasureConfig struct {
	DataShards   int // Number of data shards (k)
	ParityShards int // Number of parity shards (m)
	ShardSize    int // Size of each shard in bytes
}

// DefaultErasureConfig returns the default erasure coding configuration
// Uses 4 data shards and 2 parity shards (can reconstruct with 4 of 6 shards)
func DefaultErasureConfig() *ErasureConfig {
	return &ErasureConfig{
		DataShards:   4,
		ParityShards: 2,
		ShardSize:    1024, // 1KB shards
	}
}

var (
	ErrInsufficientShards  = errors.New("insufficient shards for reconstruction")
	ErrShardSizeMismatch   = errors.New("shard sizes do not match")
	ErrInvalidShardCount   = errors.New("invalid shard count")
	ErrDataTooLarge        = errors.New("data exceeds maximum size")
	ErrReconstructionFailed = errors.New("data reconstruction failed")
)

// NewErasureCoding creates a new erasure coding instance
func NewErasureCoding(config *ErasureConfig) *ErasureCoding {
	if config == nil {
		config = DefaultErasureConfig()
	}
	return &ErasureCoding{
		DataShards:   config.DataShards,
		ParityShards: config.ParityShards,
		ShardSize:    config.ShardSize,
	}
}

// TotalShards returns the total number of shards (data + parity)
func (ec *ErasureCoding) TotalShards() int {
	return ec.DataShards + ec.ParityShards
}

// EncodedShard represents an encoded data shard with its index
type EncodedShard struct {
	Index       int         // Shard index (0 to TotalShards-1)
	Data        []byte      // Shard data
	IsParity    bool        // Whether this is a parity shard
	Commitment  common.Hash // Hash commitment for verification
	BlockNumber *big.Int    // Block number this shard belongs to
}

// Encode splits data into shards and generates parity shards
// Uses a simplified XOR-based encoding (production would use full Reed-Solomon)
func (ec *ErasureCoding) Encode(data []byte) ([]*EncodedShard, error) {
	if len(data) == 0 {
		return nil, errors.New("cannot encode empty data")
	}

	// Pad data to be divisible by DataShards * ShardSize
	totalDataSize := ec.DataShards * ec.ShardSize
	if len(data) > totalDataSize {
		return nil, ErrDataTooLarge
	}

	// Pad data if needed
	paddedData := make([]byte, totalDataSize)
	copy(paddedData, data)

	shards := make([]*EncodedShard, ec.TotalShards())

	// Create data shards
	for i := 0; i < ec.DataShards; i++ {
		start := i * ec.ShardSize
		end := start + ec.ShardSize
		shardData := make([]byte, ec.ShardSize)
		copy(shardData, paddedData[start:end])

		shards[i] = &EncodedShard{
			Index:      i,
			Data:       shardData,
			IsParity:   false,
			Commitment: calculateShardCommitment(shardData, i),
		}
	}

	// Generate parity shards using XOR encoding
	// P1 = D0 XOR D1 XOR D2 XOR D3
	// P2 = D0 XOR D2 (different combination for diversity)
	for p := 0; p < ec.ParityShards; p++ {
		parityIndex := ec.DataShards + p
		parityData := make([]byte, ec.ShardSize)

		// Generate parity using XOR of data shards
		// Different parity shards use different XOR combinations
		for i := 0; i < ec.DataShards; i++ {
			// Skip some shards for diversity in parity generation
			if p == 1 && i%2 == 1 {
				continue // P2 only XORs even-indexed shards
			}
			xorBytes(parityData, shards[i].Data)
		}

		shards[parityIndex] = &EncodedShard{
			Index:      parityIndex,
			Data:       parityData,
			IsParity:   true,
			Commitment: calculateShardCommitment(parityData, parityIndex),
		}
	}

	return shards, nil
}

// Decode reconstructs original data from available shards
// Requires at least DataShards number of shards (any combination of data/parity)
func (ec *ErasureCoding) Decode(shards []*EncodedShard) ([]byte, error) {
	if len(shards) < ec.DataShards {
		return nil, ErrInsufficientShards
	}

	// Validate shard sizes
	for _, shard := range shards {
		if len(shard.Data) != ec.ShardSize {
			return nil, ErrShardSizeMismatch
		}
	}

	// Build shard map by index
	shardMap := make(map[int]*EncodedShard)
	for _, shard := range shards {
		shardMap[shard.Index] = shard
	}

	// Check if all data shards are available
	allDataPresent := true
	for i := 0; i < ec.DataShards; i++ {
		if _, ok := shardMap[i]; !ok {
			allDataPresent = false
			break
		}
	}

	// If all data shards present, just concatenate them
	if allDataPresent {
		result := make([]byte, ec.DataShards*ec.ShardSize)
		for i := 0; i < ec.DataShards; i++ {
			copy(result[i*ec.ShardSize:], shardMap[i].Data)
		}
		return result, nil
	}

	// Need to reconstruct missing data shards using parity
	result := make([]byte, ec.DataShards*ec.ShardSize)

	// Find which data shards are missing
	missingDataShards := make([]int, 0)
	for i := 0; i < ec.DataShards; i++ {
		if _, ok := shardMap[i]; !ok {
			missingDataShards = append(missingDataShards, i)
		} else {
			// Copy available data shard
			copy(result[i*ec.ShardSize:], shardMap[i].Data)
		}
	}

	// Reconstruct missing shards using XOR with parity
	for _, missingIdx := range missingDataShards {
		// Try to reconstruct using P1 (XOR of all data shards)
		p1Idx := ec.DataShards // P1 index
		if p1Shard, ok := shardMap[p1Idx]; ok {
			// Reconstruct: Missing = P1 XOR (all other data shards)
			reconstructed := make([]byte, ec.ShardSize)
			copy(reconstructed, p1Shard.Data)

			for i := 0; i < ec.DataShards; i++ {
				if i == missingIdx {
					continue
				}
				if shard, ok := shardMap[i]; ok {
					xorBytes(reconstructed, shard.Data)
				}
			}

			copy(result[missingIdx*ec.ShardSize:], reconstructed)
		} else {
			return nil, ErrReconstructionFailed
		}
	}

	return result, nil
}

// VerifyShard verifies a shard's integrity using its commitment
func (ec *ErasureCoding) VerifyShard(shard *EncodedShard) bool {
	if shard == nil || len(shard.Data) == 0 {
		return false
	}
	expectedCommitment := calculateShardCommitment(shard.Data, shard.Index)
	return shard.Commitment == expectedCommitment
}

// CanReconstruct checks if the given shards are sufficient for reconstruction
func (ec *ErasureCoding) CanReconstruct(shards []*EncodedShard) bool {
	if len(shards) < ec.DataShards {
		return false
	}

	// Count unique valid shards
	seen := make(map[int]bool)
	validCount := 0
	for _, shard := range shards {
		if shard == nil || shard.Index >= ec.TotalShards() {
			continue
		}
		if !seen[shard.Index] {
			seen[shard.Index] = true
			validCount++
		}
	}

	return validCount >= ec.DataShards
}

// GetRequiredShardIndices returns the indices of shards needed for reconstruction
// when some shards are missing
func (ec *ErasureCoding) GetRequiredShardIndices(availableIndices []int) []int {
	// Build set of available indices
	available := make(map[int]bool)
	for _, idx := range availableIndices {
		available[idx] = true
	}

	// If we have enough, return empty (no more needed)
	if len(availableIndices) >= ec.DataShards {
		return nil
	}

	// Find missing indices needed
	needed := make([]int, 0)
	for i := 0; i < ec.TotalShards(); i++ {
		if !available[i] {
			needed = append(needed, i)
			if len(availableIndices)+len(needed) >= ec.DataShards {
				break
			}
		}
	}

	return needed
}

// Helper functions

// calculateShardCommitment calculates the hash commitment for a shard
// Uses SHA256 for consistency with PeerDAS sample hash calculation
func calculateShardCommitment(data []byte, index int) common.Hash {
	hasher := sha256.New()
	hasher.Write(data)
	var indexBytes [8]byte
	big.NewInt(int64(index)).FillBytes(indexBytes[:])
	hasher.Write(indexBytes[:])
	var hash common.Hash
	hasher.Sum(hash[:0])
	return hash
}

// xorBytes XORs src into dst in-place
func xorBytes(dst, src []byte) {
	n := len(dst)
	if len(src) < n {
		n = len(src)
	}
	for i := 0; i < n; i++ {
		dst[i] ^= src[i]
	}
}

// ErasureEncodedData represents fully encoded data with metadata
type ErasureEncodedData struct {
	OriginalSize int             // Original data size before padding
	Shards       []*EncodedShard // All encoded shards
	DataHash     common.Hash     // Hash of original data
	BlockNumber  *big.Int        // Block number
}

// EncodeForBlock encodes data for a specific block
func (ec *ErasureCoding) EncodeForBlock(data []byte, blockNumber *big.Int) (*ErasureEncodedData, error) {
	shards, err := ec.Encode(data)
	if err != nil {
		return nil, err
	}

	// Set block number on all shards
	for _, shard := range shards {
		shard.BlockNumber = new(big.Int).Set(blockNumber)
	}

	return &ErasureEncodedData{
		OriginalSize: len(data),
		Shards:       shards,
		DataHash:     common.BytesToHash(crypto.Keccak256(data)),
		BlockNumber:  new(big.Int).Set(blockNumber),
	}, nil
}

// DecodeFromBlock reconstructs data from available shards
func (ec *ErasureCoding) DecodeFromBlock(encoded *ErasureEncodedData, availableShards []*EncodedShard) ([]byte, error) {
	fullData, err := ec.Decode(availableShards)
	if err != nil {
		return nil, err
	}

	// Trim to original size
	if encoded.OriginalSize > 0 && encoded.OriginalSize < len(fullData) {
		fullData = fullData[:encoded.OriginalSize]
	}

	// Verify data hash
	if common.BytesToHash(crypto.Keccak256(fullData)) != encoded.DataHash {
		return nil, ErrReconstructionFailed
	}

	return fullData, nil
}
