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

LANGFUSE_PORT="${LANGFUSE_PORT:-3001}"
export LANGFUSE_BASE_URL="http://${LAN_IP}:${LANGFUSE_PORT}"

echo "============================================"
echo "  viridian — LAN Mode"
echo "============================================"
echo "  LAN IP:   ${LAN_IP}"
echo "  Client:   http://${LAN_IP}:5174"
echo "  Server:   http://${LAN_IP}:${PORT}"
echo "  Docs:     http://${LAN_IP}:${DOCS_PORT}"
echo "  Langfuse: http://${LAN_IP}:${LANGFUSE_PORT}"
echo "  D2 Map:   http://${LAN_IP}:7575"
echo "============================================"
echo ""

# Start Langfuse — detect podman-compose or docker compose
COMPOSE_CMD=""
if command -v podman-compose &>/dev/null; then
  COMPOSE_CMD="podman-compose"
elif command -v docker &>/dev/null; then
  COMPOSE_CMD="docker compose"
fi

if [ -n "$COMPOSE_CMD" ]; then
  echo "→ Starting Langfuse ($COMPOSE_CMD)..."
  if [ -f /.flatpak-info ]; then
    flatpak-spawn --host bash -c "cd '$SCRIPT_DIR' && $COMPOSE_CMD up -d"
  else
    $COMPOSE_CMD up -d
  fi
  echo "  Langfuse dashboard: http://${LAN_IP}:${LANGFUSE_PORT}"
  echo ""
  # Open browser to Langfuse dashboard
  xdg-open "http://${LAN_IP}:${LANGFUSE_PORT}" 2>/dev/null || true
else
  echo "  (Neither podman-compose nor docker found — skipping Langfuse)"
  echo ""
fi

# Start D2 Interactive Map dev server in background
D2_DIR="/home/rodrigom/Documents/proyects/d2-interactive-map"
if [ -d "$D2_DIR" ]; then
  echo "→ Starting D2 Interactive Map (port 7575)..."
  if [ -f /.flatpak-info ]; then
    flatpak-spawn --host bash -c "cd '$D2_DIR' && npm run dev" &
  else
    (cd "$D2_DIR" && npm run dev) &
  fi
  D2_PID=$!
  trap 'kill $D2_PID 2>/dev/null || true' EXIT
  echo ""
fi

# Run pnpm (via flatpak-spawn if inside Flatpak sandbox)
# Starts server, client, AND docs dev server
if [ -f /.flatpak-info ]; then
  flatpak-spawn --host bash -c "cd '$SCRIPT_DIR' && HOST=0.0.0.0 PORT=${PORT} CORS_ORIGIN='http://${LAN_IP}:5174' LANGFUSE_BASE_URL='http://${LAN_IP}:${LANGFUSE_PORT}' LANGFUSE_SECRET_KEY='${LANGFUSE_SECRET_KEY:-}' LANGFUSE_PUBLIC_KEY='${LANGFUSE_PUBLIC_KEY:-}' VITE_HOST=0.0.0.0 pnpm dev:all"
else
  pnpm dev:all
fi
