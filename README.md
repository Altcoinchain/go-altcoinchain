# Go Altcoinchain

Official Golang implementation of the Altcoinchain protocol - a hybrid PoW/PoS blockchain.

## Network Information

| Parameter | Value |
|-----------|-------|
| **Chain ID** | 2330 |
| **Network ID** | 2330 |
| **P2P Port** | 31303 |
| **RPC Port** | 8332 |
| **WebSocket Port** | 8333 |
| **Consensus** | Hybrid PoW/PoS (Ethash + Staking) |
| **Hybrid fork** | Block 7,200,000 |
| **Block Time** | ~1 second target (post-fork) |
| **Block reward** | 0.166666666 ALT — split 1:1 between PoW miner and PoS validators |
| **Staking contract** | `0x2e05FfB10eF99e3c8B2BE1b752D7D3D45E6AC2a7` (ValidatorStaking v3.1) |
| **Explorer** | https://altscan.io |
| **Ethstats** | https://alt-stat.outsidethebox.top |

> **Running a node from before block 7,200,000?** A datadir initialised with a
> pre-fork `genesis.json` has no `hybridBlock` in its stored chain config, so it
> applies pure-ethash rules, rejects block 7,200,000 and stops there. Re-run
> `geth --datadir <dir> init genesis.json` with the current genesis. This only
> rewrites the config — your chain data is kept — and it must print
> `hash=04e12d..2e299b`. If it prints anything else, stop: you have the wrong
> genesis file and will build a separate chain.

## Quick Start (Pre-built Binaries)

### Linux

```bash
# Download latest release
wget https://github.com/nucash-mining/go-altcoinchain_FUSAKA/releases/download/v1.1.2/altcoinchain-v1.1.2-linux-amd64.tar.gz

# Extract
tar -xzf altcoinchain-v1.1.2-linux-amd64.tar.gz
cd altcoinchain-v1.1.2-linux-amd64

# Make executable
chmod +x geth bootnode clef

# Initialize genesis (first time only)
./geth --datadir ~/.altcoinchain init genesis.json

# Start node
./geth --datadir ~/.altcoinchain \
  --networkid 2330 \
  --port 31303 \
  --http --http.addr 127.0.0.1 --http.port 8332 \
  --http.api eth,net,web3,personal,miner,txpool,debug \
  --http.corsdomain "*" \
  --ws --ws.addr 127.0.0.1 --ws.port 8333 \
  --ws.api eth,net,web3,personal,miner,txpool \
  --ws.origins "*" \
  --bootnodes "enode://9355a3870bb3c7882a51797c6633380359c827febdbd89c87c0ff72914b351caf1642e5326ba78532f249082aad7c08d524cd418514865a49f8a5bca200ecbba@154.12.237.243:30303,enode://926900ccd1e2f218ce0d3c31f731eb1af1be60049624db9a01fa73588157f3fb7fd04c5f0874ca7cc030ab79d836c1961c3ef67aefe09f352e8a7aba03d3cdbf@154.12.237.243:30304,enode://c2e73bd6232c73ab7887d92aa904413597638ebf935791ca197bdd7902560baa7a4e8a1235b6d10d121ffc4602373476e7daa7d20d326466a5ae423be6581707@99.248.100.186:31303" \
  --ethstats=YourNodeName:alt@alt-stat.outsidethebox.top \
  --syncmode snap \
  --gcmode full \
  --maxpeers 50 \
  --cache 512
```

### Windows

