#!/bin/bash
# Uninstall meme-vault Launch Agents

set -e

LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"

echo "Uninstalling meme-vault Launch Agents..."
echo ""

# Unload agents
echo "Unloading agents..."
launchctl unload "$LAUNCH_AGENTS_DIR/com.meme-vault.worker.plist" 2>/dev/null || true
launchctl unload "$LAUNCH_AGENTS_DIR/com.meme-vault.cron.plist" 2>/dev/null || true

# Remove plist files
echo "Removing plist files..."
rm -f "$LAUNCH_AGENTS_DIR/com.meme-vault.worker.plist"
rm -f "$LAUNCH_AGENTS_DIR/com.meme-vault.cron.plist"

echo ""
echo "Done! Launch Agents uninstalled."
