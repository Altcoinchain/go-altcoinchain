// Copyright 2026 The Altcoinchain Authors
// This file is part of the go-altcoinchain library.

package core

import (
	"errors"
	"math/big"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/consensus"
	"github.com/ethereum/go-ethereum/consensus/ethash"
	"github.com/ethereum/go-ethereum/core/rawdb"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/core/vm"
	"github.com/ethereum/go-ethereum/params"
)

// finalizingFaker is an ethash faker that also reports a fixed finalized height,
// standing in for the hybrid engine's validator-attested finality.
type finalizingFaker struct {
	consensus.Engine
	finalized uint64
}

func (f *finalizingFaker) FinalizedHeight() uint64 { return f.finalized }

// wrappingEngine mimics consensus/beacon: it delegates to an inner engine and is
// itself not a finality oracle, so the guard must unwrap it to find finality.
type wrappingEngine struct {
	consensus.Engine
	inner consensus.Engine
}

func (w *wrappingEngine) InnerEngine() consensus.Engine { return w.inner }

// buildForkedChains creates a canonical chain of `canonLen` blocks and a heavier
// competing chain that branches from the genesis block, so that importing the
// competing chain forces a reorg `canonLen` blocks deep.
//
// Generated blocks carry old timestamps, so each test pins behaviour with an
// explicit ReorgLimitGrace rather than depending on the wall clock: a huge grace
// exercises the depth check, a tiny one exercises the stale-head bypass.
func buildForkedChains(t *testing.T, engine consensus.Engine, cfg *CacheConfig, canonLen, forkLen int) (*BlockChain, types.Blocks) {
	t.Helper()

	db := rawdb.NewMemoryDatabase()
	genesis := (&Genesis{BaseFee: big.NewInt(params.InitialBaseFee)}).MustCommit(db)

	chain, err := NewBlockChain(db, cfg, params.AllEthashProtocolChanges, engine, vm.Config{}, nil, nil)
	if err != nil {
		t.Fatalf("failed to create blockchain: %v", err)
	}
	t.Cleanup(chain.Stop)

	// Canonical chain: default difficulty.
	canon, _ := GenerateChain(params.AllEthashProtocolChanges, genesis, engine, db, canonLen, func(i int, b *BlockGen) {
		b.SetCoinbase(testAddr(1))
	})
	if _, err := chain.InsertChain(canon); err != nil {
		t.Fatalf("failed to insert canonical chain: %v", err)
	}
	if have, want := chain.CurrentBlock().NumberU64(), uint64(canonLen); have != want {
		t.Fatalf("canonical head = %d, want %d", have, want)
	}

	// Competing chain from genesis. OffsetTime(-9) raises difficulty per block,
	// so a chain of equal or greater length outweighs the canonical one.
	forkDB := rawdb.NewMemoryDatabase()
	(&Genesis{BaseFee: big.NewInt(params.InitialBaseFee)}).MustCommit(forkDB)
	fork, _ := GenerateChain(params.AllEthashProtocolChanges, genesis, engine, forkDB, forkLen, func(i int, b *BlockGen) {
		b.SetCoinbase(testAddr(2))
		b.OffsetTime(-9)
	})
	return chain, fork
}

func testAddr(n byte) (a [20]byte) {
	a[19] = n
	return a
}

// insertExpectingRefusal imports the competing chain and asserts the guard
// rejected it and that the canonical head is untouched.
func insertExpectingRefusal(t *testing.T, chain *BlockChain, fork types.Blocks, headBefore uint64) {
	t.Helper()
	_, err := chain.InsertChain(fork)
	if err == nil {
		t.Fatalf("deep reorg was accepted; expected it to be refused")
	}
	if !errors.Is(err, ErrReorgTooDeep) {
		t.Fatalf("got error %v, want ErrReorgTooDeep", err)
	}
	if have := chain.CurrentBlock().NumberU64(); have != headBefore {
		t.Fatalf("head moved to %d after a refused reorg, want %d", have, headBefore)
	}
}

// A reorg deeper than the limit must be refused, even though the competing
// chain carries more total difficulty. This is the 51%-attack case.
func TestReorgGuardRefusesDeepReorg(t *testing.T) {
	engine := ethash.NewFaker()
	cfg := &CacheConfig{
		TrieCleanLimit:  256,
		TrieDirtyLimit:  256,
		TrieTimeLimit:   5 * time.Minute,
		SnapshotLimit:   256,
		SnapshotWait:    true,
		ReorgLimit:      4,
		ReorgLimitGrace: 100 * 365 * 24 * time.Hour, // never "stale" during the test
	}
	chain, fork := buildForkedChains(t, engine, cfg, 12, 12)
	insertExpectingRefusal(t, chain, fork, 12)
}

