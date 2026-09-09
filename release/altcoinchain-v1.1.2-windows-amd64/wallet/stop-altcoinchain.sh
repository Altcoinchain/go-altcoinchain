#!/bin/bash
# Altcoinchain Stop Script
# Stops all Altcoinchain services

DATADIR="$HOME/.altcoinchain"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() {
    echo -e "${GREEN}[Altcoinchain]${NC} $1"
}

warn() {
    echo -e "${YELLOW}[Warning]${NC} $1"
}

# Stop geth
if [ -f "$DATADIR/geth.pid" ]; then
    GETH_PID=$(cat "$DATADIR/geth.pid")
    if kill -0 $GETH_PID 2>/dev/null; then
        log "Stopping Altcoinchain node (PID: $GETH_PID)..."
        kill $GETH_PID
        sleep 2
        if kill -0 $GETH_PID 2>/dev/null; then
            warn "Node didn't stop gracefully, forcing..."
            kill -9 $GETH_PID
        fi
        log "Node stopped"
    else
        warn "Node was not running"
    fi
    rm -f "$DATADIR/geth.pid"
else
    # Try to find and kill by process name
    if pgrep -f "geth.*networkid 2330" > /dev/null; then
        log "Stopping Altcoinchain node..."
        pkill -f "geth.*networkid 2330"
        log "Node stopped"
    else
        warn "No Altcoinchain node found running"
    fi
fi

# Stop React server
if [ -f "$DATADIR/react.pid" ]; then
    REACT_PID=$(cat "$DATADIR/react.pid")
    if kill -0 $REACT_PID 2>/dev/null; then
        log "Stopping React wallet server (PID: $REACT_PID)..."
        kill $REACT_PID
        log "React server stopped"
    fi
    rm -f "$DATADIR/react.pid"
fi

# Also try to kill any remaining npm/node processes on port 3000
if lsof -i:3000 > /dev/null 2>&1; then
    log "Stopping wallet server on port 3000..."
    fuser -k 3000/tcp 2>/dev/null
fi

log "All Altcoinchain services stopped"
