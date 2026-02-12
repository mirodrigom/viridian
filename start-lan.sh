#!/usr/bin/env bash
# start-lan.sh — Start claude-code-web accessible on LAN (0.0.0.0)
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
export CORS_ORIGIN="http://${LAN_IP}:5174"

# Client config
export VITE_HOST="0.0.0.0"

echo "============================================"
echo "  claude-code-web — LAN Mode"
echo "============================================"
echo "  LAN IP:   ${LAN_IP}"
echo "  Client:   http://${LAN_IP}:5174"
echo "  Server:   http://${LAN_IP}:${PORT}"
echo "============================================"
echo ""

# Run pnpm (via flatpak-spawn if inside Flatpak sandbox)
if [ -f /.flatpak-info ]; then
  flatpak-spawn --host bash -c "cd '$SCRIPT_DIR' && HOST=0.0.0.0 PORT=${PORT} CORS_ORIGIN='http://${LAN_IP}:5174' VITE_HOST=0.0.0.0 pnpm dev"
else
  pnpm dev
fi