```powershell
# Download and extract altcoinchain-v1.1.2-windows-amd64.zip
# Open PowerShell in the extracted directory

# Initialize genesis (first time only)
.\geth.exe --datadir %USERPROFILE%\.altcoinchain init genesis.json

# Start node
.\geth.exe --datadir %USERPROFILE%\.altcoinchain --networkid 2330 --port 31303 --http --http.addr 127.0.0.1 --http.port 8332 --http.api eth,net,web3,personal,miner,txpool,debug --ws --ws.addr 127.0.0.1 --ws.port 8333 --ws.api eth,net,web3,personal,miner,txpool --bootnodes "enode://9355a3870bb3c7882a51797c6633380359c827febdbd89c87c0ff72914b351caf1642e5326ba78532f249082aad7c08d524cd418514865a49f8a5bca200ecbba@154.12.237.243:30303,enode://926900ccd1e2f218ce0d3c31f731eb1af1be60049624db9a01fa73588157f3fb7fd04c5f0874ca7cc030ab79d836c1961c3ef67aefe09f352e8a7aba03d3cdbf@154.12.237.243:30304,enode://c2e73bd6232c73ab7887d92aa904413597638ebf935791ca197bdd7902560baa7a4e8a1235b6d10d121ffc4602373476e7daa7d20d326466a5ae423be6581707@99.248.100.186:31303" --ethstats=YourNodeName:alt@alt-stat.outsidethebox.top --syncmode snap --maxpeers 50 --cache 512
```

## Report Your Node to Ethstats

Add the `--ethstats` flag to report your node to the network stats page:

```bash
--ethstats=YourNodeName:alt@alt-stat.outsidethebox.top \
```

Your node will appear at: https://alt-stat.outsidethebox.top

## Bootnodes

Current active bootnodes:

```
enode://9355a3870bb3c7882a51797c6633380359c827febdbd89c87c0ff72914b351caf1642e5326ba78532f249082aad7c08d524cd418514865a49f8a5bca200ecbba@154.12.237.243:30303
enode://926900ccd1e2f218ce0d3c31f731eb1af1be60049624db9a01fa73588157f3fb7fd04c5f0874ca7cc030ab79d836c1961c3ef67aefe09f352e8a7aba03d3cdbf@154.12.237.243:30304
enode://c2e73bd6232c73ab7887d92aa904413597638ebf935791ca197bdd7902560baa7a4e8a1235b6d10d121ffc4602373476e7daa7d20d326466a5ae423be6581707@99.248.100.186:31303
```

## Building from Source

### Prerequisites

- Go 1.21 or later
- C compiler (GCC)
- Make

### Build

```bash
# Clone repository
git clone https://github.com/nucash-mining/go-altcoinchain_FUSAKA.git
cd go-altcoinchain_FUSAKA

# Build geth
make geth

# Or build all utilities
make all

# Binary will be in build/bin/
./build/bin/geth --version
```

## Create a Wallet

```bash
# Create new account
./geth account new --datadir ~/.altcoinchain

# List accounts
./geth account list --datadir ~/.altcoinchain
```

## Attach Console

```bash
# Attach to running node
./geth attach ~/.altcoinchain/geth.ipc

# Useful console commands
> eth.syncing          # Check sync status
> eth.blockNumber      # Current block
> admin.peers.length   # Connected peers
> eth.getBalance(eth.accounts[0])  # Check balance
> personal.unlockAccount(eth.accounts[0])  # Unlock for transactions
```

## Mining

### CPU Mining

```bash
# Start node with mining enabled
./geth --datadir ~/.altcoinchain \
  --networkid 2330 \
  --mine \
  --miner.threads=4 \
  --miner.etherbase=YOUR_WALLET_ADDRESS \
  --bootnodes "enode://9355a3870bb3c7882a51797c6633380359c827febdbd89c87c0ff72914b351caf1642e5326ba78532f249082aad7c08d524cd418514865a49f8a5bca200ecbba@154.12.237.243:30303,enode://926900ccd1e2f218ce0d3c31f731eb1af1be60049624db9a01fa73588157f3fb7fd04c5f0874ca7cc030ab79d836c1961c3ef67aefe09f352e8a7aba03d3cdbf@154.12.237.243:30304"
```

### GPU Mining

For GPU mining, use a compatible miner like lolMiner or TeamRedMiner:

```bash
# Example with lolMiner
./lolMiner --algo ETCHASH --pool stratum+tcp://YOUR_POOL:PORT --user YOUR_WALLET
```

## Staking (PoS)

Since block 7,200,000 every block pays **0.166666666 ALT, split 1:1**: half to the
PoW miner, half to the online validator set in proportion to stake.

