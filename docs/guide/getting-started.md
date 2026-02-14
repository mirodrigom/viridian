# Getting Started

Viridian is a full-stack web application that provides a browser-based UI for [Claude Code](https://docs.anthropic.com/en/docs/claude-code). It wraps the Claude CLI with a rich interface including chat, code editing, git management, and autonomous agent features.

## Prerequisites

- **Node.js** 18+
- **pnpm** 9+
- **Claude Code CLI** installed and authenticated (`claude` command available in PATH)
- **Git** (for git integration features)

## Installation

Clone the repository and install dependencies:

```bash
git clone <your-repo-url> claude-code-web
cd claude-code-web
pnpm install
```

## Configuration

Copy the environment template and configure:

```bash
cp .env.example .env
```

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
4. **Explore Tabs** — Switch between Chat, Editor, Git, Tasks, Graph, and Autopilot

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
claude-code-web/
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
