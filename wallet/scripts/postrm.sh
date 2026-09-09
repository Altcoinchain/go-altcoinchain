#!/bin/bash
# Post-removal script for Altcoinchain Wallet

set -e

# Remove symlink
if [ -L /usr/local/bin/altcoinchain-wallet ]; then
    rm -f /usr/local/bin/altcoinchain-wallet 2>/dev/null || true
fi

# Update desktop database
if command -v update-desktop-database &> /dev/null; then
    update-desktop-database /usr/share/applications 2>/dev/null || true
fi

# Note: We don't remove ~/.altcoinchain as it contains user data (blockchain, wallets)
echo "Altcoinchain Wallet has been removed."
echo "Note: Your blockchain data and wallets are preserved in ~/.altcoinchain"

exit 0
