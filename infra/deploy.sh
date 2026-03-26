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

npx cdk deploy "$@" --require-approval never

# ── 3. Invalidate CloudFront cache ────────────────────────────────────────────
step "Invalidating CloudFront cache..."
CF_DIST_ID=$(aws cloudformation describe-stacks \
  --stack-name ViridianStack \
  --query 'Stacks[0].Outputs[?OutputKey==`CloudFrontDistributionId`].OutputValue' \
  --output text 2>/dev/null || true)

if [ -n "$CF_DIST_ID" ]; then
  aws cloudfront create-invalidation --distribution-id "$CF_DIST_ID" --paths "/*" > /dev/null
  echo -e "  ${GREEN}✓${NC}  CloudFront cache invalidated ($CF_DIST_ID)"
else
  echo "  ⚠  Could not find CloudFront distribution ID — skip invalidation"
fi

# ── 4. Print outputs ─────────────────────────────────────────────────────────
step "Deployment complete!"
echo ""
echo -e "${GREEN}Stack outputs:${NC}"
aws cloudformation describe-stacks \
  --stack-name ViridianStack \
  --query 'Stacks[0].Outputs[*].[OutputKey,OutputValue]' \
  --output table 2>/dev/null || echo "  (run 'aws cloudformation describe-stacks --stack-name ViridianStack' to see outputs)"
echo ""
