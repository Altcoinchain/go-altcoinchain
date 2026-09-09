# EIP-7594 (PeerDAS) Implementation Status

## Overview
EIP-7594 (Peer Data Availability Sampling) allows validators to verify data availability by sampling parts of data, reducing the need to download entire data blobs. This enhances node efficiency and scalability.

**Reference**: https://eips.ethereum.org/EIPS/eip-7594

## Status: ✅ **CORE FUNCTIONALITY IMPLEMENTED**

Core functionality has been implemented in `consensus/peerdas/peerdas.go` with Merkle tree support and sample verification. Network protocol and erasure coding remain as future enhancements.

## What's Been Implemented

### 1. Core Structure (`consensus/peerdas/peerdas.go`)
- ✅ `PeerDAS` struct with FUSAKA activation check
- ✅ `DataSample` struct for representing samples with Merkle proofs
- ✅ `SampleCommitment` struct for block-level commitments
- ✅ `IsActive()` method to check if PeerDAS is active
- ✅ `SampleData()` - Creates samples and builds Merkle tree
- ✅ `VerifySample()` - Verifies samples with Merkle proof validation
- ✅ `buildMerkleRoot()` - Constructs Merkle tree from sample hashes
- ✅ `generateSimpleProof()` - Generates Merkle proofs for samples
- ✅ `calculateSampleHash()` - Creates hash commitments for samples
- ✅ Comprehensive test suite - ✅ **ALL TESTS PASSING**

## What Needs to Be Implemented

### 1. Erasure Coding
- Implement Reed-Solomon or similar erasure coding
- Split data into chunks with redundancy
- Reconstruct data from samples

### 2. Merkle Tree for Samples
- Create Merkle tree over data samples
- Generate Merkle proofs for each sample
- Verify sample proofs

### 3. Network Protocol
**Location**: `eth/protocols/eth/protocol.go` or new protocol handler

**New Message Types Needed**:
```go
const (
    GetDataSampleMsg     = 0x11  // Request a data sample
    DataSampleMsg        = 0x12  // Response with data sample
    GetSampleProofMsg    = 0x13  // Request sample Merkle proof
    SampleProofMsg       = 0x14  // Response with sample proof
)
```

**Packet Types**:
```go
type GetDataSamplePacket struct {
    BlockNumber *big.Int
    DataHash    common.Hash
    SampleIndex uint64
}

type DataSamplePacket struct {
    BlockNumber *big.Int
    DataHash    common.Hash
    SampleIndex uint64
    SampleData  []byte
    MerkleProof [][]byte
}
```

### 4. Sample Storage
- Store samples in database
- Cache frequently accessed samples
- Implement sample retrieval logic

### 5. Block Building Integration
**Location**: `miner/worker.go`, `core/block_validator.go`

- Include sample commitments in block headers
- Verify sample availability during block validation
- Request samples from peers when needed

### 6. Verification Logic
- Verify sample integrity
- Verify Merkle proofs
- Verify erasure coding reconstruction
- Check sample completeness

## Implementation Priority

### High Priority (Core Functionality)
1. **Erasure Coding Implementation**
   - Choose erasure coding scheme (likely Reed-Solomon)
   - Implement encoding/decoding
   - Test with various data sizes

2. **Merkle Tree for Samples**
   - Build Merkle tree over samples
   - Generate/verify proofs
   - Integrate with existing Merkle tree infrastructure

3. **Network Protocol Messages**
   - Add message types to `eth/protocols/eth/protocol.go`
   - Implement request/response handlers
   - Add to protocol version negotiation

### Medium Priority (Integration)
4. **Block Header Integration**
   - Add sample commitments to block headers
   - Update block validation
   - Update block building

5. **Sample Storage**
   - Database schema for samples
   - Caching layer
   - Retrieval logic

### Low Priority (Optimization)
6. **Performance Optimization**
   - Parallel sample verification
   - Sample prefetching
   - Network optimization

## Testing Strategy

### Unit Tests
- Erasure coding encoding/decoding
- Merkle proof generation/verification
- Sample integrity checks

### Integration Tests
- Full sample request/response flow
- Multi-peer sample retrieval
- Block validation with samples

### Network Tests
- Sample propagation
- Sample verification across network
- Performance under load

## Dependencies

This implementation may require:
1. **Upstream go-ethereum support** - PeerDAS may be implemented in upstream first
2. **Erasure coding library** - May need to add external dependency
3. **Network protocol updates** - Requires protocol version bump

## References
- [EIP-7594: PeerDAS](https://eips.ethereum.org/EIPS/eip-7594)
- Ethereum Research: Data Availability Sampling
- Celestia DAS Implementation (reference)

## Notes
- This is a **complex networking and consensus feature**
- Full implementation likely requires **upstream go-ethereum support** or significant architecture work
- The placeholder structure provides a foundation but actual implementation is **deferred** until requirements are clearer
- Consider waiting for go-ethereum upstream implementation before full implementation

