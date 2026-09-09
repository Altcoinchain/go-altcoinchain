// Copyright 2025 The Altcoinchain Authors
// Tests for EIP-7594 (PeerDAS) implementation

package peerdas

import (
	"math/big"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/params"
)

// Test configuration with FUSAKA active
func testConfig() *params.ChainConfig {
	return &params.ChainConfig{
		ChainID:     big.NewInt(2330),
		FusakaBlock: big.NewInt(0), // FUSAKA active from genesis for testing
	}
}

func TestNewPeerDAS(t *testing.T) {
	p := NewPeerDAS(testConfig())
	if p == nil {
		t.Fatal("NewPeerDAS returned nil")
	}
	if p.erasureCoding == nil {
		t.Fatal("erasureCoding not initialized")
	}
}

func TestIsActive(t *testing.T) {
	p := NewPeerDAS(testConfig())

	tests := []struct {
		blockNum *big.Int
		expected bool
	}{
		{big.NewInt(0), true},
		{big.NewInt(100), true},
		{big.NewInt(1000000), true},
	}

	for _, tt := range tests {
		result := p.IsActive(tt.blockNum)
		if result != tt.expected {
			t.Errorf("IsActive(%v) = %v, want %v", tt.blockNum, result, tt.expected)
		}
	}
}

func TestErasureEncode(t *testing.T) {
	ec := NewErasureCoding(DefaultErasureConfig())

	// Test data (less than 4KB to fit in 4 shards of 1KB each)
	data := make([]byte, 2048)
	for i := range data {
		data[i] = byte(i % 256)
	}

	shards, err := ec.Encode(data)
	if err != nil {
		t.Fatalf("Encode failed: %v", err)
	}

	if len(shards) != ec.TotalShards() {
		t.Errorf("Expected %d shards, got %d", ec.TotalShards(), len(shards))
	}

	// Verify data shards
	dataShardCount := 0
	parityShardCount := 0
	for _, shard := range shards {
		if shard.IsParity {
			parityShardCount++
		} else {
			dataShardCount++
		}
	}

	if dataShardCount != ec.DataShards {
		t.Errorf("Expected %d data shards, got %d", ec.DataShards, dataShardCount)
	}
	if parityShardCount != ec.ParityShards {
		t.Errorf("Expected %d parity shards, got %d", ec.ParityShards, parityShardCount)
	}
}

func TestErasureDecode_AllDataShards(t *testing.T) {
	ec := NewErasureCoding(DefaultErasureConfig())

	// Original data
	originalData := make([]byte, 2048)
	for i := range originalData {
		originalData[i] = byte(i % 256)
	}

	// Encode
	shards, err := ec.Encode(originalData)
	if err != nil {
		t.Fatalf("Encode failed: %v", err)
	}

	// Decode using only data shards
	dataShards := make([]*EncodedShard, 0, ec.DataShards)
	for _, shard := range shards {
		if !shard.IsParity {
			dataShards = append(dataShards, shard)
		}
	}

	decoded, err := ec.Decode(dataShards)
	if err != nil {
		t.Fatalf("Decode failed: %v", err)
	}

	// Compare (note: decoded may be padded)
	for i := 0; i < len(originalData); i++ {
		if decoded[i] != originalData[i] {
			t.Errorf("Data mismatch at index %d: got %d, want %d", i, decoded[i], originalData[i])
			break
		}
	}
}

func TestSampleData(t *testing.T) {
	p := NewPeerDAS(testConfig())

	data := []byte("test data for sampling verification in PeerDAS")
	blockNum := big.NewInt(100)
	dataHash := common.BytesToHash([]byte("datahash"))

	samples, commitment, err := p.SampleData(data, blockNum, dataHash)
	if err != nil {
		t.Fatalf("SampleData failed: %v", err)
	}

	if commitment == nil {
		t.Fatal("commitment is nil")
	}

	if len(samples) == 0 {
		t.Fatal("no samples created")
	}

	if commitment.SampleCount != uint64(len(samples)) {
		t.Errorf("sample count mismatch: commitment says %d, got %d samples",
			commitment.SampleCount, len(samples))
	}

	// Verify each sample
	for _, sample := range samples {
		err := p.VerifySample(sample, commitment)
		if err != nil {
			t.Errorf("VerifySample failed for sample %d: %v", sample.SampleIndex, err)
		}
	}
}

