# Getting Started

Viridian is a full-stack web application that provides a browser-based UI for [Claude Code](https://docs.anthropic.com/en/docs/claude-code). It wraps the Claude CLI with a rich interface including chat, code editing, git management, and autonomous agent features.

## Prerequisites

- **Node.js** 18+
- **pnpm** 9+
- **Claude Code CLI** installed and authenticated (`claude` command available in PATH)
- **Git** (for git integration features)

## Installation

Clone the repository and run the bootstrap script:

```bash
git clone https://github.com/mirodrigom/viridian.git viridian
cd viridian
bash setup.sh
```

`setup.sh` is idempotent — safe to run multiple times. It:

1. Checks that Node.js 20+ is available
2. Installs pnpm if missing
3. Installs npm dependencies (skips if lockfile unchanged)
4. Copies `.env.example` → `.env` if `.env` is missing
5. Installs `podman-compose` if Podman is present (for Langfuse)
6. Pulls Langfuse container images (one-time, skipped if already pulled)

Alternatively, install manually:

```bash
git clone https://github.com/mirodrigom/viridian.git viridian
cd viridian
pnpm install
cp .env.example .env
```

## Configuration

Edit `.env` with your settings:

```ini
# Server port
PORT=3010
HOST=localhost

# JWT secret (minimum 32 characters in production)
JWT_SECRET=your-secret-key-here-change-in-production

# Environment
NODE_ENV=development

# CORS origin (client dev server)
CORS_ORIGIN=http://localhost:5174
```

::: tip
Generate a secure JWT secret with: `openssl rand -base64 64`
:::

## Langfuse Observability (optional)

Viridian can trace every Claude turn — prompts, tool calls, subagent spans, and token usage — using [Langfuse](https://langfuse.com/), an open-source observability platform.

### Self-hosting Langfuse

A `docker-compose.yml` at the repo root starts a local Langfuse instance (Langfuse + PostgreSQL):

```bash
# Docker
docker compose up -d

# Podman
podman-compose up -d
```

Langfuse will be available at `http://localhost:3002`.

### Getting API keys

1. Open `http://localhost:3002` in your browser
2. Register an account and create a new project
3. Copy the **public key** and **secret key** from Project Settings → API Keys

### Enabling tracing

Add the keys to `.env`:

```ini
LANGFUSE_BASE_URL=http://localhost:3002
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_SECRET_KEY=sk-lf-...
```

Restart the server — traces will appear in the **Traces Panel** (right side of Chat) and in the Langfuse UI.

::: info
Tracing is completely optional. When `LANGFUSE_SECRET_KEY` is not set, the Langfuse service is disabled with zero overhead. The Traces Panel shows a "not configured" placeholder.
:::

## Running in Development

Start both client and server:

```bash
pnpm dev
```

This runs concurrently:
- **Server** at `http://localhost:3010` (Express + WebSocket)
- **Client** at `http://localhost:5174` (Vite dev server with proxy)

Open `http://localhost:5174` in your browser.

## First Use

1. **Login** — On first visit you'll be prompted to create credentials
2. **Select a Project** — Choose a directory from the dashboard or clone a GitHub repo
3. **Start Chatting** — Send messages to Claude in the Chat tab
4. **Explore Tabs** — Switch between Chat, Editor, Git, Tasks, Graph, Autopilot, and Management

## Building for Production

```bash
pnpm build
```

This builds:
- Client → `client/dist/` (static files served by Express in production)
- Server → `server/dist/` (compiled TypeScript)

Start the production server:

```bash
cd server
node dist/index.js
```

## Project Structure

```
viridian/
├── client/          # Vue 3 SPA (Vite + TypeScript)
│   └── src/
│       ├── components/   # Vue components by feature
│       ├── stores/       # Pinia state management
│       ├── composables/  # Reusable logic
│       ├── types/        # TypeScript definitions
│       └── router/       # Vue Router config
├── server/          # Express backend
│   └── src/
│       ├── routes/       # REST API endpoints
│       ├── services/     # Business logic
│       ├── ws/           # WebSocket handlers
│       └── db/           # SQLite database
└── docs/            # This documentation (VitePress)
```
