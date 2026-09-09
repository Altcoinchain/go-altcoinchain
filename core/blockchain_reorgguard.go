// Copyright 2026 The Altcoinchain Authors
// This file is part of the go-altcoinchain library.

package core

import (
	"errors"
	"fmt"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/consensus"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/log"
)

// Reorg-depth protection.
//
// Altcoinchain's proof-of-work is small enough that an attacker can rent more
// hashrate than the whole network for pocket change, mine a longer chain in
// private, and release it to rewrite history. Stock go-ethereum fork choice
// accepts that chain unconditionally, because it only compares total
// difficulty (see ForkChoice.ReorgNeeded).
//
// Two guards are applied here, at the one place where the common ancestor of
// the two chains is known:
//
//  1. A block finalized by the validator set is never reorgable, no matter how
//     much proof-of-work backs the competing chain. This is the real fix, and
//     it only bites once finality actually works end to end.
//
//  2. Until then, a depth limit. This is a LOCAL ACCEPTANCE POLICY, not a
//     consensus rule — it does not change block validity, so nodes running
//     different limits still agree on which blocks are valid. What it changes
//     is that an attacker can no longer mine in private and reveal later: to
//     move a guarded node they must stay ahead in the open, continuously, which
//     is a far more expensive and far more visible attack.
//
// The cost of (2) is that a node which legitimately needs a deep reorg will
// stop and require an operator to intervene. That is deliberate — on a chain
// this small, halting and being looked at is a better failure mode than
// silently accepting a rewrite. The staleness grace below keeps that cost off
// nodes that are merely catching up.

const (
	// DefaultReorgLimit is the suggested depth limit for Altcoinchain nodes.
	// Chosen to be far deeper than any reorg the network produces on its own,
	// while still being shallow enough that an attacker cannot rewrite a
	// meaningful amount of history. Pre-fork (~9s blocks) this is ~19 minutes
	// of chain; post-fork at 1s blocks it is ~2 minutes.
	DefaultReorgLimit = 128

	// DefaultReorgLimitGrace is how recent the local head must be for the depth
	// limit to apply. A node whose head is older than this is assumed to be
	// syncing rather than sitting at the tip.
	DefaultReorgLimitGrace = 10 * time.Minute
)

// ErrReorgTooDeep is returned when a chain reorganisation is refused because it
// runs deeper than the configured limit, or below a finalized block.
var ErrReorgTooDeep = errors.New("reorg refused")

// finalityOracle is implemented by consensus engines that can report a
// finalized height. core deliberately does not import the engine packages; the
// capability is discovered by type assertion, so engines without finality
// (plain ethash, clique) are unaffected and report nothing.
type finalityOracle interface {
	// FinalizedHeight returns the highest block number the engine considers
	// final, or 0 if the engine has finalized nothing.
	FinalizedHeight() uint64
}

// engineWrapper is implemented by engines that delegate to another engine
// underneath, such as consensus/beacon wrapping ethash or hybrid.
type engineWrapper interface {
	InnerEngine() consensus.Engine
}

// finalizedHeight reports the highest block the consensus engine considers
// finalized, unwrapping delegating engines. It returns 0 when the engine
// provides no finality, which disables the finality guard.
func (bc *BlockChain) finalizedHeight() uint64 {
	engine := bc.engine
	// Bounded so a pathological engine that wraps itself cannot spin here.
	for i := 0; i < 8 && engine != nil; i++ {
		if oracle, ok := engine.(finalityOracle); ok {
			return oracle.FinalizedHeight()
		}
		wrapper, ok := engine.(engineWrapper)
		if !ok {
			return 0
		}
		inner := wrapper.InnerEngine()
		if inner == nil || inner == engine {
			return 0
		}
		engine = inner
	}
	return 0
}

// checkReorgDepth decides whether a reorganisation dropping oldChain in favour
// of a competing chain may proceed. It is called once the common ancestor is
// known and before any state is mutated, so returning an error here aborts the
// reorg cleanly and the incoming block is rejected.
//
// oldChain is ordered head-first: oldChain[0] is the current head being
// discarded, and len(oldChain) is the reorg depth.
func (bc *BlockChain) checkReorgDepth(commonBlock *types.Block, oldChain types.Blocks) error {
	if len(oldChain) == 0 || commonBlock == nil {
		return nil
	}
	depth := uint64(len(oldChain))

	// Guard 1: finality is absolute. A finalized block represents a supermajority
	// of stake having committed to it, and unwinding it would let an attacker
	// with hashrate override the validator set. No staleness escape hatch applies
	// here: the engine only reports a non-zero finalized height while it is
	// actively following the chain, so a syncing node reports 0 and is unaffected.
	if finalized := bc.finalizedHeight(); finalized > 0 && commonBlock.NumberU64() < finalized {
		log.Error("Refusing reorg below finalized block",
			"finalized", finalized,
			"ancestor", commonBlock.NumberU64(),
			"depth", depth,
			"drop", oldChain[0].Hash())
		return fmt.Errorf("%w: common ancestor %d is below finalized block %d",
			ErrReorgTooDeep, commonBlock.NumberU64(), finalized)
	}

	limit := bc.cacheConfig.ReorgLimit
	if limit == 0 || depth <= limit {
		return nil
	}

	// Guard 2 is policy, so it must never strand a node that is simply behind.
	// A node catching up from far back legitimately sees deep reorgs; only
	// enforce the limit when our head is recent enough that we are plausibly at
	// the tip.
	grace := bc.cacheConfig.ReorgLimitGrace
	if grace == 0 {
		grace = DefaultReorgLimitGrace
	}
	if age := time.Since(time.Unix(int64(oldChain[0].Time()), 0)); age > grace {
		log.Warn("Allowing deep reorg, local head is stale",
			"depth", depth, "limit", limit, "headage", common.PrettyDuration(age))
		return nil
	}

	log.Error("Refusing deep chain reorg",
		"depth", depth,
		"limit", limit,
		"ancestor", commonBlock.NumberU64(),
		"drop", oldChain[0].Hash(),
		"hint", "if this reorg is legitimate, restart with --reorg.limit=0 to accept it")
	return fmt.Errorf("%w: depth %d exceeds limit %d (common ancestor %d)",
		ErrReorgTooDeep, depth, limit, commonBlock.NumberU64())
}
