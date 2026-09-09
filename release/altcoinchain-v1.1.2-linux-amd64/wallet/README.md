# Altcoinchain Desktop Wallet

A modern desktop wallet for Altcoinchain with integrated node support.

## Features

- Full Altcoinchain node integration with automatic sync
- Send and receive ALT coins
- View transaction history
- CPU mining support
- Multiple themes (Matrix, Dark, Light)
- Hybrid PoW/PoS network support (Fusaka fork)

## Network Information

- **Chain ID**: 2330
- **Network ID**: 2330
- **P2P Port**: 31303
- **RPC Port**: 8332
- **WebSocket Port**: 8333

## Bootnodes

The wallet automatically connects to these official bootnodes:
- `enode://9355a3870bb3c7882a51797c6633380359c827febdbd89c87c0ff72914b351caf1642e5326ba78532f249082aad7c08d524cd418514865a49f8a5bca200ecbba@154.12.237.243:30303`
- `enode://926900ccd1e2f218ce0d3c31f731eb1af1be60049624db9a01fa73588157f3fb7fd04c5f0874ca7cc030ab79d836c1961c3ef67aefe09f352e8a7aba03d3cdbf@154.12.237.243:30304`

## Installation

### Prerequisites

- Node.js 18+ and npm
- Go 1.21+ (for building geth)
- Linux, macOS, or Windows with WSL

### Build from Source

1. Build the Altcoinchain node:
```bash
cd /path/to/go-altcoinchain_FUSAKA
make geth
```

2. Install wallet dependencies:
```bash
cd wallet/wallet-react
npm install

cd ../wallet-desktop
npm install
```

3. Run the wallet:
```bash
./start-altcoinchain-wallet.sh
```

### Desktop Launcher

To add a desktop launcher (Linux):
```bash
cp altcoinchain-wallet.desktop ~/.local/share/applications/
```

## Usage

### Starting the Wallet

```bash
./start-altcoinchain-wallet.sh
```

This will:
1. Initialize the data directory with genesis (if first run)
2. Start the Altcoinchain node with bootnodes
3. Start the React wallet server
4. Launch the Electron desktop wallet

### Stopping Services

```bash
./stop-altcoinchain.sh
```

### Data Directory

All blockchain data is stored in `~/.altcoinchain/`:
- `geth/` - Blockchain database
- `geth.log` - Node logs
- `geth.pid` - Node process ID
- `wallet-react.log` - Wallet server logs

## Mining

The wallet includes CPU mining support:

1. Create or import a wallet
2. Go to the Mining tab
3. Click "Start Mining"

Mining rewards: 2 ALT per block (70% miner / 30% validators after block 7,000,000)

## Themes

Available themes:
- **Matrix** (default) - Cyberpunk green/cyan neon aesthetic
- **Dark** - Professional dark purple/indigo theme
- **Light** - Clean light blue theme

Change themes using the icons in the header.

## Troubleshooting

### Node not syncing
- Check if bootnodes are reachable
- Verify port 31303 is not blocked by firewall
- Check `~/.altcoinchain/geth.log` for errors

### Wallet not loading
- Ensure React server is running on port 3000
- Check `~/.altcoinchain/wallet-react.log`

### Reset blockchain data
```bash
rm -rf ~/.altcoinchain/geth
./start-altcoinchain-wallet.sh  # Will reinitialize
```

## License

MIT License - See LICENSE file for details.

## Links

- Website: https://altcoinchain.org
- GitHub: https://github.com/nucash-mining/go-altcoinchain_FUSAKA
- Explorer: https://explorer.altcoinchain.org