ValidatorStaking v3.1: `0x2e05FfB10eF99e3c8B2BE1b752D7D3D45E6AC2a7`

| Parameter | Value |
|-----------|-------|
| Minimum validator self-stake | **32 ALT** |
| Minimum delegation | 10 ALT |
| Liveness window (`ACTIVITY_THRESHOLD`) | **100 blocks** |
| Unbonding delay | 7 days |
| Maximum commission | 50% |

### Register a validator

```bash
# 32 ALT self-stake, 10% commission, moniker shown in the validator list
cast send 0x2e05FfB10eF99e3c8B2BE1b752D7D3D45E6AC2a7 \
  "registerValidator(uint256,string)" 10 "my-validator" \
  --value 32ether --keystore <keystore> --rpc-url <rpc> --legacy
```

### Staying online — read this or you will earn nothing

`isValidatorOnline()` is true only while `block.number - lastActiveBlock <= 100`.
**That window is measured in blocks, not time.** At the post-fork ~1s block target
it is roughly **100 seconds**, not the ~20 minutes it was at 13s blocks. A
validator that stops refreshing its liveness silently drops out of the online set
and earns nothing, while still appearing registered and active.

The node refreshes it for you. Run it with a validator key in the keystore and
unlocked, and the built-in attestor sends `attest()` every 40 blocks:

```bash
geth --datadir ~/.altcoinchain \
  --unlock 0xYOUR_VALIDATOR --password /path/to/password.txt \
  --allow-insecure-unlock \
  ...
```

`--allow-insecure-unlock` is required whenever HTTP RPC is enabled. Only use it on
a node whose RPC is **not** reachable from the network — bind it to `127.0.0.1`, or
publish it behind a proxy that rejects `eth_sendTransaction` and `personal_*`.

That same unlocked key is what produces **PoS attestations**, which drive finality.
A node with no validator key in its keystore never attests, and a chain where
nobody attests never finalizes — see Finality below.

### Check your status

```bash
cast call 0x2e05FfB10eF99e3c8B2BE1b752D7D3D45E6AC2a7 \
  "isValidatorOnline(address)(bool)" 0xYOUR_VALIDATOR --rpc-url <rpc>

cast call 0x2e05FfB10eF99e3c8B2BE1b752D7D3D45E6AC2a7 \
  "getOnlineValidators()(address[])" --rpc-url <rpc>
```

Always check against a **public** RPC, not your own node. A node that has drifted
onto a minority fork will happily report your validator as online using its own
view of the chain while the network disagrees.

### Claim rewards

```bash
# validator's own share (self-stake earnings + commission)
cast send <staking> "claimValidatorRewards()" ...
# a delegator's share
cast send <staking> "claimRewards(address)" <validator> ...
```

Note that delegated stake earns for the **delegator** minus commission; only the
self-stake portion and the commission accrue to the validator operator.

## Finality and reorg protection

PoS attestations are not decorative. `core/blockchain_reorgguard.go` enforces:

- **Guard 1 — finality is absolute.** A block the validator set has finalized is
  never unwound, no matter how much proof-of-work backs a competing chain.
- **Guard 2 — depth limit.** Reorgs deeper than `--reorg.limit` (default 128) are
  refused while the node is at the tip. `--reorg.limitgrace` (default 10m) stops
  this stranding a node that is simply catching up.

This matters because Altcoinchain's network hashrate is small enough that a single
modern GPU can privately outmine it. Guard 1 only works while finality is actually
advancing, which needs at least one online validator holding a real key (above).

```bash
# how far finality has advanced on your node
geth attach <ipc> --exec "validator.getLastFinalizedBlock()"
```

## RPC Endpoints

### HTTP RPC

```bash
curl -X POST -H "Content-Type: application/json" \
  --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
  http://127.0.0.1:8332
```

### WebSocket

```javascript
const ws = new WebSocket('ws://127.0.0.1:8333');
```

## Run as Systemd Service

Create `/etc/systemd/system/altcoinchain.service`:

```ini
[Unit]
Description=Altcoinchain Node
After=network.target

[Service]
Type=simple
User=YOUR_USER
ExecStart=/path/to/geth --datadir /home/YOUR_USER/.altcoinchain --networkid 2330 --port 31303 --http --http.addr 127.0.0.1 --http.port 8332 --http.api eth,net,web3,personal,miner,txpool,debug --ws --ws.addr 127.0.0.1 --ws.port 8333 --ws.api eth,net,web3,personal,miner,txpool --bootnodes "enode://9355a3870bb3c7882a51797c6633380359c827febdbd89c87c0ff72914b351caf1642e5326ba78532f249082aad7c08d524cd418514865a49f8a5bca200ecbba@154.12.237.243:30303,enode://926900ccd1e2f218ce0d3c31f731eb1af1be60049624db9a01fa73588157f3fb7fd04c5f0874ca7cc030ab79d836c1961c3ef67aefe09f352e8a7aba03d3cdbf@154.12.237.243:30304,enode://c2e73bd6232c73ab7887d92aa904413597638ebf935791ca197bdd7902560baa7a4e8a1235b6d10d121ffc4602373476e7daa7d20d326466a5ae423be6581707@99.248.100.186:31303" --ethstats=YourNodeName:alt@alt-stat.outsidethebox.top --syncmode snap --maxpeers 50 --cache 512
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable altcoinchain
sudo systemctl start altcoinchain
sudo journalctl -u altcoinchain -f  # View logs
```

## Hardware Requirements

**Minimum:**
- CPU: 2+ cores
- RAM: 4GB
- Storage: 20GB SSD
- Network: 8 Mbps

**Recommended:**
- CPU: 4+ cores
- RAM: 8GB+
- Storage: 50GB+ SSD
- Network: 25+ Mbps

## Troubleshooting

### Node won't sync
```bash
# Check peers
./geth attach ~/.altcoinchain/geth.ipc --exec "admin.peers.length"

# Manually add peer
./geth attach ~/.altcoinchain/geth.ipc --exec 'admin.addPeer("enode://...")'
```

### Reset blockchain data
```bash
# Remove chaindata (keeps accounts)
rm -rf ~/.altcoinchain/geth/chaindata
rm -rf ~/.altcoinchain/geth/ethash

# Re-initialize
./geth --datadir ~/.altcoinchain init genesis.json
```

### Check sync status
```bash
./geth attach ~/.altcoinchain/geth.ipc --exec "eth.syncing"
# Returns false when fully synced
```

### Node stopped at block 7,199,999
Its stored chain config predates the hybrid fork, so it rejects block 7,200,000.
Re-run `init` with the current genesis (see Network Information above). Staging a
new `genesis.json` is not enough on its own — most launch scripts only run `init`
when the datadir is empty, so an existing node never picks it up.

### Validator shows offline, but my node says it is online
Check against a public RPC, not your own node. `eth.syncing` returning `false`
means "not actively downloading", **not** "on the right chain" — a node on a
private fork reports itself synced and online. Compare block *hashes*, not just
heights:

```bash
# same height on both, then compare the hashes
./geth attach ~/.altcoinchain/geth.ipc --exec "eth.getBlock(7200000).hash"
curl -s -X POST -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","method":"eth_getBlockByNumber","params":["0x6DDD00",false],"id":1}' \
  <public-rpc> | grep -o '"hash":"0x[0-9a-f]*"'
```

If they differ, you are on a fork. `admin.peers.length` of `0` is the usual cause.

### Zero peers
Altcoinchain's discovery DHT is crowded with nodes from other networks, so
discovery alone often finds nothing. Peers come from `static-nodes.json` in the
datadir, or `admin.addPeer(...)` at runtime. **Never leave `--mine` running on a
node with no peers** — it cannot publish what it finds, so it silently builds a
private chain that has to be discarded later.

## Community

- Discord: https://discord.gg/hcXHyQP4Je
- Explorer: https://altscan.io
- Ethstats: https://alt-stat.outsidethebox.top

## License

GNU General Public License v3.0
