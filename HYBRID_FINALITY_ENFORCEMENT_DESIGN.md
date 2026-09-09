# Block-carried attestations & enforced finality

Status: **design, not built** — scoped 2026-08-17
Target: a **second** hard fork, after `HybridBlock = 7_200_000`

---

## 1. The problem

PoS finality is computed and then ignored. Staking currently provides **no protection
against a 51% PoW reorg**, at any stake size.

Evidence in this tree:

| Fact | Location |
|---|---|
| `CheckFinality` runs, reaches 67%, logs "Block finalized" | `consensus/hybrid/hybrid.go:422` |
| `CanReorg()` — written for exactly this purpose | `consensus/hybrid/finality.go:210` |
| …has **zero callers** | `grep -rn CanReorg --include=*.go .` |
| `core/` never references `FinalityTracker` / `IsFinalized` / `lastFinalized` | — |
| Fork choice is stock total-difficulty | `core/forkchoice.go:77`, `core/blockchain.go:1350,1498` |
| RPC returns a hardcoded stub | `eth/validator_api.go:179` (`IsFinalized: false, // Would check hybrid engine`) |

A miner with >50% of ~0.13 MH/s reorgs straight through "finalized" blocks.

## 2. Why the one-line fix is wrong

Wiring `CanReorg` into `ReorgNeeded` as-is **causes netsplits**.

Finality today is derived from node-local state: attestations live in an in-memory LRU
(`hybrid.go:106 attestations *lru.Cache`), `core/types` has no attestation field, and an
LRU does not survive a restart. Two nodes therefore hold different attestation sets and
compute different finalized heights. Node A refuses a reorg node B accepts → partition.

This is the same failure mode already diagnosed and correctly avoided for slashing
(`hybrid.go:292-301`): node-local state must never drive consensus. The fix is the same
shape the author already wrote down at `hybrid.go:297` — **carry the evidence in the block**.

## 3. Design

### 3.1 Header commitment

```go
// core/types/block.go — Header, appended AFTER DataShardCount
AttestationsHash common.Hash `json:"attestationsRoot" rlp:"optional"`
```

Follows the PeerDAS precedent already in this tree: trailing `rlp:"optional"`, zero-valued
pre-fork, so **legacy header hashes are unchanged** and fork IDs are untouched until
activation.

> **RLP gotcha:** optional fields must be trailing, and setting a later one forces every
> preceding optional field to be encoded. Post-fork, a non-zero `AttestationsHash` means
> `BaseFee`, `DataRoot`, `BlobHash`, `ShardCount`, `DataShardCount` are all encoded (as
> zero where unset). That is fine, but it must happen identically on every node at the
> exact same height, so it is fork-gated, not version-gated.

### 3.2 Body payload

```go
// core/types/block.go — Body
Attestations []*Attestation `rlp:"optional"`
```

Pre-fork bodies stay 2-element and decode unchanged. `AttestationsHash =
DeriveSha(Attestations(list), hasher)`, mirroring `TxHash` (`block.go:205`).

`Attestation` already RLP-encodes and self-verifies via signature recovery
(`consensus/hybrid/attestation.go:28-107`) — no new crypto, and `SigningHash()` keeps its
packed form so the staking contract's `slashWithEvidence` still verifies the same digest.

### 3.3 What a block attests to

A block cannot attest itself (circular hash). Block `N` carries attestations for heights
`[N-W, N-1]`, where `W = Config.AttestationWindow` (already 32).

### 3.4 Validity rules (all consensus-critical, all deterministic)

For each attestation in block `N`:

1. `len(Signature) == 65` and `RecoverValidator() == Validator`.
2. `Validator` is `Active` in the validator set **at a pinned state** — see §3.5.
3. `N-W <= BlockNumber <= N-1`.
4. `BlockHash` equals this chain's canonical ancestor hash at `BlockNumber`.
5. No duplicate `(Validator, BlockNumber)` pair anywhere in the block — otherwise stake
   double-counts and the threshold is forgeable.
6. Total count `<= MaxAttestationsPerBlock` (DoS / block-size bound).
7. `header.AttestationsHash == DeriveSha(body.Attestations)`.

