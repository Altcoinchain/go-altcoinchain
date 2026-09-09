// Copyright 2025 The Altcoinchain Authors
// This file implements P2P protocol messages for EIP-7594 (PeerDAS)
//
// Defines message types and handlers for requesting and distributing
// data availability samples across the peer-to-peer network.

package peerdas

import (
	"errors"
	"math/big"
	"sync"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/rlp"
)

// Protocol constants
const (
	// Protocol name for PeerDAS
	ProtocolName = "peerdas"

	// Protocol version
	ProtocolVersion = 1

	// Message codes
	SampleRequestMsg  = 0x00
	SampleResponseMsg = 0x01
	SampleAnnounceMsg = 0x02
	SamplePushMsg     = 0x03

	// Timeouts
	SampleRequestTimeout = 5 * time.Second
	MaxSampleRetries     = 3

	// Limits
	MaxSamplesPerRequest  = 16
	MaxPendingRequests    = 64
	MaxSampleCacheSize    = 1024
	MaxSampleAge          = 1 * time.Hour
)

var (
	ErrRequestTimeout    = errors.New("sample request timed out")
	ErrPeerDisconnected  = errors.New("peer disconnected")
	ErrSampleNotFound    = errors.New("sample not found")
	ErrTooManyRequests   = errors.New("too many pending requests")
	ErrInvalidMessage    = errors.New("invalid protocol message")
)

// SampleRequest represents a request for data availability samples
type SampleRequest struct {
	RequestID   uint64      // Unique request identifier
	BlockNumber *big.Int    // Block number to sample
	BlockHash   common.Hash // Block hash for verification
	Indices     []uint64    // Sample indices being requested
}

// SampleResponse contains requested samples
type SampleResponse struct {
	RequestID uint64        // Corresponding request ID
	Samples   []*DataSample // Requested samples (may be partial)
	Error     string        // Error message if any samples unavailable
}

// SampleAnnouncement announces available samples to peers
type SampleAnnouncement struct {
	BlockNumber     *big.Int    // Block number
	BlockHash       common.Hash // Block hash
	AvailableShards []uint64    // Indices of available shards
	TotalShards     uint64      // Total number of shards
}

// SamplePush proactively sends samples to peers
type SamplePush struct {
	BlockNumber *big.Int      // Block number
	BlockHash   common.Hash   // Block hash
	Samples     []*DataSample // Samples being pushed
}

// PendingRequest tracks an outstanding sample request
type PendingRequest struct {
	Request   *SampleRequest
	Timestamp time.Time
	Retries   int
	Response  chan *SampleResponse
	PeerID    string
}

// SampleCache caches samples for quick retrieval
type SampleCache struct {
	mu      sync.RWMutex
	samples map[string]*CachedSample // key: blockHash:sampleIndex
	maxSize int
	maxAge  time.Duration
}

// CachedSample represents a cached data sample
type CachedSample struct {
	Sample    *DataSample
	CachedAt  time.Time
	AccessCount int
}

// NewSampleCache creates a new sample cache
func NewSampleCache() *SampleCache {
	return &SampleCache{
		samples: make(map[string]*CachedSample),
		maxSize: MaxSampleCacheSize,
		maxAge:  MaxSampleAge,
	}
}

// Put adds a sample to the cache
func (c *SampleCache) Put(sample *DataSample) {
	c.mu.Lock()
	defer c.mu.Unlock()

	key := c.makeKey(sample.DataHash, sample.SampleIndex)

	// Evict old entries if at capacity
	if len(c.samples) >= c.maxSize {
		c.evictOldest()
	}

	c.samples[key] = &CachedSample{
		Sample:      sample,
		CachedAt:    time.Now(),
		AccessCount: 0,
	}
}

// Get retrieves a sample from the cache
func (c *SampleCache) Get(dataHash common.Hash, index uint64) (*DataSample, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()

	key := c.makeKey(dataHash, index)
	cached, ok := c.samples[key]
	if !ok {
		return nil, false
	}

	// Check if expired
	if time.Since(cached.CachedAt) > c.maxAge {
		return nil, false
	}

	cached.AccessCount++
	return cached.Sample, true
}

// GetForBlock retrieves all cached samples for a block
func (c *SampleCache) GetForBlock(dataHash common.Hash) []*DataSample {
	c.mu.RLock()
	defer c.mu.RUnlock()

	samples := make([]*DataSample, 0)
	prefix := dataHash.Hex() + ":"

	for key, cached := range c.samples {
		if len(key) > len(prefix) && key[:len(prefix)] == prefix {
			if time.Since(cached.CachedAt) <= c.maxAge {
				samples = append(samples, cached.Sample)
			}
		}
	}

	return samples
}

