#!/bin/zsh
# Regenerates the downtrend/uptrend lists; run weekly by the launch agent in
# scripts/com.stock-identifier.weekly-screen.plist (see `npm run schedule:install`).
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
cd "${0:A:h}/.." || exit 1
mkdir -p logs
{
  echo "=== $(date '+%Y-%m-%d %H:%M:%S') ==="
  npm run screen 2>&1 | tr '\r' '\n' | grep -v -E '^(Market caps|Weekly candles): [0-9]+/'
  echo "exit: ${pipestatus[1]}"
} >> logs/weekly-screen.log
