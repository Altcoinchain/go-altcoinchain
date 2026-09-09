#!/bin/bash
# NVIDIA GPU Mining Script for Altcoinchain
# Uses CUDA for mining

WALLET_ADDRESS="${1:-0x8324FA247756a9D2Be9D16884f620e65a142E514}"
RPC_URL="http://127.0.0.1:8545"

echo "=========================================="
echo "  Altcoinchain NVIDIA GPU Miner"
echo "=========================================="
echo "  Wallet: $WALLET_ADDRESS"
echo "  Node: $RPC_URL"
echo "=========================================="
echo ""

# Check if ethminer exists
if ! command -v ethminer &> /dev/null; then
    if [ -f "$HOME/.local/bin/ethminer" ]; then
        export PATH="$HOME/.local/bin:$PATH"
    else
        echo "Error: ethminer not found. Run setup-gpu-mining.sh first."
        exit 1
    fi
fi

# Set the coinbase address on the node
echo "Setting mining address..."
curl -s -X POST -H "Content-Type: application/json" \
    --data "{\"jsonrpc\":\"2.0\",\"method\":\"miner_setEtherbase\",\"params\":[\"$WALLET_ADDRESS\"],\"id\":1}" \
    $RPC_URL > /dev/null

echo "Starting NVIDIA GPU miner..."
echo "Press Ctrl+C to stop"
echo ""

# Start ethminer with CUDA
ethminer -U -P $RPC_URL --report-hashrate
