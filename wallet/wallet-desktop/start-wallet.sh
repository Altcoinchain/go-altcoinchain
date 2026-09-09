#!/bin/bash
# Altcoinchain Wallet Launcher

WALLET_DIR="$HOME/Documents/go-altcoinchain_FUSAKA/wallet/wallet-desktop"
REACT_DIR="$HOME/Documents/go-altcoinchain_FUSAKA/wallet/wallet-react"
GETH_BIN="$HOME/Documents/go-altcoinchain_FUSAKA/build/bin/geth"
DATADIR="$HOME/.altcoinchain"

# Check if geth is running, if not start it
if ! pgrep -f "geth.*networkid 2330" > /dev/null; then
    echo "Starting Altcoinchain node..."
    cd "$HOME/Documents/go-altcoinchain_FUSAKA"
    $GETH_BIN --datadir $DATADIR \
        --networkid 2330 \
        --port 31303 \
        --http --http.port 8332 \
        --http.api personal,eth,net,web3,miner,admin,debug,txpool \
        --http.corsdomain "*" \
        --allow-insecure-unlock \
        --syncmode=full &
    sleep 5
fi

# Check if React wallet is running, if not start it
if ! curl -s http://localhost:3000 > /dev/null 2>&1; then
    echo "Starting React wallet server..."
    cd "$REACT_DIR"
    npm start > /tmp/wallet-react.log 2>&1 &

    # Wait for React to start
    echo "Waiting for wallet to start..."
    for i in {1..30}; do
        if curl -s http://localhost:3000 > /dev/null 2>&1; then
            break
        fi
        sleep 1
    done
fi

# Start the Electron wallet
cd "$WALLET_DIR"
npx electron .
