#!/usr/bin/env bash
# restart-lan.sh — Kill running server/client and restart in LAN mode
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

PORT="${PORT:-3010}"

echo "Stopping running instances..."

kill_procs() {
  # Kill by process name patterns
  pkill -f 'vite.*claude-code-web' 2>/dev/null || true
  pkill -f 'tsx.*claude-code-web' 2>/dev/null || true
  pkill -f 'concurrently.*claude-code-web' 2>/dev/null || true

  # Kill anything still holding the ports
  fuser -k "${PORT}/tcp" 2>/dev/null || true
  fuser -k 5174/tcp 2>/dev/null || true
  fuser -k 5175/tcp 2>/dev/null || true
}

if [ -f /.flatpak-info ]; then
  flatpak-spawn --host bash -c "$(declare -f kill_procs); PORT=$PORT kill_procs"
else
  kill_procs
fi

# Give processes a moment to exit
sleep 2

echo "Starting fresh..."
exec "$SCRIPT_DIR/start-lan.sh"
