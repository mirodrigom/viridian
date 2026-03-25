# Viridian ECS Deployment Guide

## Architecture

```
Client (browser)
  └── CloudFront (HTTPS)
        ├── /           → S3 (Vue SPA static files)
        ├── /api/*      → ALB → ECS Fargate (Express server)
        └── /ws/*       → ALB → ECS Fargate (WebSocket)
```

## Infrastructure (CDK Stack)

| Component             | Details                                              |
|-----------------------|------------------------------------------------------|
| VPC                   | 2 AZs, 1 NAT Gateway                                |
| ECS Fargate           | 1024 CPU, 2048 MiB memory, 1 task                   |
| ALB                   | HTTP only, restricted to CloudFront via custom header |
| RDS Aurora Serverless | PostgreSQL 16.4, 0.5–4 ACU                           |
| S3                    | Static client files (Vue dist)                       |
| CloudFront            | HTTPS termination, SPA fallback                      |
| Secrets Manager       | JWT secret + DB credentials (auto-generated)         |

## Database

The server uses **Knex** with dual-engine support:
- **Local dev**: SQLite (`better-sqlite3`) — default when `DATABASE_URL` is not set
- **Production**: PostgreSQL — activated when `DATABASE_URL` is set

The CDK stack injects individual DB secrets (`DB_HOST`, `DB_PORT`, etc.) and `docker-entrypoint.sh` assembles `DATABASE_URL` from them.

Migrations are written in Knex DSL (engine-agnostic) and run automatically at startup.

## Container Image Strategy

Two options controlled by CDK context variable `ecrImageUri`:

### Option A: CDK builds from source (default)
CDK runs `docker build` from the repo root and pushes to an internal CDK-managed ECR repo.

```bash
cd infra && npx cdk deploy
```

### Option B: Pre-built ECR image
Push to your own ECR repo first, then pass the URI:

```bash
# 1. Create ECR repo (one-time)
aws ecr create-repository --repository-name viridian

# 2. Build & push
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin <account>.dkr.ecr.us-east-1.amazonaws.com
docker build -t <account>.dkr.ecr.us-east-1.amazonaws.com/viridian:latest .
docker push <account>.dkr.ecr.us-east-1.amazonaws.com/viridian:latest

# 3. Deploy with URI
cd infra && npx cdk deploy -c ecrImageUri=<account>.dkr.ecr.us-east-1.amazonaws.com/viridian:latest
```

## ALB Security

The ALB is restricted to CloudFront-only access via a custom origin header (`X-Viridian-CF-Secret`). Direct ALB access returns 403. CloudFront injects this header automatically on every origin request.

## WebSocket Support

WebSocket connections work through CloudFront:
- `ALL_VIEWER` origin request policy forwards upgrade headers
- Caching disabled for `/ws/*`
- Session stickiness enabled (1h)

Server WebSocket paths:
- `/ws/shell` — Terminal
- `/ws/sessions` — Session management
- `/ws/chat` — Chat streaming
- `/ws/graph-runner` — Graph execution
- `/ws/autopilot` — Autopilot
- `/ws/management` — Management
- `/ws/traces` — Tracing
- `/ws/auth-browser` — Browser auth
- `/ws/cli-auth` — CLI auth

## CLI Tools (no API keys needed)

The container includes **Claude CLI**, **Codex CLI**, and **Kiro CLI**. These tools handle their own authentication — no `ANTHROPIC_API_KEY` or similar secrets are needed in the environment.

## Deploy Script

```bash
cd infra
bash deploy.sh
```

This runs `npm ci`, builds the client, bootstraps CDK if needed, and deploys.

## Prerequisites

- AWS CLI configured with appropriate permissions
- Node.js 20+
- Docker (for Option A / local builds)
- CDK bootstrapped in target account/region (`npx cdk bootstrap`)

## Outputs

After deployment, CDK outputs:
- `CloudFrontUrl` — Public URL
- `CloudFrontDistributionId` — For cache invalidation
- `ClientBucketName` — S3 bucket for client files
- `AlbDnsName` — ALB DNS (restricted, don't use directly)
- `DatabaseEndpoint` — RDS cluster endpoint
