#!/bin/bash
# Altcoinchain Wallet Launcher
# Starts the node with bootnodes and Electron wallet

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WALLET_DIR="$SCRIPT_DIR"
GETH_DIR="$(dirname "$(dirname "$SCRIPT_DIR")")"
GETH_BIN="$GETH_DIR/build/bin/geth"
DATADIR="$HOME/.altcoinchain"
GENESIS="$GETH_DIR/genesis.json"

# Network configuration
NETWORK_ID=2330
RPC_PORT=8332
WS_PORT=8333
P2P_PORT=31303

# Altcoinchain Bootnodes - Official network nodes
BOOTNODES="enode://9355a3870bb3c7882a51797c6633380359c827febdbd89c87c0ff72914b351caf1642e5326ba78532f249082aad7c08d524cd418514865a49f8a5bca200ecbba@154.12.237.243:30303,enode://926900ccd1e2f218ce0d3c31f731eb1af1be60049624db9a01fa73588157f3fb7fd04c5f0874ca7cc030ab79d836c1961c3ef67aefe09f352e8a7aba03d3cdbf@154.12.237.243:30304"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

log() {
    echo -e "${GREEN}[Altcoinchain]${NC} $1"
}

warn() {
    echo -e "${YELLOW}[Warning]${NC} $1"
}

error() {
    echo -e "${RED}[Error]${NC} $1"
}

info() {
    echo -e "${CYAN}[Info]${NC} $1"
}

# Display banner
echo -e "${CYAN}"
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║              ALTCOINCHAIN WALLET LAUNCHER                 ║"
echo "║                   Network ID: 2330                        ║"
echo "║              Hybrid PoW/PoS - Fusaka Fork                 ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# Check if geth binary exists
if [ ! -f "$GETH_BIN" ]; then
    error "Geth binary not found at $GETH_BIN"
    error "Please build geth first: cd $GETH_DIR && make geth"
    exit 1
fi

# Create datadir if it doesn't exist
mkdir -p "$DATADIR"

# Initialize datadir if it doesn't exist
if [ ! -d "$DATADIR/geth" ]; then
    log "Initializing Altcoinchain data directory..."
    if [ -f "$GENESIS" ]; then
        "$GETH_BIN" --datadir "$DATADIR" init "$GENESIS"
        log "Genesis initialized successfully (Chain ID: 2330)"
    else
        warn "Genesis file not found at $GENESIS"
        warn "Node will attempt to sync from network bootnodes"
    fi
fi

# Function to cleanup on exit
cleanup() {
    log "Shutting down wallet services..."
    # Don't kill the node - let it keep syncing in background
    exit 0
}
trap cleanup SIGINT SIGTERM

# Check if geth is already running
if pgrep -f "geth.*networkid $NETWORK_ID" > /dev/null; then
    log "Altcoinchain node is already running"
    # Get sync status
    BLOCK_NUM=$(curl -s -X POST -H "Content-Type: application/json" \
        --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
        http://127.0.0.1:$RPC_PORT 2>/dev/null | grep -oP '"result":"0x\K[^"]+')
    if [ -n "$BLOCK_NUM" ]; then
        BLOCK_DEC=$((16#$BLOCK_NUM))
        info "Current block height: $BLOCK_DEC"
    fi
else
    log "Starting Altcoinchain node..."
    info "Connecting to bootnodes for network sync..."

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
        > "$DATADIR/geth.log" 2>&1 &

    GETH_PID=$!
    echo $GETH_PID > "$DATADIR/geth.pid"

    log "Node starting (PID: $GETH_PID), waiting for RPC..."

    RPC_READY=false
    for i in {1..30}; do
        if curl -s -X POST -H "Content-Type: application/json" \
            --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
            http://127.0.0.1:$RPC_PORT > /dev/null 2>&1; then
            log "Node RPC is ready on port $RPC_PORT"
            RPC_READY=true
            break
        fi
        sleep 1
    done

    if [ "$RPC_READY" = false ]; then
        warn "RPC not responding after 30 seconds, continuing anyway..."
    fi

    # Check peer count
    sleep 2
    PEER_COUNT=$(curl -s -X POST -H "Content-Type: application/json" \
        --data '{"jsonrpc":"2.0","method":"net_peerCount","params":[],"id":1}' \
        http://127.0.0.1:$RPC_PORT 2>/dev/null | grep -oP '"result":"0x\K[^"]+')
    if [ -n "$PEER_COUNT" ]; then
        PEERS=$((16#$PEER_COUNT))
        info "Connected to $PEERS peers"
    fi
fi

# Launch the Electron wallet
log "Launching Altcoinchain Wallet..."
info "Press Ctrl+C to close the wallet (node will keep syncing)"
cd "$WALLET_DIR"

# Check if electron is available
if command -v electron &> /dev/null; then
    electron .
elif [ -f "node_modules/.bin/electron" ]; then
    ./node_modules/.bin/electron .
else
    npx electron .
fi

log "Wallet closed. Node continues syncing in background."
info "To stop the node: kill \$(cat $DATADIR/geth.pid)"
