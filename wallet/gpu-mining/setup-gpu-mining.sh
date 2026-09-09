#!/bin/bash
# GPU Mining Setup Script for Altcoinchain
# This script sets up ethminer for GPU mining

set -e

ETHMINER_VERSION="0.19.0"
INSTALL_DIR="$HOME/.local/bin"
RPC_URL="http://127.0.0.1:8545"

echo "=========================================="
echo "  Altcoinchain GPU Mining Setup"
echo "=========================================="
echo ""

# Create install directory
mkdir -p "$INSTALL_DIR"

# Detect GPU
echo "Detecting GPU..."
if lspci | grep -qi nvidia; then
    GPU_TYPE="nvidia"
    echo "  Found: NVIDIA GPU"
elif lspci | grep -qi amd; then
    GPU_TYPE="amd"
    echo "  Found: AMD GPU"
else
    echo "  No GPU detected. GPU mining requires NVIDIA or AMD graphics card."
    exit 1
fi

# Download ethminer if not present
if [ ! -f "$INSTALL_DIR/ethminer" ]; then
    echo ""
    echo "Downloading ethminer v${ETHMINER_VERSION}..."

    if [ "$GPU_TYPE" = "nvidia" ]; then
        DOWNLOAD_URL="https://github.com/ethereum-mining/ethminer/releases/download/v${ETHMINER_VERSION}/ethminer-${ETHMINER_VERSION}-cuda-9-linux-x86_64.tar.gz"
    else
        DOWNLOAD_URL="https://github.com/ethereum-mining/ethminer/releases/download/v${ETHMINER_VERSION}/ethminer-${ETHMINER_VERSION}-linux-x86_64.tar.gz"
    fi

    cd /tmp
    wget -q --show-progress "$DOWNLOAD_URL" -O ethminer.tar.gz
    tar -xzf ethminer.tar.gz
    mv bin/ethminer "$INSTALL_DIR/"
    rm -rf ethminer.tar.gz bin
    chmod +x "$INSTALL_DIR/ethminer"
    echo "  Installed to: $INSTALL_DIR/ethminer"
fi

# Add to PATH if needed
if [[ ":$PATH:" != *":$INSTALL_DIR:"* ]]; then
    echo ""
    echo "Adding $INSTALL_DIR to PATH..."
    echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
    export PATH="$INSTALL_DIR:$PATH"
fi

echo ""
echo "=========================================="
echo "  Setup Complete!"
echo "=========================================="
echo ""
echo "To start GPU mining, run:"
echo ""
if [ "$GPU_TYPE" = "nvidia" ]; then
    echo "  ethminer -U -P http://127.0.0.1:8545"
    echo ""
    echo "  -U = Use CUDA (NVIDIA)"
else
    echo "  ethminer -G -P http://127.0.0.1:8545"
    echo ""
    echo "  -G = Use OpenCL (AMD)"
fi
echo "  -P = Pool/Node URL"
echo ""
echo "Make sure your geth node is running with mining enabled!"
echo ""