Violation ⇒ reject the block. Identical inputs on every node ⇒ identical verdict.

### 3.5 The denominator must be pinned

`GetTotalStake()` (`hybrid.go:500`) sums the live validator set, which changes as
validators register, unregister, or are slashed. If the denominator is read "now", two
nodes processing the same block at different times can disagree.

**Rule:** both numerator and denominator are evaluated against the validator set as of the
state at the **attested** block `h`, not at the carrying block `N`. That state is already
committed by `header.Root` at `h`, so it is unambiguous and reproducible during replay.

### 3.6 Deterministic finalized height

After importing block `N`, for each `h` in `[N-W, N-1]`: sum the stake of validators that
attested `h` across all blocks in the window, divide by total active stake at `h`, and
finalize when `>= FinalityThreshold` (67).

Because the window is bounded, `finalizedHeight` is recomputable by walking back `W`
blocks from any head — it needs no persisted side-state and survives a restart. Persist it
in `rawdb` as a cache only, never as the source of truth.

### 3.7 Enforcement points

| Site | Change |
|---|---|
| `core/forkchoice.go:77 ReorgNeeded` | cheap reject when `header.Number < finalizedHeight` |
| `core/blockchain.go:2001 reorg` | authoritative check — the common ancestor is computed here; refuse if it is below `finalizedHeight` |
| `core/blockchain.go:506 SetHead` | refuse rewinding below `finalizedHeight` (except explicit operator override) |
| header/fast sync paths | same guard, so a long fake chain is rejected at the header stage |
| `eth/validator_api.go:179` | return the real value instead of the `false` stub |

A peer serving a chain that conflicts with a finalized block should be dropped.

## 4. This cannot ride the 7,200,000 fork

`HybridBlock = 7_200_000` is armed, released, and present in the stored chain config of
every synced node. `params/config.go:795` runs `isForkIncompatible` on it, so changing it
throws a fork-compat error on already-synced nodes.

These are new block-validity rules ⇒ a **new fork block**, e.g. `HybridFinalityBlock`, set
far enough out to coordinate with minethepla (the only other operator). Attempting to fold
it into 7.2M means re-coordinating the existing fork, and 7.2M is ~15 days away.

## 5. Prerequisite: the validator set

Block-carried attestations enforce nothing while nothing reaches quorum.

Current state: **3 registered validators, 1 attesting** → 32/96 = 33% vs 67% required.
Nothing finalizes, `finalizedHeight` stays 0, and the reorg guard never binds. Fixing
liveness (N ≥ 4, ideally 7 — see the finality model in the project notes) is a hard
prerequisite, not parallel work.

## 6. Work breakdown

| Area | Est. LOC | Risk |
|---|---|---|
| `core/types`: header field, body field, derive root, gencodec regen | ~100 | med — touches consensus encoding |
| `consensus/hybrid`: assemble set, verify rules §3.4, deterministic finality §3.6 | ~400 | med |
| miner: drain gossip pool into body (gossip becomes transport, block becomes record) | ~80 | low |
| `core`: enforcement §3.7 | ~200 | **high** — touches reorg, SetHead, sync |
| `eth`: body encoding across the fork | ~120 | med |
| `params`: `HybridFinalityBlock` + gating | ~40 | low |
| tests: unit + devnet deep-reorg attempt | ~400 | — |

≈1,300 LOC of consensus-critical code. The `core/` enforcement is the dangerous part: a
bug there halts the chain or partitions it, and both failure modes are worse than the
attack being defended against.

**Existing work is reused, not discarded.** The gossip layer (`NewAttestationMsg = 0x11`,
`eth/handler_attestation.go`, `eth/hybrid_attestor.go`) stays as the transport that feeds
the miner's attestation pool. `Attestation`, `SigningHash`, `FinalityTracker` and
`CanReorg` all survive — `CanReorg` finally acquires a caller.

## 7. Acceptance test

A 3-node devnet where one node has >50% of hashrate, mines a private chain from below the
finalized height, and rejoins. The honest nodes must **reject** it despite its higher total
difficulty, and must not partition from each other. That test failing today is the whole
point of this document.
