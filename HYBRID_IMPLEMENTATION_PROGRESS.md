# Altcoinchain Hybrid PoW/PoS Implementation Progress

**Last Updated:** January 25, 2026, 22:30 UTC
**Current Sync:** Block 6,361,780 / 6,649,248 (95.7%)

## Network Information
- **Chain ID:** 2330
- **Network ID:** 2330
- **Hybrid Fork Block:** 7,000,000
- **Genesis Hash:** 0x04e12dc501c4f51306351345e0587ec8bee495a9780ce9234401a0aa512e299b

## Staking Contract
- **Address:** 0x87f0bd245507e5a94cdb03472501a9f522a9e0f1
- **Minimum Stake:** 32 ALT
- **Withdrawal Delay:** 7 days
- **Status:** Will be deployed at hybrid fork (block 7,000,000). Network is currently at ~6.65M blocks.

## Block Rewards (after block 7,000,000)
- **Total:** 2 ALT per block
- **PoW Miner:** 1 ALT
- **PoS Validators:** 1 ALT (distributed to validator pool)

## Key Files Modified

### params/config.go
- Set ChainID to 2330
- All EVM forks activated at block 0
- Removed EthPoWForkBlock (was causing chain ID validation issues)
- HybridBlock set to 7,000,000
- Hybrid config with staking contract address

### consensus/hybrid/hybrid.go
- Block rewards: HybridMinerReward = 1 ALT, HybridValidatorReward = 1 ALT
- 12 second block time

### core/state_processor.go
- Disabled blacklist for address 0x5CcCcb6d334197c7C4ba94E7873d0ef11381CD4e (was blocking sync)

### core/types/transaction_signing.go
- MakeSigner uses ChainID (2330) for transaction validation

### contracts/staking/ValidatorStaking.sol
- Full staking contract with stake(), requestWithdrawal(), withdraw(), claimRewards()
- Deployed at 0x87f0bd245507e5a94cdb03472501a9f522a9e0f1

## Genesis Files
- **altcoinchain-genesis-v2.json** - Updated genesis without EthPoWFork
- Located in project root

## Desktop Wallet (Electron App - Bitcoin-Qt Style)
- **Location:** /home/nuts/Documents/go-altcoinchain_FUSAKA/wallet/
- **Files:** main.js, preload.js, index.html, package.json
- **Features:**
  - Auto-starts geth node on launch (like Bitcoin-Qt)
  - Splash screen while loading
  - Built-in wallet creation with ethers.js
  - Copyable private keys with save-to-file option
  - Send/receive ALT transactions
  - Staking interface for validators
  - ERC20 token management
  - Network status monitoring
- **Run:** `cd wallet && npm start`
- **Build:** `cd wallet && npm run build-linux` (creates AppImage/deb)

## Web Dashboard (MetaMask-based)
- **Location:** /home/nuts/Documents/go-altcoinchain_FUSAKA/gui/
- **Files:** index.html, main.js, preload.js, package.json
- **Features:** MetaMask wallet integration, staking interface, network stats
- **Run:** `cd gui && npx http-server . -p 8888`

## Issues Resolved

1. **Fork ordering error** - Set all EVM forks to block 0, hybrid at 7M
2. **Genesis hash mismatch** - Using correct Altcoinchain genesis (04e12d...)
3. **EthPoWFork chain ID issue** - Removed EthPoWForkBlock from config
4. **Blacklist blocking sync** - Disabled blacklist in state_processor.go
5. **MetaMask integration** - Added wallet support to dashboard

## Peer Nodes (static-nodes.json)
```json
[
    "enode://9355a3870bb3c7882a51797c6633380359c827febdbd89c87c0ff72914b351caf1642e5326ba78532f249082aad7c08d524cd418514865a49f8a5bca200ecbba@154.12.237.243:30303",
    "enode://926900ccd1e2f218ce0d3c31f731eb1af1be60049624db9a01fa73588157f3fb7fd04c5f0874ca7cc030ab79d836c1961c3ef67aefe09f352e8a7aba03d3cdbf@154.12.237.243:30304",
    "enode://c2e73bd6232c73ab7887d92aa904413597638ebf935791ca197bdd7902560baa7a4e8a1235b6d10d121ffc4602373476e7daa7d20d326466a5ae423be6581707@99.248.100.186:31303"
]
```

## RPC Endpoints
- **Local:** http://127.0.0.1:8545
- **Mainnet:** https://alt-rpc2.minethepla.net

## Current Status
- Node sync: 95.7% complete (6,361,780 / 6,649,248 blocks)
- Desktop wallet: Running with auto-node management
- Network: ~350,000 blocks until hybrid fork (7,000,000)
- Mining API: Available on mainnet RPC (eth_getWork works)

## Next Steps
1. Complete sync to chain head
2. Wait for network to reach block 7,000,000 (hybrid fork)
3. Deploy staking contract (automatic at fork)
4. Start validator staking operations

## Commands to Resume

### Start geth:
```bash
cd /home/nuts/Documents/go-altcoinchain_FUSAKA
./build/bin/geth --datadir ~/.altcoinchain --networkid 2330 --http --http.addr 127.0.0.1 --http.api eth,net,web3,personal,miner,txpool,admin --http.corsdomain "*" --syncmode full
```

### Check sync:
```bash
curl -s -X POST -H "Content-Type: application/json" --data '{"jsonrpc":"2.0","method":"eth_syncing","params":[],"id":1}' http://127.0.0.1:8545
```

### Start Desktop Wallet:
```bash
cd /home/nuts/Documents/go-altcoinchain_FUSAKA/wallet
npm start
```

### Start Web Dashboard:
```bash
cd /home/nuts/Documents/go-altcoinchain_FUSAKA/gui
npx http-server . -p 8888
```

### Rebuild geth:
```bash
cd /home/nuts/Documents/go-altcoinchain_FUSAKA
make geth
```

## Release Package
Located at: `/home/nuts/Documents/go-altcoinchain_FUSAKA/release/altcoinchain-hybrid-v1.0.0-linux-amd64/`

Contains: geth, bootnode, clef, genesis.json, ValidatorStaking.sol, ValidatorStaking.abi, static-nodes.json, README.txt, index.html
