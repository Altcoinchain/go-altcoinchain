#!/bin/bash
# Install Altcoinchain desktop launchers on Linux

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APPS_DIR="$HOME/.local/share/applications"
ICON_DIR="$HOME/.local/share/icons/hicolor/256x256/apps"

echo "Installing Altcoinchain desktop launchers..."

# Create directories
mkdir -p "$APPS_DIR"
mkdir -p "$ICON_DIR"

# Copy icon
if [ -f "$SCRIPT_DIR/icon.png" ]; then
    cp "$SCRIPT_DIR/icon.png" "$ICON_DIR/altcoinchain.png"
    echo "Icon installed"
fi

# Install node launcher
cat > "$APPS_DIR/altcoinchain.desktop" << EOF
[Desktop Entry]
Name=Altcoinchain Node
Comment=Altcoinchain Blockchain Node - Hybrid PoW/PoS
Exec=$SCRIPT_DIR/start-altcoinchain.sh
Icon=altcoinchain
Terminal=true
Type=Application
Categories=Finance;Network;
StartupWMClass=altcoinchain
Keywords=altcoin;blockchain;crypto;node;mining;
EOF

# Install wallet launcher
cat > "$APPS_DIR/altcoinchain-wallet.desktop" << EOF
[Desktop Entry]
Name=Altcoinchain Wallet
Comment=Altcoinchain Desktop Wallet - Hybrid PoW/PoS Blockchain
Exec=$SCRIPT_DIR/start-wallet.sh
Icon=altcoinchain
Terminal=false
Type=Application
Categories=Finance;Network;
StartupWMClass=altcoinchain-wallet
Keywords=altcoin;wallet;crypto;blockchain;ALT;
EOF

# Make executables
chmod +x "$APPS_DIR/altcoinchain.desktop"
chmod +x "$APPS_DIR/altcoinchain-wallet.desktop"

# Update desktop database
if command -v update-desktop-database &> /dev/null; then
    update-desktop-database "$APPS_DIR" 2>/dev/null
fi

echo ""
echo "Desktop launchers installed successfully!"
echo "You can now find Altcoinchain in your application menu."
echo ""
echo "Installed:"
echo "  - Altcoinchain Node (terminal mode)"
echo "  - Altcoinchain Wallet (GUI)"
