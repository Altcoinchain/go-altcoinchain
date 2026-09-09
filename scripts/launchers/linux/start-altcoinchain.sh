#!/bin/bash
# Altcoinchain Node Launcher for Linux
# Starts the geth node with official bootnodes

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GETH_BIN="$SCRIPT_DIR/geth"
DATADIR="$HOME/.altcoinchain"
GENESIS="$SCRIPT_DIR/genesis.json"

# Network configuration
NETWORK_ID=2330
RPC_PORT=8332
WS_PORT=8333
P2P_PORT=31303

# Altcoinchain Bootnodes
BOOTNODES="enode://9355a3870bb3c7882a51797c6633380359c827febdbd89c87c0ff72914b351caf1642e5326ba78532f249082aad7c08d524cd418514865a49f8a5bca200ecbba@154.12.237.243:30303,enode://926900ccd1e2f218ce0d3c31f731eb1af1be60049624db9a01fa73588157f3fb7fd04c5f0874ca7cc030ab79d836c1961c3ef67aefe09f352e8a7aba03d3cdbf@154.12.237.243:30304,enode://c2e73bd6232c73ab7887d92aa904413597638ebf935791ca197bdd7902560baa7a4e8a1235b6d10d121ffc4602373476e7daa7d20d326466a5ae423be6581707@99.248.100.186:31303"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log() { echo -e "${GREEN}[Altcoinchain]${NC} $1"; }
warn() { echo -e "${YELLOW}[Warning]${NC} $1"; }
info() { echo -e "${CYAN}[Info]${NC} $1"; }

echo -e "${CYAN}"
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║              ALTCOINCHAIN NODE LAUNCHER                   ║"
echo "║                   Network ID: 2330                        ║"
echo "║              Hybrid PoW/PoS - Fusaka Fork                 ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# Check geth binary
if [ ! -f "$GETH_BIN" ]; then
    echo "Error: geth binary not found at $GETH_BIN"
    exit 1
fi

# Create datadir
mkdir -p "$DATADIR"

# Initialize genesis if needed
if [ ! -d "$DATADIR/geth" ]; then
    log "Initializing Altcoinchain data directory..."
    if [ -f "$GENESIS" ]; then
        "$GETH_BIN" --datadir "$DATADIR" init "$GENESIS"
        log "Genesis initialized (Chain ID: 2330)"
    else
        warn "Genesis file not found, node will sync from bootnodes"
    fi
fi

# Check if already running
if pgrep -f "geth.*networkid $NETWORK_ID" > /dev/null; then
    log "Altcoinchain node is already running"
    exit 0
fi

log "Starting Altcoinchain node..."
info "Connecting to network bootnodes..."

"$GETH_BIN" --datadir "$DATADIR" \
    --networkid $NETWORK_ID \
    --port $P2P_PORT \
    --bootnodes "$BOOTNODES" \
    --http --http.port $RPC_PORT \
    --http.api personal,eth,net,web3,miner,admin,debug,txpool \
    --http.corsdomain "*" \
    --ws --ws.port $WS_PORT \
    --ws.api personal,eth,net,web3,miner,admin,debug,txpool \
    --ws.origins "*" \
    --allow-insecure-unlock \
    --syncmode=full \
    --gcmode=archive \
    --maxpeers 50 \
    --nat=any \
    console
