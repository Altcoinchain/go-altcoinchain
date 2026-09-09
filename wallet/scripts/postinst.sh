#!/bin/bash
# Post-installation script for Altcoinchain Wallet

set -e

INSTALL_DIR="/opt/Altcoinchain Wallet"
DESKTOP_FILE="/usr/share/applications/altcoinchain-wallet.desktop"
ICON_DIR="/usr/share/icons/hicolor"
AUTOSTART_DIR="/etc/xdg/autostart"

# Make geth executable
if [ -f "$INSTALL_DIR/resources/geth" ]; then
    chmod +x "$INSTALL_DIR/resources/geth"
fi

# Create symlink for command-line access
if [ ! -f /usr/local/bin/altcoinchain-wallet ]; then
    ln -sf "$INSTALL_DIR/altcoinchain-wallet" /usr/local/bin/altcoinchain-wallet 2>/dev/null || true
fi

# Install icons in various sizes
mkdir -p "$ICON_DIR/16x16/apps"
mkdir -p "$ICON_DIR/32x32/apps"
mkdir -p "$ICON_DIR/48x48/apps"
mkdir -p "$ICON_DIR/64x64/apps"
mkdir -p "$ICON_DIR/128x128/apps"
mkdir -p "$ICON_DIR/256x256/apps"
mkdir -p "$ICON_DIR/512x512/apps"

# Copy icon
if [ -f "$INSTALL_DIR/resources/app/icon.png" ]; then
    cp "$INSTALL_DIR/resources/app/icon.png" "$ICON_DIR/256x256/apps/altcoinchain-wallet.png" 2>/dev/null || true
fi

# Create desktop entry
cat > "$DESKTOP_FILE" << 'DESKTOPEOF'
[Desktop Entry]
Name=Altcoinchain Wallet
Comment=Altcoinchain Desktop Wallet - Hybrid PoW/PoS Blockchain
Exec=/opt/Altcoinchain\ Wallet/altcoinchain-wallet %U
Icon=altcoinchain-wallet
Terminal=false
Type=Application
Categories=Finance;Network;Utility;
Keywords=altcoin;crypto;blockchain;wallet;ALT;cryptocurrency;
StartupWMClass=Altcoinchain Wallet
MimeType=x-scheme-handler/altcoinchain;
DESKTOPEOF

# Make desktop file executable
chmod +x "$DESKTOP_FILE"

# Create autostart entry (disabled by default)
mkdir -p "$AUTOSTART_DIR"
cat > "$AUTOSTART_DIR/altcoinchain-wallet.desktop" << 'AUTOSTARTEOF'
[Desktop Entry]
Name=Altcoinchain Wallet
Comment=Start Altcoinchain Wallet on login
Exec=/opt/Altcoinchain\ Wallet/altcoinchain-wallet --hidden
Icon=altcoinchain-wallet
Terminal=false
Type=Application
Categories=Finance;Network;
X-GNOME-Autostart-enabled=false
Hidden=true
AUTOSTARTEOF

# Update desktop database
if command -v update-desktop-database > /dev/null 2>&1; then
    update-desktop-database /usr/share/applications 2>/dev/null || true
fi

# Update icon cache
if command -v gtk-update-icon-cache > /dev/null 2>&1; then
    gtk-update-icon-cache -f -t "$ICON_DIR" 2>/dev/null || true
fi

# Update mime database
if command -v update-mime-database > /dev/null 2>&1; then
    update-mime-database /usr/share/mime 2>/dev/null || true
fi

# Register as default handler for altcoinchain:// URIs
if command -v xdg-mime > /dev/null 2>&1; then
    xdg-mime default altcoinchain-wallet.desktop x-scheme-handler/altcoinchain 2>/dev/null || true
fi

echo ""
echo "============================================="
echo "  Altcoinchain Wallet installed successfully!"
echo "============================================="
echo ""
echo "You can now:"
echo "  - Launch from your application menu (Finance category)"
echo "  - Search for Altcoinchain in your app launcher"
echo "  - Run from terminal: altcoinchain-wallet"
echo "  - Add to favorites/taskbar by right-clicking the icon"
echo ""

exit 0
