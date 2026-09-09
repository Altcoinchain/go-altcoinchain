#!/bin/bash
# Install desktop launcher for Altcoinchain Wallet

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_FILE="$HOME/.local/share/applications/altcoinchain-wallet.desktop"

echo "Installing Altcoinchain Wallet desktop launcher..."

# Create the desktop file with correct paths
cat > "$DESKTOP_FILE" << EOF
[Desktop Entry]
Name=Altcoinchain Wallet
Comment=Altcoinchain Desktop Wallet - Hybrid PoW/PoS Blockchain
Exec=$SCRIPT_DIR/start-altcoinchain-wallet.sh
Icon=$SCRIPT_DIR/icon.png
Terminal=false
Type=Application
Categories=Finance;Network;
StartupWMClass=altcoinchain-wallet
Keywords=altcoin;wallet;crypto;blockchain;ALT;mining;
EOF

chmod +x "$DESKTOP_FILE"
chmod +x "$SCRIPT_DIR/start-altcoinchain-wallet.sh"
chmod +x "$SCRIPT_DIR/stop-altcoinchain.sh"

# Update desktop database
if command -v update-desktop-database &> /dev/null; then
    update-desktop-database "$HOME/.local/share/applications" 2>/dev/null
fi

echo "Desktop launcher installed successfully!"
echo "You can now find 'Altcoinchain Wallet' in your applications menu."
