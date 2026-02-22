#!/usr/bin/env bash
# start-lan.sh — Start viridian accessible on LAN (0.0.0.0)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Detect local IP (works inside Flatpak and on host)
if [ -f /.flatpak-info ]; then
  LAN_IP=$(flatpak-spawn --host bash -c "ip route get 1.1.1.1 | grep -oP 'src \K[\d.]+'")
else
  LAN_IP=$(ip route get 1.1.1.1 | grep -oP 'src \K[\d.]+')
fi

# Server config
export HOST="0.0.0.0"
export PORT="${PORT:-3010}"
export DOCS_PORT="${DOCS_PORT:-5173}"
export CORS_ORIGIN="http://${LAN_IP}:5174"

# Client config
export VITE_HOST="0.0.0.0"

echo "============================================"
echo "  viridian — LAN Mode"
echo "============================================"
echo "  LAN IP:   ${LAN_IP}"
echo "  Client:   http://${LAN_IP}:5174"
echo "  Server:   http://${LAN_IP}:${PORT}"
echo "  Docs:     http://${LAN_IP}:${DOCS_PORT}"
echo "============================================"
echo ""

# Run pnpm (via flatpak-spawn if inside Flatpak sandbox)
# Starts server, client, AND docs dev server
if [ -f /.flatpak-info ]; then
  flatpak-spawn --host bash -c "cd '$SCRIPT_DIR' && HOST=0.0.0.0 PORT=${PORT} CORS_ORIGIN='http://${LAN_IP}:5174' VITE_HOST=0.0.0.0 pnpm dev:all"
else
  pnpm dev:all
fi
