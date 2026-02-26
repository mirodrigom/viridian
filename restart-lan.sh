#!/usr/bin/env bash
# restart-lan.sh — Kill running server/client and restart in LAN mode
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

PORT="${PORT:-3010}"

echo "Stopping running instances..."

kill_procs() {
  # Cross-platform process killing
  if command -v pkill &>/dev/null; then
    # Linux/macOS
    pkill -f 'vite.*viridian' 2>/dev/null || true
    pkill -f 'tsx.*viridian' 2>/dev/null || true
    pkill -f 'concurrently.*viridian' 2>/dev/null || true
  fi

  # Kill anything still holding the ports
  if command -v fuser &>/dev/null; then
    fuser -k "${PORT}/tcp" 2>/dev/null || true
    fuser -k 5174/tcp 2>/dev/null || true
    fuser -k 5175/tcp 2>/dev/null || true
    fuser -k 7575/tcp 2>/dev/null || true
  elif command -v npx &>/dev/null; then
    # Windows (Git Bash) — use Node.js to find and kill by port
    for p in "${PORT}" 5174 5175 7575; do
      node -e "
        const { execSync } = require('child_process');
        try {
          const out = execSync('netstat -ano | findstr :$p', { encoding: 'utf8' });
          const pids = [...new Set(out.split('\\n').map(l => l.trim().split(/\\s+/).pop()).filter(p => p && p !== '0'))];
          pids.forEach(pid => { try { process.kill(Number(pid)); } catch {} });
        } catch {}
      " 2>/dev/null || true
    done
  fi
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
