# Altcoinchain Hybrid PoW/PoS Hard Fork — Block 7,200,000

**Every node operator must upgrade before block 7,200,000** (ETA ~September 7–8, 2026
at the current ~12.9s block pace). Nodes still on the old client at the fork block
will be rejected by upgraded peers (fork-ID change) and left on a dead chain.

## What activates at block 7,200,000

| Change | Detail |
|---|---|
| Hybrid PoW/PoS | Ethash miners keep producing blocks; validators with **32+ ALT** staked attest to them. 67% of online stake finalizes blocks. |
| 1-second blocks | One-shot 12x difficulty step-down at the fork, then a 1s-target retarget. Real block time ≈ 1–2s until network hashrate grows past ~130 kH/s, then ~1s. |
| Reward split | Total emission ≈ 0.16667 ALT/block (2 ALT / 12 — flat ALT-per-second vs today), split 50/50 between the PoW miner and the validator pool. |
| Slashing | Double-signing validators are slashed automatically via on-chain evidence (`slashWithEvidence`); honest nodes submit proofs themselves. |
| Shanghai EVM | PUSH0 (EIP-3855) activates — modern solc default targets deploy cleanly. |

Staking contract (already live on mainnet): `0x2e05FfB10eF99e3c8B2BE1b752D7D3D45E6AC2a7`
Staking dApp: https://altcoinchain.github.io/staking/ · Explorer: https://altcoinchain.github.io/explorer/

## Upgrade steps

Upgrading early is **safe and recommended** — the new client peers normally with old
clients until the fork block; verified live against a stock Geth/1.10.24 node.

```bash
# 1. Stop your node
systemctl stop altcoinchain   # or however you run geth

# 2. Back up your current binary
cp /path/to/geth /path/to/geth.pre-hybrid.bak

# 3. Arm the fork in your existing datadir (config-only update — the genesis
#    hash is unchanged (0x04e12d...2e299b), your chaindata is NOT touched)
./geth-alt-hybrid-linux-amd64 --datadir /path/to/datadir init genesis-hybrid-7200000.json

# 4. Replace your geth binary with geth-alt-hybrid-linux-amd64 and restart
systemctl start altcoinchain
```

## Verify after restart

```bash
# Boot log must show:
#   Hybrid PoW/PoS consensus scheduled  block=7,200,000  stakingContract=0x2e05FfB1...
# Stored config must show the fork:
curl -s -X POST -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"admin_nodeInfo","params":[]}' http://127.0.0.1:8545 \
  | grep -o '"hybridBlock":[0-9]*'
# -> "hybridBlock":7200000
```

Peers should reconnect within a minute. If you see `genesis mismatch` you inited the
wrong genesis file — only use the `genesis-hybrid-7200000.json` shipped with this release.

## For validators

Register any time **before** the fork to earn from block 7,200,000 onward:
32 ALT minimum self-stake at https://altcoinchain.github.io/staking/ (delegation also
open, 10 ALT minimum). Validator liveness requires attesting at least every 100 blocks —
the node does this automatically for any local keystore account that is a registered
validator; wallet-registered validators should keep their node's attestor running.

## Rollback (before the fork block only)

Re-init your datadir with the previous genesis (no `hybridBlock`) and restore the
backed-up binary. After block 7,200,000 there is no rollback — the fork is consensus.
