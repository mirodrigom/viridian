#!/usr/bin/env bash
# start-lan.sh — Start viridian accessible on LAN (0.0.0.0)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ── Load .env (API keys, secrets) ────────────────────────────────────────────
if [ -f "$SCRIPT_DIR/.env" ]; then
  set -a
  source "$SCRIPT_DIR/.env"
  set +a
fi

# ── Bootstrap (runs setup.sh if anything is missing) ─────────────────────────
bash "$SCRIPT_DIR/setup.sh"

# Detect local IP
if [ -f /.flatpak-info ]; then
  LAN_IP=$(flatpak-spawn --host hostname -I 2>/dev/null | awk '{print $1}')
elif hostname -I &>/dev/null; then
  LAN_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
else
  # Windows / MINGW fallback
  LAN_IP=$(ipconfig 2>/dev/null | grep -m1 'IPv4' | awk -F': ' '{print $2}' | tr -d '\r')
fi
LAN_IP="${LAN_IP:-127.0.0.1}"


# Server config
export HOST="0.0.0.0"
export PORT="${PORT:-12000}"
export DOCS_PORT="${DOCS_PORT:-12002}"
export CORS_ORIGIN="https://${LAN_IP}:12001"

# Client config — HTTPS required for mic access on LAN
export VITE_HOST="0.0.0.0"
export VITE_HTTPS="1"

echo "============================================"
echo "  viridian — LAN Mode"
echo "============================================"
echo "  LAN IP:   ${LAN_IP}"
echo "  Client:   https://${LAN_IP}:12001"
echo "  Server:   http://${LAN_IP}:${PORT}"
echo "  Docs:     http://${LAN_IP}:${DOCS_PORT}"
echo "============================================"
echo ""

# Run pnpm (via flatpak-spawn if inside Flatpak sandbox)
# Starts server, client, AND docs dev server
if [ -f /.flatpak-info ]; then
  flatpak-spawn --host bash -c "cd '$SCRIPT_DIR' && HOST=0.0.0.0 PORT=${PORT} CORS_ORIGIN='https://${LAN_IP}:12001' VITE_HOST=0.0.0.0 VITE_HTTPS=1 pnpm dev:all"
else
  pnpm dev:all
fi
