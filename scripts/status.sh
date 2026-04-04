#!/bin/bash
# Check status of meme-vault Launch Agents

echo "Meme Vault Launch Agents Status"
echo "================================"
echo ""

echo "Worker (every 10 mins):"
if launchctl list | grep -q "com.meme-vault.worker"; then
    echo "  Status: Running"
    launchctl list com.meme-vault.worker 2>/dev/null | head -5
else
    echo "  Status: Not loaded"
fi

echo ""
echo "Sync (every 6 hours):"
if launchctl list | grep -q "com.meme-vault.cron"; then
    echo "  Status: Running"
    launchctl list com.meme-vault.cron 2>/dev/null | head -5
else
    echo "  Status: Not loaded"
fi

echo ""
echo "Recent Logs:"
echo "------------"
echo ""
echo "Worker (last 10 lines):"
if [ -f /tmp/meme-vault-worker.log ]; then
    tail -10 /tmp/meme-vault-worker.log
else
    echo "  No logs yet"
fi

echo ""
echo "Sync (last 10 lines):"
if [ -f /tmp/meme-vault-cron.log ]; then
    tail -10 /tmp/meme-vault-cron.log
else
    echo "  No logs yet"
fi
