Altcoinchain Hybrid PoW/PoS Release v1.0.0
==========================================

IMPORTANT: All nodes MUST upgrade before block 7,000,000

Network Information
-------------------
Chain ID: 2330
Network ID: 2330
Hybrid Fork Block: 7,000,000
Genesis Hash: 0x04e12dc501c4f51306351345e0587ec8bee495a9780ce9234401a0aa512e299b

Consensus Changes at Block 7,000,000
------------------------------------
- Hybrid PoW/PoS consensus activates
- Block rewards: 2 ALT per block
  - 1 ALT to PoW miner
  - 1 ALT to PoS validator pool
- Minimum stake to become validator: 32 ALT
- Block time target: 12 seconds

Staking Contract
----------------
Address: 0x87f0bd245507e5a94cdb03472501a9f522a9e0f1

Functions:
- stake() - Stake ALT to become a validator (min 32 ALT)
- requestWithdrawal(amount) - Request unstake (7-day delay)
- withdraw() - Complete withdrawal after delay
- claimRewards() - Claim accumulated rewards
- getValidators() - Get list of active validators
- getPendingRewards(address) - Check pending rewards

Installation
------------
1. Stop your current geth node
2. Backup your data directory (~/.altcoinchain)
3. Replace geth binary with the new version
4. Initialize with new genesis (if fresh install):
   ./geth --datadir ~/.altcoinchain init genesis.json
5. Start geth:
   ./geth --datadir ~/.altcoinchain --networkid 2330 --http --http.api eth,net,web3,validator

Becoming a Validator
--------------------
1. Have 32+ ALT in your account
2. Call stake() on the staking contract with 32+ ALT
3. Your node will automatically participate in attestations

Files Included
--------------
- geth: Main Altcoinchain client
- bootnode: P2P bootstrap node
- clef: Account management tool
- genesis.json: Genesis configuration with hybrid fork
- ValidatorStaking.sol: Staking contract source
- ValidatorStaking.abi: Contract ABI for interactions

Bootnodes
---------
enode://9355a3870bb3c7882a51797c6633380359c827febdbd89c87c0ff72914b351caf1642e5326ba78532f249082aad7c08d524cd418514865a49f8a5bca200ecbba@154.12.237.243:30303
enode://926900ccd1e2f218ce0d3c31f731eb1af1be60049624db9a01fa73588157f3fb7fd04c5f0874ca7cc030ab79d836c1961c3ef67aefe09f352e8a7aba03d3cdbf@154.12.237.243:30304
enode://c2e73bd6232c73ab7887d92aa904413597638ebf935791ca197bdd7902560baa7a4e8a1235b6d10d121ffc4602373476e7daa7d20d326466a5ae423be6581707@99.248.100.186:31303

RPC Endpoints
-------------
https://alt-rpc2.minethepla.net

Support
-------
GitHub: https://github.com/altcoinchain

Built: January 25, 2026
Commit: e10680a4a0525e3328b4d83dddb001d212facb53
