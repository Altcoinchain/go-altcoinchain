# Altcoinchain — Lachesis + Fusaka hybrid PoW/PoS upgrade

Design of record. Branch `lachesis-hybrid`. Started 2026-07-23.

Goal: 1-second blocks on Altcoinchain (chainId 2330) by adopting Sonic Labs'
Lachesis aBFT consensus for ordering and finality, while keeping the existing
PoW miners earning, shipped as a new client release that activates at a
hardfork block on the existing network.

---

## 1. The decision that cannot be avoided

**Only one mechanism can order the chain.** Lachesis gives absolute aBFT
finality in ~1s. PoW gives probabilistic ordering by accumulated work. If both
could extend the chain, they would produce contradictory histories — this is not
an implementation bug that can be patched out, it is the definition of a
consensus fault.

**Chosen architecture: Lachesis orders and finalizes. PoW issues and anchors.**

| Layer | Owner | Responsibility |
|---|---|---|
| Ordering + finality | Lachesis (validators) | event DAG → deterministic total order → 1s blocks |
| Issuance + anchoring | PoW (miners) | miners keep earning ALT; anchors bind PoW work to finalized state |
| Staking / validator set | existing `ValidatorStaking` @ `0x347F496c887a92ed9706ff3EDF4f0b822Ab00d3E` | who validates, stake weights, slashing |

What PoW **stops** doing: deciding which chain is canonical. This is the real
trade and it must be stated plainly in the release notes. Miners are paid and
their work is recorded, but a PoW block no longer overrides validator ordering.

Rejected alternative — "PoW orders, PoS finalizes checkpoints, at 1s": ethash at
a 1s target is unsafe on a real network. Block propagation is a large fraction of
a second, so orphan rates and reorg depth explode. The 2026-07-11 devnet did
produce ~1s ethash blocks, but that was two nodes on one box and says nothing
about propagation.

## 2. Feasibility — measured, not assumed (2026-07-23)

- `lachesis-base-sonic` is **13,223 LOC** (non-test). It is a library designed for
  embedding, not a monolith: `abft` (election/frames/atropos), `vecfc` (vector
  clocks), `kvdb`, `inter`, `emitter`, `eventcheck`.
- Its integration contract is small (`lachesis/consensus.go`):
  ```go
  type Consensus interface {
      Process(e dag.Event) error       // ingest a peer event
      Build(e dag.MutableEvent) error  // stamp our own event before emission
      Reset(epoch idx.Epoch, validators *pos.Validators) error
  }
  // host side:
  BeginBlock(*Block) -> BlockCallbacks{ ApplyEvent(dag.Event), EndBlock() *pos.Validators }
  ```
  The host feeds events in and gets a deterministically ordered stream back.
  Building an ALT block from that stream is the whole job.
- **Dependency hazard (resolved):** `lachesis-base-sonic` requires
  `go-ethereum v1.15.0`, but this tree *is* `github.com/ethereum/go-ethereum` at
  1.10.24-era code. Go resolves the main module first, so Lachesis's geth imports
  would bind to *our* tree, not v1.15.0. Measured surface: only **4 packages
  across 14 files** — `common` (12), `rlp` (6), `ethdb` (1), `common/hexutil` (1).
  All are geth's most stable APIs, and all six `ethdb` interfaces it embeds
  (`Iterator`, `KeyValueWriter`, `KeyValueReader`, `KeyValueStater`,
  `AncientStater`, `Compacter`) are **already present** in this tree.
  → Vendoring is viable. A full geth rebase is NOT required for Lachesis.

## 3. What already exists and is reused

From the hybrid work (devnet-proven 2026-07-11, commits 7c58ca31e / 4e7dda786 /
dea0f1cf5):
- `eth/hybrid_validator_updater.go` — reads `getAllValidators()` / `getValidator()`
  from the staking contract at head state. This maps directly onto Lachesis's
  `pos.Validators` (address + stake weight). **Reuse as the epoch validator source.**
- `consensus/hybrid/systemcall.go` — reward path that value-CALLs the staking
  contract so `receive()` → `_distributeRewards()` actually runs.
