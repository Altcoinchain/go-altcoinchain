#!/bin/bash
# Altcoinchain Release Builder
# Builds Linux and Windows releases with desktop launchers

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="$ROOT_DIR/build/bin"
RELEASE_DIR="$ROOT_DIR/release"
VERSION="${VERSION:-1.1.0}"
WALLET_DIR="$ROOT_DIR/wallet/wallet-desktop"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log() { echo -e "${GREEN}[Build]${NC} $1"; }
warn() { echo -e "${YELLOW}[Warning]${NC} $1"; }
info() { echo -e "${CYAN}[Info]${NC} $1"; }

echo -e "${CYAN}"
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║           ALTCOINCHAIN RELEASE BUILDER v$VERSION             ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# Create release directories
mkdir -p "$RELEASE_DIR"

build_linux() {
    local ARCH="${1:-amd64}"
    local RELEASE_NAME="altcoinchain-v${VERSION}-linux-${ARCH}"
    local TARGET_DIR="$RELEASE_DIR/$RELEASE_NAME"

    log "Building Linux $ARCH release..."

    # Build geth for Linux
    cd "$ROOT_DIR"
    GOOS=linux GOARCH=$ARCH go build -o "$BUILD_DIR/geth-linux-$ARCH" ./cmd/geth
    GOOS=linux GOARCH=$ARCH go build -o "$BUILD_DIR/bootnode-linux-$ARCH" ./cmd/bootnode
    GOOS=linux GOARCH=$ARCH go build -o "$BUILD_DIR/clef-linux-$ARCH" ./cmd/clef

    # Create release directory
    rm -rf "$TARGET_DIR"
    mkdir -p "$TARGET_DIR"
    mkdir -p "$TARGET_DIR/wallet"

    # Copy binaries
    cp "$BUILD_DIR/geth-linux-$ARCH" "$TARGET_DIR/geth"
    cp "$BUILD_DIR/bootnode-linux-$ARCH" "$TARGET_DIR/bootnode"
    cp "$BUILD_DIR/clef-linux-$ARCH" "$TARGET_DIR/clef"
    chmod +x "$TARGET_DIR/geth" "$TARGET_DIR/bootnode" "$TARGET_DIR/clef"

    # Copy genesis and contracts
    [ -f "$ROOT_DIR/altcoinchain-genesis.json" ] && cp "$ROOT_DIR/altcoinchain-genesis.json" "$TARGET_DIR/genesis.json"
    [ -f "$ROOT_DIR/contracts/staking/ValidatorStaking.sol" ] && cp "$ROOT_DIR/contracts/staking/ValidatorStaking.sol" "$TARGET_DIR/"
    [ -f "$ROOT_DIR/contracts/staking/build/ValidatorStaking.abi" ] && cp "$ROOT_DIR/contracts/staking/build/ValidatorStaking.abi" "$TARGET_DIR/"

    # Copy wallet files
    cp -r "$WALLET_DIR"/* "$TARGET_DIR/wallet/" 2>/dev/null || true
    rm -rf "$TARGET_DIR/wallet/node_modules" 2>/dev/null || true

    # Copy launcher scripts
    cp "$SCRIPT_DIR/launchers/linux/start-altcoinchain.sh" "$TARGET_DIR/"
    cp "$SCRIPT_DIR/launchers/linux/start-wallet.sh" "$TARGET_DIR/"
    cp "$SCRIPT_DIR/launchers/linux/install-desktop.sh" "$TARGET_DIR/"
    cp "$SCRIPT_DIR/launchers/linux/altcoinchain.desktop" "$TARGET_DIR/"
    cp "$SCRIPT_DIR/launchers/linux/altcoinchain-wallet.desktop" "$TARGET_DIR/"
    chmod +x "$TARGET_DIR"/*.sh

    # Copy icon
    [ -f "$WALLET_DIR/icon.png" ] && cp "$WALLET_DIR/icon.png" "$TARGET_DIR/"

    # Copy README
    cp "$SCRIPT_DIR/launchers/README-RELEASE.txt" "$TARGET_DIR/README.txt"

    # Create archive
    cd "$RELEASE_DIR"
    tar -czvf "${RELEASE_NAME}.tar.gz" "$RELEASE_NAME"

    log "Linux $ARCH release created: ${RELEASE_NAME}.tar.gz"
}

build_windows() {
    local ARCH="${1:-amd64}"
    local RELEASE_NAME="altcoinchain-v${VERSION}-windows-${ARCH}"
    local TARGET_DIR="$RELEASE_DIR/$RELEASE_NAME"

    log "Building Windows $ARCH release..."

    # Build geth for Windows
    cd "$ROOT_DIR"
    GOOS=windows GOARCH=$ARCH go build -o "$BUILD_DIR/geth-windows-$ARCH.exe" ./cmd/geth
    GOOS=windows GOARCH=$ARCH go build -o "$BUILD_DIR/bootnode-windows-$ARCH.exe" ./cmd/bootnode
    GOOS=windows GOARCH=$ARCH go build -o "$BUILD_DIR/clef-windows-$ARCH.exe" ./cmd/clef

    # Create release directory
    rm -rf "$TARGET_DIR"
    mkdir -p "$TARGET_DIR"
    mkdir -p "$TARGET_DIR/wallet"

    # Copy binaries
    cp "$BUILD_DIR/geth-windows-$ARCH.exe" "$TARGET_DIR/geth.exe"
    cp "$BUILD_DIR/bootnode-windows-$ARCH.exe" "$TARGET_DIR/bootnode.exe"
    cp "$BUILD_DIR/clef-windows-$ARCH.exe" "$TARGET_DIR/clef.exe"

    # Copy genesis and contracts
    [ -f "$ROOT_DIR/altcoinchain-genesis.json" ] && cp "$ROOT_DIR/altcoinchain-genesis.json" "$TARGET_DIR/genesis.json"
    [ -f "$ROOT_DIR/contracts/staking/ValidatorStaking.sol" ] && cp "$ROOT_DIR/contracts/staking/ValidatorStaking.sol" "$TARGET_DIR/"
    [ -f "$ROOT_DIR/contracts/staking/build/ValidatorStaking.abi" ] && cp "$ROOT_DIR/contracts/staking/build/ValidatorStaking.abi" "$TARGET_DIR/"

    # Copy wallet files
    cp -r "$WALLET_DIR"/* "$TARGET_DIR/wallet/" 2>/dev/null || true
    rm -rf "$TARGET_DIR/wallet/node_modules" 2>/dev/null || true

    # Copy Windows launcher scripts
    cp "$SCRIPT_DIR/launchers/windows/start-altcoinchain.bat" "$TARGET_DIR/"
    cp "$SCRIPT_DIR/launchers/windows/start-wallet.bat" "$TARGET_DIR/"
    cp "$SCRIPT_DIR/launchers/windows/stop-altcoinchain.bat" "$TARGET_DIR/"
    cp "$SCRIPT_DIR/launchers/windows/install-shortcut.bat" "$TARGET_DIR/"

    # Copy icon
    [ -f "$WALLET_DIR/icon.png" ] && cp "$WALLET_DIR/icon.png" "$TARGET_DIR/"
    [ -f "$SCRIPT_DIR/launchers/windows/altcoinchain.ico" ] && cp "$SCRIPT_DIR/launchers/windows/altcoinchain.ico" "$TARGET_DIR/"

    # Copy README
    cp "$SCRIPT_DIR/launchers/README-RELEASE.txt" "$TARGET_DIR/README.txt"

    # Create archive
    cd "$RELEASE_DIR"
    zip -r "${RELEASE_NAME}.zip" "$RELEASE_NAME"

    log "Windows $ARCH release created: ${RELEASE_NAME}.zip"
}

# Parse arguments
BUILD_LINUX=false
BUILD_WINDOWS=false

if [ $# -eq 0 ]; then
    BUILD_LINUX=true
    BUILD_WINDOWS=true
else
    for arg in "$@"; do
        case $arg in
            linux) BUILD_LINUX=true ;;
            windows) BUILD_WINDOWS=true ;;
            all) BUILD_LINUX=true; BUILD_WINDOWS=true ;;
            *) warn "Unknown argument: $arg" ;;
        esac
    done
fi

# Build releases
if [ "$BUILD_LINUX" = true ]; then
    build_linux amd64
fi

if [ "$BUILD_WINDOWS" = true ]; then
    build_windows amd64
fi

echo ""
log "Release build complete!"
info "Release files are in: $RELEASE_DIR"
ls -la "$RELEASE_DIR"/*.tar.gz "$RELEASE_DIR"/*.zip 2>/dev/null || true
