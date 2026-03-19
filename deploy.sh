#!/usr/bin/env bash
# deploy.sh — Unified deployment script for Viridian.
#
# Usage:
#   ./deploy.sh              # Start local development (pnpm dev)
#   ./deploy.sh --cloud      # Build & deploy to AWS (Docker → ECR → CDK → S3)
#   ./deploy.sh --build-only # Build Docker image only (no deploy)
#   ./deploy.sh --destroy    # Tear down AWS resources (cdk destroy)
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ── Helpers ──────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BOLD='\033[1m'; NC='\033[0m'
ok()   { echo -e "  ${GREEN}✓${NC}  $*"; }
warn() { echo -e "  ${YELLOW}⚠${NC}  $*"; }
err()  { echo -e "  ${RED}✗${NC}  $*" >&2; }
step() { echo -e "\n${BOLD}→ $*${NC}"; }

APP_NAME="viridian"
AWS_REGION="${AWS_REGION:-us-east-1}"
ECR_REPO="${APP_NAME}"
STACK_NAME="ViridianStack"

# ── Parse arguments ──────────────────────────────────────────────────────────
MODE="local"
for arg in "$@"; do
  case "$arg" in
    --cloud)      MODE="cloud" ;;
    --build-only) MODE="build-only" ;;
    --destroy)    MODE="destroy" ;;
    --help|-h)
      echo "Usage: ./deploy.sh [--cloud|--build-only|--destroy]"
      echo ""
      echo "  (no flag)     Start local development (pnpm dev)"
      echo "  --cloud       Build Docker image, push to ECR, deploy CDK stack, sync S3"
      echo "  --build-only  Build Docker image only (no deploy)"
      echo "  --destroy     Tear down all AWS resources (cdk destroy)"
      exit 0
      ;;
  esac
done

# ── Local mode ───────────────────────────────────────────────────────────────
if [ "$MODE" = "local" ]; then
  echo -e "${BOLD}Starting Viridian locally...${NC}"
  exec pnpm dev
fi

# ── Preflight checks for cloud modes ────────────────────────────────────────
check_tool() {
  if ! command -v "$1" &>/dev/null; then
    err "$1 is required but not installed."
    echo "  Install: $2"
    exit 1
  fi
}

check_tool "aws" "https://docs.aws.amazon.com/cli/latest/userguide/install-cliv2.html"
check_tool "docker" "https://docs.docker.com/get-docker/"
check_tool "npx" "npm install -g npx"

# Verify AWS credentials
if ! aws sts get-caller-identity &>/dev/null; then
  err "AWS credentials not configured. Run: aws configure"
  exit 1
fi

AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ECR_URI="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${ECR_REPO}"

# ── Destroy mode ─────────────────────────────────────────────────────────────
if [ "$MODE" = "destroy" ]; then
  step "Destroying ${STACK_NAME}..."
  cd "$SCRIPT_DIR/infra"
  npx cdk destroy "$STACK_NAME" --force
  ok "Stack destroyed"
  exit 0
fi

# ── Build Docker image ──────────────────────────────────────────────────────
step "Building Docker image"
docker build -t "${APP_NAME}:latest" .
ok "Docker image built: ${APP_NAME}:latest"

if [ "$MODE" = "build-only" ]; then
  ok "Build-only mode — done."
  exit 0
fi

# ── Push to ECR ──────────────────────────────────────────────────────────────
step "Pushing to ECR"

# Create ECR repo if it doesn't exist
aws ecr describe-repositories --repository-names "${ECR_REPO}" --region "${AWS_REGION}" &>/dev/null || \
  aws ecr create-repository --repository-name "${ECR_REPO}" --region "${AWS_REGION}" --image-scanning-configuration scanOnPush=true

# Login to ECR
aws ecr get-login-password --region "${AWS_REGION}" | \
  docker login --username AWS --password-stdin "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"

# Tag and push
docker tag "${APP_NAME}:latest" "${ECR_URI}:latest"
docker push "${ECR_URI}:latest"
ok "Image pushed to ${ECR_URI}:latest"

# ── Build client for S3 ─────────────────────────────────────────────────────
step "Building client for S3"
pnpm --filter client build
ok "Client built"

# ── CDK Deploy ───────────────────────────────────────────────────────────────
step "Deploying CDK stack"
cd "$SCRIPT_DIR/infra"

# Install CDK dependencies if needed
if [ ! -d "node_modules" ]; then
  warn "Installing CDK dependencies..."
  npm install
fi

# Bootstrap CDK (idempotent)
npx cdk bootstrap "aws://${AWS_ACCOUNT_ID}/${AWS_REGION}" 2>/dev/null || true

# Deploy
npx cdk deploy "$STACK_NAME" \
  --require-approval never \
  --outputs-file cdk-outputs.json \
  -c ecrImageUri="${ECR_URI}:latest"

ok "CDK stack deployed"

# ── Sync client to S3 ───────────────────────────────────────────────────────
step "Syncing client dist to S3"

# Extract bucket name from CDK outputs
S3_BUCKET=$(jq -r ".${STACK_NAME}.ClientBucketName" cdk-outputs.json)
CF_DIST_ID=$(jq -r ".${STACK_NAME}.CloudFrontDistributionId" cdk-outputs.json)
CF_URL=$(jq -r ".${STACK_NAME}.CloudFrontUrl" cdk-outputs.json)

aws s3 sync "$SCRIPT_DIR/client/dist" "s3://${S3_BUCKET}" --delete
ok "Client synced to s3://${S3_BUCKET}"

# ── Invalidate CloudFront ───────────────────────────────────────────────────
step "Invalidating CloudFront cache"
aws cloudfront create-invalidation \
  --distribution-id "${CF_DIST_ID}" \
  --paths "/*" > /dev/null
ok "CloudFront cache invalidated"

# ── Done ─────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}============================================${NC}"
echo -e "${GREEN}${BOLD}  Deployment complete!${NC}"
echo ""
echo -e "  URL: ${BOLD}${CF_URL}${NC}"
echo -e "${BOLD}============================================${NC}"
echo ""
