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
#   5. Done!

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
ACTUAL_MAJOR=$(echo "$NODE_VER" | sed 's/v\([0-9]*\).*/\1/')
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

# Use a checksum of the lockfile so manual `pnpm install` doesn't trigger a re-install
LOCK_HASH=$(md5sum "$LOCKFILE" 2>/dev/null | cut -d' ' -f1)

needs_install=false
if [ ! -d "$SCRIPT_DIR/node_modules" ]; then
  needs_install=true
elif [ ! -f "$STAMP" ] || [ "$(cat "$STAMP" 2>/dev/null)" != "$LOCK_HASH" ]; then
  needs_install=true
fi

if $needs_install; then
  warn "Installing packages (lockfile changed or first run)..."
  host "cd '$SCRIPT_DIR' && pnpm install" 2>&1 | sed 's/^/    /'
  echo "$LOCK_HASH" > "$STAMP"
  ok "Packages installed"
else
  ok "Already up to date"
fi

# ── 4. .env ──────────────────────────────────────────────────────────────────

step ".env"
if [ ! -f "$SCRIPT_DIR/.env" ]; then
  cp "$SCRIPT_DIR/.env.example" "$SCRIPT_DIR/.env"
  warn ".env created from .env.example"
  warn "Edit .env to set JWT_SECRET before production use."
else
  ok ".env exists"
fi

# ── Done ─────────────────────────────────────────────────────────────────────

echo ""
echo -e "${BOLD}============================================${NC}"
echo -e "${GREEN}${BOLD}  Setup complete!${NC}"
echo ""
echo "  Run:  ./start-lan.sh"
echo -e "${BOLD}============================================${NC}"
echo ""