- `eth/hybrid_attestor.go` — attestation duty loop. **Superseded** by Lachesis
  event emission; attestation-for-liveness becomes event emission itself.
- `consensus/hybrid/slashing.go` — slashing conditions; re-target at Lachesis
  equivocation (two events at the same seq by one validator) which is DAG-detectable.

## 4. Staged plan

Each milestone must build and be independently testable. No milestone is allowed
to touch mainnet.

- **M1 — vendor + compile.** Import `lachesis-base` into the tree under a rewritten
  module path; get `go build ./...` green. Deliverable: it compiles, tests pass.
- **M2 — event layer.** Port/author the ALT event type (`inter`-equivalent), event
  RLP, signature, and the p2p messages to gossip events. Deliverable: two nodes
  exchange events on a devnet.
- **M3 — ordering → blocks.** Implement `BeginBlock`/`ApplyEvent`/`EndBlock` to
  assemble an ALT block from the ordered event stream, executing txs through the
  existing `core`/EVM so all current RPC and tooling keep working unchanged.
  Deliverable: devnet produces 1s blocks with real txs, two nodes agree on head.
- **M4 — validator set + epochs.** Wire `hybrid_validator_updater` into
  `Reset(epoch, validators)`; epoch sealing on `EndBlock`. Deliverable: register a
  validator via the live staking contract on devnet, see it enter the set.
- **M5 — PoW anchor.** Define the anchor: miners submit ethash solutions over the
  finalized block hash; anchors are recorded and rewarded, and do NOT affect
  ordering. Deliverable: miner earns on devnet without influencing head.
- **M6 — Fusaka bundle.** Fold in the EVM work in the same fork: PUSH0 is already
  back-ported; add EIP-1153 (TSTORE/TLOAD), MCOPY, BLOBHASH as scoped.
- **M7 — handover + release.** State snapshot at the fork block, fork-ID bump,
  release binaries, coordinated upgrade.

## 5. The handover (this is a Merge, in miniature)

PoW history cannot be retrofitted into a DAG. At `LachesisBlock`:
1. The last PoW block N is final by fiat; its state root is the genesis state of
   the Lachesis chain.
2. Blocks N+1.. are produced by Lachesis ordering. Ancestry and all history
   before N are preserved and remain queryable — no state migration for users,
   no address or balance changes.
3. `TerminalTotalDifficulty` semantics are reused as the switch guard.

## 6. Rollout constraints — non-negotiable

- **Every node must upgrade before the fork block or the network partitions.**
  Fork-ID changes at activation; unupgraded nodes reject upgraded peers'
  handshakes. Empirically confirmed 2026-07-11: fork ID flips
  `6bb305a2 → 3f88707f` at the boundary.
- The live network is currently **two operators** (nuts + minethepla @
  62.72.177.111). Coordination is a prerequisite, not a formality.
- `HybridBlock = 7_000_000` in `params/config.go` is a **placeholder** and lands
  ~2026-08-07. It MUST be moved before any rollout. `LachesisBlock` needs a date
  chosen with the other operator, not derived from the old placeholder.
- The staking contract is deployed on mainnet, but **0 validators are registered**.
  A validator set must exist and be online before Lachesis can order anything —
  otherwise the chain halts at activation. Bootstrap plan required: a minimum
  viable validator set, and a documented fallback if quorum is lost.
- 2026-07-23 incident is directly relevant: a node silently forked for 5 days
  because it had 0 peers and kept mining. Under Lachesis, loss of quorum halts
  the chain instead of forking it — safer, but it *does* halt. The bootstrap and
  recovery story must be written before mainnet, not after.

## 7. Open questions

- Anchor reward split: what fraction of issuance goes to miners vs validators
  after the fork? Governance decision, not a technical one.
- Does the ALT community accept PoW losing ordering authority? This must be
  socialized before release, not discovered at the fork block.
- Epoch length and validator-set churn rate for a network this small.
- Minimum validator count for safe aBFT (Lachesis needs >2/3 honest stake;
  with very few validators, one offline validator can stall the chain).