// A reorg within the limit must still be applied — the guard must not break
// normal chain operation.
func TestReorgGuardAllowsShallowReorg(t *testing.T) {
	engine := ethash.NewFaker()
	cfg := &CacheConfig{
		TrieCleanLimit:  256,
		TrieDirtyLimit:  256,
		TrieTimeLimit:   5 * time.Minute,
		SnapshotLimit:   256,
		SnapshotWait:    true,
		ReorgLimit:      64,
		ReorgLimitGrace: 100 * 365 * 24 * time.Hour,
	}
	chain, fork := buildForkedChains(t, engine, cfg, 8, 8)
	if _, err := chain.InsertChain(fork); err != nil {
		t.Fatalf("shallow reorg was refused: %v", err)
	}
	if chain.CurrentBlock().Hash() != fork[len(fork)-1].Hash() {
		t.Fatalf("shallow reorg did not take effect")
	}
}

// ReorgLimit == 0 must preserve stock go-ethereum behaviour exactly.
func TestReorgGuardDisabledByDefault(t *testing.T) {
	engine := ethash.NewFaker()
	cfg := &CacheConfig{
		TrieCleanLimit: 256,
		TrieDirtyLimit: 256,
		TrieTimeLimit:  5 * time.Minute,
		SnapshotLimit:  256,
		SnapshotWait:   true,
		ReorgLimit:     0,
	}
	chain, fork := buildForkedChains(t, engine, cfg, 12, 12)
	if _, err := chain.InsertChain(fork); err != nil {
		t.Fatalf("reorg refused with the guard disabled: %v", err)
	}
	if chain.CurrentBlock().Hash() != fork[len(fork)-1].Hash() {
		t.Fatalf("reorg did not take effect with the guard disabled")
	}
}

// A node whose head is stale is assumed to be catching up, and must not be
// stranded by the depth limit.
func TestReorgGuardStaleHeadBypassesLimit(t *testing.T) {
	engine := ethash.NewFaker()
	cfg := &CacheConfig{
		TrieCleanLimit:  256,
		TrieDirtyLimit:  256,
		TrieTimeLimit:   5 * time.Minute,
		SnapshotLimit:   256,
		SnapshotWait:    true,
		ReorgLimit:      4,
		ReorgLimitGrace: time.Nanosecond, // everything looks stale
	}
	chain, fork := buildForkedChains(t, engine, cfg, 12, 12)
	if _, err := chain.InsertChain(fork); err != nil {
		t.Fatalf("reorg refused despite a stale head: %v", err)
	}
}

// Finality outranks the depth limit: a reorg below a finalized block is refused
// even when it is shallow enough that the depth limit would have permitted it.
func TestReorgGuardRefusesBelowFinalized(t *testing.T) {
	engine := &finalizingFaker{Engine: ethash.NewFaker(), finalized: 10}
	cfg := &CacheConfig{
		TrieCleanLimit:  256,
		TrieDirtyLimit:  256,
		TrieTimeLimit:   5 * time.Minute,
		SnapshotLimit:   256,
		SnapshotWait:    true,
		ReorgLimit:      1000, // depth limit would allow this reorg
		ReorgLimitGrace: 100 * 365 * 24 * time.Hour,
	}
	chain, fork := buildForkedChains(t, engine, cfg, 12, 12)
	insertExpectingRefusal(t, chain, fork, 12)
}

// The guard must find finality through a delegating engine (as consensus/beacon
// wraps the real engine in production), not just on a bare one.
func TestReorgGuardUnwrapsDelegatingEngine(t *testing.T) {
	inner := &finalizingFaker{Engine: ethash.NewFaker(), finalized: 10}
	engine := &wrappingEngine{Engine: ethash.NewFaker(), inner: inner}
	cfg := &CacheConfig{
		TrieCleanLimit:  256,
		TrieDirtyLimit:  256,
		TrieTimeLimit:   5 * time.Minute,
		SnapshotLimit:   256,
		SnapshotWait:    true,
		ReorgLimit:      1000,
		ReorgLimitGrace: 100 * 365 * 24 * time.Hour,
	}
	chain, fork := buildForkedChains(t, engine, cfg, 12, 12)
	insertExpectingRefusal(t, chain, fork, 12)
}

// An engine with no finality at all must leave fork choice untouched.
func TestFinalizedHeightZeroForPlainEngine(t *testing.T) {
	db := rawdb.NewMemoryDatabase()
	(&Genesis{BaseFee: big.NewInt(params.InitialBaseFee)}).MustCommit(db)
	chain, err := NewBlockChain(db, nil, params.AllEthashProtocolChanges, ethash.NewFaker(), vm.Config{}, nil, nil)
	if err != nil {
		t.Fatalf("failed to create blockchain: %v", err)
	}
	defer chain.Stop()

	if got := chain.finalizedHeight(); got != 0 {
		t.Fatalf("plain ethash reported finalized height %d, want 0", got)
	}
}