func TestSampleCache(t *testing.T) {
	cache := NewSampleCache()

	sample := &DataSample{
		BlockNumber: big.NewInt(100),
		DataHash:    common.BytesToHash([]byte("hash1")),
		SampleIndex: 0,
		SampleData:  []byte("test data"),
		Commitment:  common.BytesToHash([]byte("commitment")),
	}

	// Put sample
	cache.Put(sample)

	if cache.Size() != 1 {
		t.Errorf("Expected cache size 1, got %d", cache.Size())
	}

	// Get sample
	retrieved, ok := cache.Get(sample.DataHash, sample.SampleIndex)
	if !ok {
		t.Fatal("Failed to retrieve sample from cache")
	}

	if retrieved.SampleIndex != sample.SampleIndex {
		t.Errorf("Sample index mismatch: got %d, want %d",
			retrieved.SampleIndex, sample.SampleIndex)
	}

	// Delete sample
	cache.Delete(sample.DataHash, sample.SampleIndex)

	if cache.Size() != 0 {
		t.Errorf("Expected cache size 0 after delete, got %d", cache.Size())
	}
}

func TestDACommitmentValidation(t *testing.T) {
	p := NewPeerDAS(testConfig())
	proto := NewProtocol(p)
	validator := NewDAValidator(p, proto)

	// Test valid commitment
	validCommitment := &DACommitment{
		BlockNumber:    big.NewInt(100),
		BlockHash:      common.BytesToHash([]byte("blockhash")),
		DataRoot:       common.BytesToHash([]byte("dataroot")),
		BlobHash:       common.BytesToHash([]byte("blobhash")),
		ShardCount:     6,
		DataShardCount: 4,
	}

	err := validator.ValidateCommitment(validCommitment)
	if err != nil {
		t.Errorf("Valid commitment validation failed: %v", err)
	}

	// Test nil commitment
	err = validator.ValidateCommitment(nil)
	if err == nil {
		t.Error("Expected error for nil commitment")
	}

	// Test missing block number
	invalidCommitment := &DACommitment{
		DataRoot:       common.BytesToHash([]byte("dataroot")),
		ShardCount:     6,
		DataShardCount: 4,
	}
	err = validator.ValidateCommitment(invalidCommitment)
	if err == nil {
		t.Error("Expected error for missing block number")
	}
}

func TestCreateAndValidateCommitment(t *testing.T) {
	p := NewPeerDAS(testConfig())
	proto := NewProtocol(p)
	validator := NewDAValidator(p, proto)

	blockNum := big.NewInt(100)
	blockHash := common.BytesToHash([]byte("blockhash"))
	data := []byte("test block data for commitment creation")

	// Create commitment
	commitment, encoded, err := validator.CreateCommitment(blockNum, blockHash, data)
	if err != nil {
		t.Fatalf("CreateCommitment failed: %v", err)
	}

	if commitment == nil {
		t.Fatal("commitment is nil")
	}
	if encoded == nil {
		t.Fatal("encoded data is nil")
	}

	// Validate commitment structure
	err = validator.ValidateCommitment(commitment)
	if err != nil {
		t.Errorf("ValidateCommitment failed: %v", err)
	}

	// Validate with full data
	err = validator.ValidateWithFullData(commitment, encoded)
	if err != nil {
		t.Errorf("ValidateWithFullData failed: %v", err)
	}
}

func TestHashDACommitment(t *testing.T) {
	commitment := &DACommitment{
		BlockNumber:    big.NewInt(100),
		BlockHash:      common.BytesToHash([]byte("blockhash")),
		DataRoot:       common.BytesToHash([]byte("dataroot")),
		BlobHash:       common.BytesToHash([]byte("blobhash")),
		ShardCount:     6,
		DataShardCount: 4,
	}

	hash1 := HashDACommitment(commitment)
	hash2 := HashDACommitment(commitment)

	// Should be deterministic
	if hash1 != hash2 {
		t.Error("HashDACommitment is not deterministic")
	}

	// Nil commitment should return empty hash
	nilHash := HashDACommitment(nil)
	if nilHash != (common.Hash{}) {
		t.Error("Expected empty hash for nil commitment")
	}
}

func BenchmarkErasureEncode(b *testing.B) {
	ec := NewErasureCoding(DefaultErasureConfig())
	data := make([]byte, 4096)
	for i := range data {
		data[i] = byte(i % 256)
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, err := ec.Encode(data)
		if err != nil {
			b.Fatal(err)
		}
	}
}

func BenchmarkErasureDecode(b *testing.B) {
	ec := NewErasureCoding(DefaultErasureConfig())
	data := make([]byte, 4096)
	for i := range data {
		data[i] = byte(i % 256)
	}

	shards, _ := ec.Encode(data)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, err := ec.Decode(shards[:ec.DataShards])
		if err != nil {
			b.Fatal(err)
		}
	}
}

func BenchmarkSampleVerification(b *testing.B) {
	p := NewPeerDAS(testConfig())
	data := make([]byte, 4096)
	for i := range data {
		data[i] = byte(i % 256)
	}

	samples, commitment, _ := p.SampleData(data, big.NewInt(100), common.BytesToHash(data))

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		for _, sample := range samples {
			p.VerifySample(sample, commitment)
		}
	}
}
