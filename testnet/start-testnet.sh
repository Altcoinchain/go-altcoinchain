#!/bin/bash
# Altcoinchain Testnet Launcher
# For testing hybrid PoW/PoS staking

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GETH_DIR="$(dirname "$SCRIPT_DIR")"
GETH_BIN="$GETH_DIR/build/bin/geth"
DATADIR="$HOME/.altcoinchain-testnet"
GENESIS="$SCRIPT_DIR/genesis-testnet.json"

# Testnet configuration (different ports from mainnet)
NETWORK_ID=23301
RPC_PORT=8545
WS_PORT=8546
P2P_PORT=30305

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

log() { echo -e "${GREEN}[Testnet]${NC} $1"; }
warn() { echo -e "${YELLOW}[Warning]${NC} $1"; }
error() { echo -e "${RED}[Error]${NC} $1"; }
info() { echo -e "${CYAN}[Info]${NC} $1"; }

echo -e "${CYAN}"
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║          ALTCOINCHAIN STAKING TESTNET                     ║"
echo "║              Chain ID: 23301                              ║"
echo "║        Hybrid PoW/PoS Active from Block 10                ║"
echo "║           50% Miner / 50% Validators                      ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# Check geth
if [ ! -f "$GETH_BIN" ]; then
    error "Geth binary not found. Build with: cd $GETH_DIR && make geth"
    exit 1
fi

# Clean and reinitialize if requested
if [ "$1" = "--clean" ]; then
    warn "Cleaning testnet data directory..."
    rm -rf "$DATADIR"
fi

# Initialize if needed
if [ ! -d "$DATADIR/geth" ]; then
    log "Initializing testnet with genesis..."
    "$GETH_BIN" --datadir "$DATADIR" init "$GENESIS"
    log "Genesis initialized - Staking contract at 0x0000000000000000000000000000000000001000"
fi

# Stop any existing testnet
if pgrep -f "geth.*networkid $NETWORK_ID" > /dev/null; then
    log "Stopping existing testnet node..."
    pkill -f "geth.*networkid $NETWORK_ID"
    sleep 2
fi

# Create a test account if none exists
log "Setting up test account..."
ACCOUNT=$("$GETH_BIN" --datadir "$DATADIR" account list 2>/dev/null | head -1 | grep -oP '0x[a-fA-F0-9]+')
if [ -z "$ACCOUNT" ]; then
    echo "testpassword" > /tmp/testnet-password.txt
    ACCOUNT=$("$GETH_BIN" --datadir "$DATADIR" account new --password /tmp/testnet-password.txt 2>/dev/null | grep -oP '0x[a-fA-F0-9]+')
    rm /tmp/testnet-password.txt
    info "Created test account: $ACCOUNT"
else
    info "Using existing account: $ACCOUNT"
fi

# Start the testnet node
log "Starting testnet node..."
info "Mining enabled for testing"

"$GETH_BIN" --datadir "$DATADIR" \
    --networkid $NETWORK_ID \
    --port $P2P_PORT \
    --http --http.port $RPC_PORT \
    --http.api personal,eth,net,web3,miner,admin,debug,txpool \
    --http.corsdomain "*" \
    --ws --ws.port $WS_PORT \
    --ws.api personal,eth,net,web3,miner,admin,debug,txpool \
    --ws.origins "*" \
    --allow-insecure-unlock \
    --miner.etherbase="$ACCOUNT" \
    --mine \
    --miner.threads=1 \
    --syncmode=full \
    --nodiscover \
    --maxpeers 0 \
    --authrpc.port 8552 \
    > "$DATADIR/testnet.log" 2>&1 &

GETH_PID=$!
echo $GETH_PID > "$DATADIR/testnet.pid"

log "Testnet node starting (PID: $GETH_PID)..."

# Wait for RPC
for i in {1..30}; do
    if curl -s -X POST -H "Content-Type: application/json" \
        --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
        http://127.0.0.1:$RPC_PORT > /dev/null 2>&1; then
        log "RPC ready on http://127.0.0.1:$RPC_PORT"
        break
    fi
    sleep 1
done

echo ""
info "Testnet Configuration:"
echo "  Chain ID:        $NETWORK_ID"
echo "  RPC Endpoint:    http://127.0.0.1:$RPC_PORT"
echo "  WebSocket:       ws://127.0.0.1:$WS_PORT"
echo "  Data Directory:  $DATADIR"
echo "  Staking Contract: 0x0000000000000000000000000000000000001000"
echo "  Hybrid Fork:     Block 10"
echo "  Min Stake:       32 ALT"
echo ""
info "Pre-funded Account: 0xAcf4Ac8668C587Cc47e401925dDe5b806fa27e9a"
echo ""
log "Testnet is running. Use test-staking.sh to test staking."
log "Logs: tail -f $DATADIR/testnet.log"
