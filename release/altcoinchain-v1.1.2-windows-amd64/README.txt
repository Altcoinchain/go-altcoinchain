Altcoinchain Release
====================

Network Information
-------------------
Chain ID: 2330
Network ID: 2330
Hybrid Fork Block: 7,000,000
Genesis Hash: 0x04e12dc501c4f51306351345e0587ec8bee495a9780ce9234401a0aa512e299b

Quick Start
-----------

LINUX:
  1. Extract the archive
  2. Run ./install-desktop.sh to add application menu entries
  3. Launch from menu or run:
     - ./start-altcoinchain.sh  (Node only, console mode)
     - ./start-wallet.sh        (Node + Wallet GUI)

WINDOWS:
  1. Extract the ZIP file
  2. Run install-shortcut.bat to add desktop/start menu shortcuts
  3. Launch from shortcuts or run:
     - start-altcoinchain.bat   (Node only, console mode)
     - start-wallet.bat         (Node + Wallet GUI)

Files Included
--------------
- geth / geth.exe         : Main Altcoinchain client
- bootnode / bootnode.exe : P2P bootstrap node
- clef / clef.exe         : Account management tool
- genesis.json            : Genesis configuration
- wallet/                 : Electron wallet application
- ValidatorStaking.sol    : Staking contract source
- ValidatorStaking.abi    : Contract ABI

Data Directories
----------------
Linux:   ~/.altcoinchain/
Windows: %USERPROFILE%\.altcoinchain\

Network Ports
-------------
- P2P:       31303
- HTTP RPC:  8332
- WebSocket: 8333

Staking Contract
----------------
Address: 0x87f0bd245507e5a94cdb03472501a9f522a9e0f1
Minimum Stake: 32 ALT

Functions:
- stake()                    : Stake ALT to become validator (min 32 ALT)
- requestWithdrawal(amount)  : Request unstake (7-day delay)
- withdraw()                 : Complete withdrawal after delay
- claimRewards()             : Claim accumulated rewards
- getValidators()            : Get list of active validators
- getPendingRewards(address) : Check pending rewards

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
