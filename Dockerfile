# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:22-slim AS build

# Build tools for native modules (node-pty, bcrypt, better-sqlite3)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY server/package.json server/

RUN pnpm install --frozen-lockfile

COPY server/ server/

# tsc emits JS even with type errors (pre-existing strict-mode issues in source)
RUN pnpm --filter server exec tsc --project tsconfig.build.json || true
# Verify the output was actually emitted
RUN test -f /app/server/dist/index.js

# ── Stage 2: Runtime ──────────────────────────────────────────────────────────
FROM node:22-slim

# System dependencies for node-pty, git operations, and CLI tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    python3 \
    make \
    g++ \
    openssh-client \
    ca-certificates \
    curl \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@latest --activate

# Install Claude CLI and Codex CLI globally
RUN npm install -g @anthropic-ai/claude-code @openai/codex

WORKDIR /app

# Copy built artifacts (client is deployed to S3+CloudFront separately)
COPY --from=build /app/server/dist /app/server/dist
COPY --from=build /app/server/package.json /app/server/
COPY --from=build /app/package.json /app/
COPY --from=build /app/pnpm-workspace.yaml /app/
COPY --from=build /app/pnpm-lock.yaml /app/

# Install production-only server dependencies (includes native modules like better-sqlite3, node-pty)
COPY server/package.json /app/server/
RUN cd /app && pnpm install --frozen-lockfile --prod --filter server

# Copy migration files (needed at runtime) — only .js files, exclude .d.ts
COPY --from=build /app/server/dist/db/migrations /app/server/dist/db/migrations
RUN find /app/server/dist/db/migrations -name '*.d.ts' -delete 2>/dev/null; true

# Entrypoint script (builds DATABASE_URL from ECS secrets)
COPY docker-entrypoint.sh /app/

# Data directory for SQLite (if used) and logs
RUN mkdir -p /app/server/data /app/server/logs

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=12000

EXPOSE 12000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:12000/api/health || exit 1

CMD ["/app/docker-entrypoint.sh"]