// Delete removes a sample from the cache
func (c *SampleCache) Delete(dataHash common.Hash, index uint64) {
	c.mu.Lock()
	defer c.mu.Unlock()

	key := c.makeKey(dataHash, index)
	delete(c.samples, key)
}

// Clear clears all cached samples
func (c *SampleCache) Clear() {
	c.mu.Lock()
	defer c.mu.Unlock()

	c.samples = make(map[string]*CachedSample)
}

// Size returns the number of cached samples
func (c *SampleCache) Size() int {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return len(c.samples)
}

func (c *SampleCache) makeKey(dataHash common.Hash, index uint64) string {
	return dataHash.Hex() + ":" + big.NewInt(int64(index)).String()
}

func (c *SampleCache) evictOldest() {
	var oldestKey string
	var oldestTime time.Time

	for key, cached := range c.samples {
		if oldestKey == "" || cached.CachedAt.Before(oldestTime) {
			oldestKey = key
			oldestTime = cached.CachedAt
		}
	}

	if oldestKey != "" {
		delete(c.samples, oldestKey)
	}
}

// Protocol handles PeerDAS P2P protocol messages
type Protocol struct {
	peerdas         *PeerDAS
	cache           *SampleCache
	pendingRequests sync.Map // requestID -> *PendingRequest
	nextRequestID   uint64
	mu              sync.Mutex

	// Callbacks for network integration
	sendMessage func(peerID string, msgCode uint8, data interface{}) error
	getPeers    func() []string
}

// NewProtocol creates a new PeerDAS protocol handler
func NewProtocol(p *PeerDAS) *Protocol {
	return &Protocol{
		peerdas:       p,
		cache:         NewSampleCache(),
		nextRequestID: 1,
	}
}

// SetNetworkCallbacks sets the network integration callbacks
func (p *Protocol) SetNetworkCallbacks(
	sendMessage func(peerID string, msgCode uint8, data interface{}) error,
	getPeers func() []string,
) {
	p.sendMessage = sendMessage
	p.getPeers = getPeers
}

// RequestSamples requests specific samples from the network
func (p *Protocol) RequestSamples(blockNumber *big.Int, blockHash common.Hash, indices []uint64) ([]*DataSample, error) {
	if len(indices) == 0 {
		return nil, nil
	}
	if len(indices) > MaxSamplesPerRequest {
		return nil, errors.New("too many samples requested")
	}

	// Check cache first
	samples := make([]*DataSample, 0, len(indices))
	missingIndices := make([]uint64, 0)

	for _, idx := range indices {
		if sample, ok := p.cache.Get(blockHash, idx); ok {
			samples = append(samples, sample)
		} else {
			missingIndices = append(missingIndices, idx)
		}
	}

	// If all found in cache, return
	if len(missingIndices) == 0 {
		return samples, nil
	}

	// Create request
	p.mu.Lock()
	requestID := p.nextRequestID
	p.nextRequestID++
	p.mu.Unlock()

	request := &SampleRequest{
		RequestID:   requestID,
		BlockNumber: blockNumber,
		BlockHash:   blockHash,
		Indices:     missingIndices,
	}

	// Create pending request with response channel
	responseChan := make(chan *SampleResponse, 1)
	pending := &PendingRequest{
		Request:   request,
		Timestamp: time.Now(),
		Retries:   0,
		Response:  responseChan,
	}

	p.pendingRequests.Store(requestID, pending)
	defer p.pendingRequests.Delete(requestID)

	// Send to available peers
	if p.sendMessage != nil && p.getPeers != nil {
		peers := p.getPeers()
		if len(peers) > 0 {
			// Send to first available peer (could be enhanced to try multiple)
			peer := peers[0]
			pending.PeerID = peer
			if err := p.sendMessage(peer, SampleRequestMsg, request); err != nil {
				return nil, err
			}
		}
	}

	// Wait for response with timeout
	select {
	case response := <-responseChan:
		if response.Error != "" {
			return nil, errors.New(response.Error)
		}
		// Cache received samples
		for _, sample := range response.Samples {
			p.cache.Put(sample)
			samples = append(samples, sample)
		}
		return samples, nil

	case <-time.After(SampleRequestTimeout):
		return nil, ErrRequestTimeout
	}
}

