# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:22-slim AS build

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY client/package.json client/
COPY server/package.json server/

RUN pnpm install --frozen-lockfile

COPY client/ client/
COPY server/ server/

RUN pnpm --filter client build && pnpm --filter server build

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

# Copy built artifacts
COPY --from=build /app/client/dist /app/client/dist
COPY --from=build /app/server/dist /app/server/dist
COPY --from=build /app/server/package.json /app/server/
COPY --from=build /app/package.json /app/
COPY --from=build /app/pnpm-workspace.yaml /app/
COPY --from=build /app/pnpm-lock.yaml /app/

# Install production-only server dependencies (includes native modules like better-sqlite3, node-pty)
COPY server/package.json /app/server/
RUN cd /app && pnpm install --frozen-lockfile --prod --filter server

# Copy migration files (needed at runtime)
COPY --from=build /app/server/src/db/migrations /app/server/dist/db/migrations

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
