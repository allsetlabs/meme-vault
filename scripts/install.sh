#!/bin/bash
# Install meme-vault Launch Agents
# Worker: every 10 mins | Sync: every 6 hours | Both run on login

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"

echo "Installing meme-vault Launch Agents..."
echo ""

# Create LaunchAgents directory if it doesn't exist
mkdir -p "$LAUNCH_AGENTS_DIR"

# Unload existing agents if they're running
echo "Unloading existing agents (if any)..."
launchctl unload "$LAUNCH_AGENTS_DIR/com.meme-vault.worker.plist" 2>/dev/null || true
launchctl unload "$LAUNCH_AGENTS_DIR/com.meme-vault.cron.plist" 2>/dev/null || true

# Copy plist files
echo "Copying plist files..."
cp "$SCRIPT_DIR/com.meme-vault.worker.plist" "$LAUNCH_AGENTS_DIR/"
cp "$SCRIPT_DIR/com.meme-vault.cron.plist" "$LAUNCH_AGENTS_DIR/"

# Load agents
echo "Loading agents..."
launchctl load "$LAUNCH_AGENTS_DIR/com.meme-vault.worker.plist"
launchctl load "$LAUNCH_AGENTS_DIR/com.meme-vault.cron.plist"

echo ""
echo "Done! Launch Agents installed successfully."
echo ""
echo "Schedule:"
echo "  - Worker: Every 10 minutes (and on login)"
echo "  - Sync:   Every 6 hours (and on login)"
echo ""
echo "Logs:"
echo "  - Worker: /tmp/meme-vault-worker.log"
echo "  - Sync:   /tmp/meme-vault-cron.log"
echo ""
echo "Commands:"
echo "  - Check status:  npm run scheduler:status"
echo "  - View logs:     npm run scheduler:logs"
echo "  - Uninstall:     npm run scheduler:uninstall"