// HandleSampleRequest processes an incoming sample request
func (p *Protocol) HandleSampleRequest(peerID string, request *SampleRequest) error {
	samples := make([]*DataSample, 0, len(request.Indices))
	var errMsg string

	for _, idx := range request.Indices {
		if sample, ok := p.cache.Get(request.BlockHash, idx); ok {
			samples = append(samples, sample)
		}
	}

	// If we don't have all samples, indicate partial response
	if len(samples) < len(request.Indices) {
		errMsg = "partial response - some samples unavailable"
	}

	response := &SampleResponse{
		RequestID: request.RequestID,
		Samples:   samples,
		Error:     errMsg,
	}

	if p.sendMessage != nil {
		return p.sendMessage(peerID, SampleResponseMsg, response)
	}
	return nil
}

// HandleSampleResponse processes an incoming sample response
func (p *Protocol) HandleSampleResponse(peerID string, response *SampleResponse) error {
	if pending, ok := p.pendingRequests.Load(response.RequestID); ok {
		pr := pending.(*PendingRequest)
		select {
		case pr.Response <- response:
		default:
			// Channel full, response already received
		}
	}
	return nil
}

// HandleSampleAnnouncement processes a sample availability announcement
func (p *Protocol) HandleSampleAnnouncement(peerID string, announcement *SampleAnnouncement) error {
	// Track which peers have which samples (for future requests)
	// This could be stored in a peer-sample availability map
	// For now, we just log/acknowledge the announcement
	return nil
}

// HandleSamplePush processes pushed samples from a peer
func (p *Protocol) HandleSamplePush(peerID string, push *SamplePush) error {
	// Cache the pushed samples
	for _, sample := range push.Samples {
		if err := p.peerdas.VerifySample(sample, nil); err == nil {
			p.cache.Put(sample)
		}
	}
	return nil
}

// AnnounceSamples announces available samples to peers
func (p *Protocol) AnnounceSamples(blockNumber *big.Int, blockHash common.Hash, indices []uint64) error {
	if p.sendMessage == nil || p.getPeers == nil {
		return nil
	}

	announcement := &SampleAnnouncement{
		BlockNumber:     blockNumber,
		BlockHash:       blockHash,
		AvailableShards: indices,
		TotalShards:     uint64(p.peerdas.erasureCoding.TotalShards()),
	}

	// Broadcast to all peers
	for _, peer := range p.getPeers() {
		p.sendMessage(peer, SampleAnnounceMsg, announcement)
	}

	return nil
}

// PushSamples proactively sends samples to peers
func (p *Protocol) PushSamples(peerID string, samples []*DataSample) error {
	if p.sendMessage == nil || len(samples) == 0 {
		return nil
	}

	push := &SamplePush{
		BlockNumber: samples[0].BlockNumber,
		BlockHash:   samples[0].DataHash,
		Samples:     samples,
	}

	return p.sendMessage(peerID, SamplePushMsg, push)
}

// StoreSamples stores samples in the local cache
func (p *Protocol) StoreSamples(samples []*DataSample) {
	for _, sample := range samples {
		p.cache.Put(sample)
	}
}

// GetCachedSamples returns cached samples for a block
func (p *Protocol) GetCachedSamples(blockHash common.Hash) []*DataSample {
	return p.cache.GetForBlock(blockHash)
}

// EncodeMessage encodes a protocol message for transmission
func EncodeMessage(msgCode uint8, data interface{}) ([]byte, error) {
	return rlp.EncodeToBytes(data)
}

// DecodeMessage decodes a protocol message
func DecodeMessage(msgCode uint8, data []byte) (interface{}, error) {
	switch msgCode {
	case SampleRequestMsg:
		var req SampleRequest
		if err := rlp.DecodeBytes(data, &req); err != nil {
			return nil, err
		}
		return &req, nil

	case SampleResponseMsg:
		var resp SampleResponse
		if err := rlp.DecodeBytes(data, &resp); err != nil {
			return nil, err
		}
		return &resp, nil

	case SampleAnnounceMsg:
		var ann SampleAnnouncement
		if err := rlp.DecodeBytes(data, &ann); err != nil {
			return nil, err
		}
		return &ann, nil

	case SamplePushMsg:
		var push SamplePush
		if err := rlp.DecodeBytes(data, &push); err != nil {
			return nil, err
		}
		return &push, nil

	default:
		return nil, ErrInvalidMessage
	}
}
