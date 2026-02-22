#!/usr/bin/env bash
# setup.sh — Bootstrap Viridian on a fresh clone.
#
# Safe to run multiple times (idempotent). Called automatically by start-lan.sh.
# Can also be run standalone: bash setup.sh
#
# What it does:
#   1. Checks Node.js (requires v20+)
#   2. Installs pnpm if missing
#   3. Installs npm dependencies (skips if lockfile unchanged)
#   4. Copies .env.example → .env if .env is missing
#   5. Installs podman-compose if podman is present but compose is missing
#   6. Pulls Langfuse container images (if compose is available)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ── Helpers ──────────────────────────────────────────────────────────────────

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BOLD='\033[1m'; NC='\033[0m'
ok()   { echo -e "  ${GREEN}✓${NC}  $*"; }
warn() { echo -e "  ${YELLOW}⚠${NC}  $*"; }
err()  { echo -e "  ${RED}✗${NC}  $*"; }
step() { echo -e "\n${BOLD}→ $*${NC}"; }

# Run a command on the host even when inside a Flatpak sandbox
host() {
  if [ -f /.flatpak-info ]; then
    flatpak-spawn --host bash -c "$*"
  else
    bash -c "$*"
  fi
}

echo ""
echo -e "${BOLD}============================================${NC}"
echo -e "${BOLD}  viridian — Setup${NC}"
echo -e "${BOLD}============================================${NC}"

# ── 1. Node.js ───────────────────────────────────────────────────────────────

step "Node.js"
if ! host "command -v node" &>/dev/null; then
  err "Node.js not found."
  echo ""
  echo "  Install via fnm (recommended):"
  echo "    curl -fsSL https://fnm.vercel.app/install | bash"
  echo "    source ~/.bashrc   # or restart your terminal"
  echo "    fnm install 22"
  echo ""
  echo "  Or download from https://nodejs.org"
  exit 1
fi
NODE_VER=$(host "node --version")
MIN_MAJOR=20
ACTUAL_MAJOR=$(echo "$NODE_VER" | grep -oP '(?<=v)\d+')
if [ "$ACTUAL_MAJOR" -lt "$MIN_MAJOR" ]; then
  err "Node.js $NODE_VER is too old (need v${MIN_MAJOR}+). Run: fnm install 22"
  exit 1
fi
ok "Node.js $NODE_VER"

# ── 2. pnpm ──────────────────────────────────────────────────────────────────

step "pnpm"
if ! host "command -v pnpm" &>/dev/null; then
  warn "pnpm not found — installing via npm..."
  host "npm install -g pnpm" 2>&1 | sed 's/^/    /'
fi
PNPM_VER=$(host "pnpm --version")
ok "pnpm $PNPM_VER"

# ── 3. npm dependencies ──────────────────────────────────────────────────────

step "Dependencies"
LOCKFILE="$SCRIPT_DIR/pnpm-lock.yaml"
STAMP="$SCRIPT_DIR/node_modules/.install-stamp"

needs_install=false
if [ ! -d "$SCRIPT_DIR/node_modules" ]; then
  needs_install=true
elif [ ! -f "$STAMP" ] || [ "$LOCKFILE" -nt "$STAMP" ]; then
  needs_install=true
fi

if $needs_install; then
  warn "Installing packages (lockfile changed or first run)..."
  host "cd '$SCRIPT_DIR' && pnpm install" 2>&1 | sed 's/^/    /'
  touch "$STAMP"
  ok "Packages installed"
else
  ok "Already up to date"
fi

# ── 4. .env ──────────────────────────────────────────────────────────────────

step ".env"
if [ ! -f "$SCRIPT_DIR/.env" ]; then
  cp "$SCRIPT_DIR/.env.example" "$SCRIPT_DIR/.env"
  warn ".env created from .env.example"
  warn "Edit .env to set JWT_SECRET and Langfuse keys before production use."
else
  ok ".env exists"
fi

# ── 5. Container runtime ─────────────────────────────────────────────────────

step "Container runtime (for Langfuse)"
COMPOSE_CMD=""

if host "command -v podman-compose" &>/dev/null; then
  COMPOSE_CMD="podman-compose"
  ok "podman-compose $(host 'podman-compose --version 2>/dev/null || echo ""')"
elif host "command -v docker" &>/dev/null; then
  COMPOSE_CMD="docker compose"
  ok "docker $(host 'docker --version')"
elif host "command -v podman" &>/dev/null; then
  # Podman is available but podman-compose isn't — try to install it
  warn "podman found but podman-compose is missing — installing..."
  if host "command -v pip3" &>/dev/null; then
    host "pip3 install --user podman-compose" 2>&1 | sed 's/^/    /'
    # Reload PATH to find newly installed binary
    export PATH="$HOME/.local/bin:$PATH"
    if host "command -v podman-compose" &>/dev/null; then
      COMPOSE_CMD="podman-compose"
      ok "podman-compose installed"
    else
      warn "podman-compose installed but not in PATH yet. Re-run after restarting terminal."
    fi
  else
    # Try system package manager
    if host "command -v dnf" &>/dev/null; then
      warn "Installing via dnf (may ask for sudo)..."
      host "sudo dnf install -y podman-compose" 2>&1 | sed 's/^/    /'
      COMPOSE_CMD="podman-compose"
      ok "podman-compose installed via dnf"
    elif host "command -v apt-get" &>/dev/null; then
      warn "Installing via apt (may ask for sudo)..."
      host "sudo apt-get install -y podman-compose" 2>&1 | sed 's/^/    /'
      COMPOSE_CMD="podman-compose"
      ok "podman-compose installed via apt"
    else
      warn "Could not auto-install podman-compose. Install it manually:"
      warn "  Fedora/RHEL: sudo dnf install podman-compose"
      warn "  Debian/Ubuntu: sudo apt install podman-compose"
      warn "  Any: pip3 install --user podman-compose"
    fi
  fi
else
  warn "No container runtime found. Langfuse observability will be unavailable."
  warn "To install on Fedora/RHEL:  sudo dnf install podman podman-compose"
  warn "To install on Debian/Ubuntu: sudo apt install podman podman-compose"
  warn "Or install Docker:  https://docs.docker.com/get-docker/"
fi

# ── 6. Pull Langfuse images ──────────────────────────────────────────────────

if [ -n "$COMPOSE_CMD" ]; then
  step "Langfuse images"
  # Check if images are already pulled to avoid re-downloading on every run
  if host "command -v podman" &>/dev/null; then
    LANGFUSE_PULLED=$(host "podman images --format '{{.Repository}}:{{.Tag}}' 2>/dev/null | grep -c 'langfuse/langfuse:2'" || true)
  else
    LANGFUSE_PULLED=$(host "docker images --format '{{.Repository}}:{{.Tag}}' 2>/dev/null | grep -c 'langfuse/langfuse:2'" || true)
  fi

  if [ "${LANGFUSE_PULLED:-0}" -eq 0 ]; then
    warn "Pulling Langfuse + Postgres images (one-time download)..."
    host "cd '$SCRIPT_DIR' && $COMPOSE_CMD pull" 2>&1 | sed 's/^/    /'
    ok "Images pulled"
  else
    ok "Images already present"
  fi
fi

# ── Done ─────────────────────────────────────────────────────────────────────

echo ""
echo -e "${BOLD}============================================${NC}"
echo -e "${GREEN}${BOLD}  Setup complete!${NC}"
echo ""
echo "  Run:  ./start-lan.sh"
echo -e "${BOLD}============================================${NC}"
echo ""
