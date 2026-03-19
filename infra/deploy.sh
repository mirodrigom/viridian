#!/usr/bin/env bash
# deploy.sh — Build and deploy Viridian to AWS (ECS + S3/CloudFront)
#
# Prerequisites:
#   - AWS CLI configured (aws configure)
#   - CDK bootstrapped (cd infra && npx cdk bootstrap)
#   - Node.js + pnpm installed
#
# Usage:
#   bash infra/deploy.sh              # full deploy
#   bash infra/deploy.sh --hotswap    # fast deploy (skips CloudFormation for ECS changes)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

GREEN='\033[0;32m'; BOLD='\033[1m'; NC='\033[0m'
step() { echo -e "\n${BOLD}→ $*${NC}"; }

# ── 1. Build client ──────────────────────────────────────────────────────────
step "Building client (Vite)..."
cd "$PROJECT_ROOT"
pnpm --filter client build

# ── 2. CDK deploy (builds Docker image + uploads client to S3) ───────────────
step "Deploying infrastructure (CDK)..."
cd "$SCRIPT_DIR"

if [ ! -d "node_modules" ]; then
  echo "  Installing CDK dependencies..."
  npm install
fi

npx cdk deploy "$@" --require-approval broadening

# ── 3. Print outputs ─────────────────────────────────────────────────────────
step "Deployment complete!"
echo ""
echo -e "${GREEN}Stack outputs:${NC}"
aws cloudformation describe-stacks \
  --stack-name ViridianStack \
  --query 'Stacks[0].Outputs[*].[OutputKey,OutputValue]' \
  --output table 2>/dev/null || echo "  (run 'aws cloudformation describe-stacks --stack-name ViridianStack' to see outputs)"
echo ""
