# Reorg-depth protection

Added 2026-08-17. Flags: `--reorg.limit` (default **128**), `--reorg.limitgrace` (default **10m**).

## Why

Altcoinchain's network hashrate is ~0.13 MH/s. A single consumer GPU is several hundred
times the entire network, so an attacker can mine a longer chain **in private** for the
price of some electricity and release it later to rewrite history. Stock go-ethereum
accepts that chain without question: `ForkChoice.ReorgNeeded` compares total difficulty
and nothing else.

This adds a check at the one place where the true depth of a reorg is known — after the
common ancestor is resolved in `BlockChain.reorg`, before any state is touched.

## What it does

**Guard 1 — finality.** A block the validator set has finalized is never unwound,
regardless of how much proof-of-work backs the competing chain. Discovered by type
assertion on the consensus engine (`FinalizedHeight()`), so engines without finality are
unaffected and plain ethash behaves exactly as before.

**Guard 2 — depth limit.** Reorgs deeper than `--reorg.limit` are refused while this node
is at the tip.

## What it is NOT

- **Not a consensus rule.** Block validity is unchanged. Nodes running different limits
  still agree on which blocks are valid, so this cannot partition the network the way a
  bad fork would. Rolling it out does not require coordinating with other operators.
- **Not protection against a live 51% attacker.** Someone who genuinely out-hashes the
  network continuously and in the open still wins. What this removes is the cheap version:
  mine in private, reveal later. The attack now has to be sustained and visible.
- **Not a replacement for real finality.** Guard 1 only bites once attestations actually
  reach quorum, and today's finality is derived from node-local gossip rather than block
  data. Making finality a true consensus rule needs attestations carried in the block —
  see `HYBRID_FINALITY_ENFORCEMENT_DESIGN.md`.

## Tuning

`--reorg.limit` is in **blocks**, so its meaning in wall-clock time changes at the hybrid
fork:

| | block time | 128 blocks |
|---|---|---|
| pre-fork | ~8.9s | ~19 minutes |
| post-fork (`Period=1`) | ~1s | ~2 minutes |

**Post-fork, consider raising it.** At 1s blocks a network partition lasting more than ~2
minutes produces a reorg deeper than the default, which the guard will refuse. On a
network with two or three operators that is a plausible event. A value in the 512–2048
range keeps the protection meaningful (a profitable double-spend needs to rewrite more
history than that) while tolerating short partitions.

`--reorg.limitgrace` stops the limit from applying when the local head is older than the
given duration, so a node syncing from far behind is never stranded. Note this does **not**
help a node that was mining its own fork — its head is fresh by definition.

## Failure mode and recovery

When the guard fires you get an `ERROR` log and the incoming chain is rejected:

```
Refusing deep chain reorg  depth=… limit=… ancestor=… 
  hint="if this reorg is legitimate, restart with --reorg.limit=0 to accept it"
```

The node keeps running on its current chain and stops following the competing one. That is
deliberate: on a chain this small, halting and being looked at is a better outcome than
silently accepting a rewrite.

**If the reorg is legitimate** (you were on a private fork, or the network genuinely
reorganised), restart with `--reorg.limit=0`, let the node converge, then restart with the
limit back on.

`debug.setHead` is **not** affected — `SetHead` has its own rewind path and does not go
through `reorg()`. The existing manual recovery procedure still works unchanged.

## Note on the past two incidents

The 2026-07-18 and 2026-08-01 fork incidents both involved a node mining a private chain in
isolation (12,498 blocks on 08-01) without anyone noticing for days. With this guard the
node would have refused to reconcile and logged an ERROR on the first attempt, surfacing
the split immediately instead of after the fact. That is the main practical benefit today —
ahead of any attacker.

## Rolling it out

Nothing has been deployed. The build is at `build/bin/geth-reorgguard`; the running
`geth-fusaka` / `geth` binaries were left untouched.

Because this is local policy and not a consensus rule, it can go on **one node at a time**
and needs no coordination with minethepla.

```bash
# 1. back up the binary currently in use
cp ~/Documents/go-altcoinchain_FUSAKA/build/bin/geth-fusaka{,.pre-reorgguard.bak}

# 2. stop the node (it holds the datadir lock)
systemctl --user stop altcoinchain

# 3. swap in the new build
cp ~/Documents/go-altcoinchain_FUSAKA/build/bin/geth-reorgguard \
   ~/Documents/go-altcoinchain_FUSAKA/build/bin/geth-fusaka

# 4. add the flag to ExecStart in
#    ~/.config/systemd/user/altcoinchain.service   e.g.  --reorg.limit 128
systemctl --user daemon-reload && systemctl --user start altcoinchain

# 5. confirm
journalctl --user -u altcoinchain -n 50 | grep -i "hybrid\|reorg"
```

Rollback is the reverse: stop, restore the `.pre-reorgguard.bak` binary, start.

**Two cautions specific to this setup:**

- Restarting geth takes the only attesting validator (`0xe59bb48f…`) offline while it is
  down, because `attest.sh` talks to the local node. The contract's `ACTIVITY_THRESHOLD` is
  100 blocks — about 15 minutes pre-fork, but only ~100 seconds once `Period=1s` lands.
  Do the swap **before** the fork, not after, and check the validator is back online
  afterwards.
- No genesis re-init is needed. This changes no chain rules, so the datadir is untouched
  and the stored config (`hybridBlock: 7200000`) is unaffected.

## Known gaps

**The header chain is not guarded.** `HeaderChain.Reorg` (`core/headerchain.go:136`) is a
separate path used during header-first/fast sync and does not route through
`BlockChain.reorg`, so it is unprotected. This is acceptable for the nodes on this network
today — they run `--syncmode full`, where chain adoption goes through
`InsertChain → writeBlockAndSetHead → reorg` and is guarded — but a node doing fast sync
could have its header chain deeply reorganised. Extending the guard into `HeaderChain.Reorg`
is a sensible follow-up; it was left out here because header sync is delicate and the
change wanted more review than one sitting.

**Finality is still node-local.** Guard 1 reads the engine's finalized height, which today
is computed from gossiped attestations held in memory. Two nodes can briefly disagree. That
is safe for *refusing* a reorg (worst case a node stops and wants attention) but it is not
enough to make finality a consensus rule.

**Three validators, one attesting.** Guard 1 does nothing at all until attestations reach
the 67% threshold. Right now they do not, so only the depth limit is doing any work.

## Verification

`core/blockchain_reorgguard_test.go` — 7 tests covering: deep reorg refused, shallow reorg
still applied, disabled-by-zero preserves stock behaviour, stale head bypasses the limit,
finality overrides the depth limit, finality found through a delegating (beacon-style)
engine, and plain ethash reporting no finality.

Mutation-checked: neutering `checkReorgDepth` fails exactly the three refusal tests and
nothing else, so the tests genuinely exercise the guard.

Pre-existing failures in `core` (`TestSetupGenesis`, `TestGenesisHashes`) are unrelated —
they fail identically on a clean tree because this fork carries a custom genesis.
