<div align="center">
  <img src="./docs/public/logo.png" alt="Viridian Logo" width="160" />

  # Viridian

  **A full-featured browser UI for Claude Code CLI**

  [![Version](https://img.shields.io/badge/version-0.2.0-teal)](./package.json)
  [![Vue 3](https://img.shields.io/badge/Vue-3-42b883?logo=vue.js)](https://vuejs.org)
  [![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript)](https://typescriptlang.org)
  [![License](https://img.shields.io/badge/license-MIT-green)](./LICENSE)

  Chat with Claude, edit code, manage git, run a terminal, orchestrate agents — all from your browser.

</div>

---

## What is Viridian?

Viridian transforms the Claude Code CLI into a rich, browser-based IDE. Instead of working in a terminal, you get a full-featured workspace accessible from any device on your network — with real-time streaming, visual git tools, a live terminal, kanban tasks, and an autonomous multi-agent Autopilot system.

It works by spawning the Claude CLI as a child process on your server and streaming its output to your browser over WebSocket.

---

## Features

### Chat
- Streaming responses with Markdown, syntax highlighting, LaTeX, and tables
- Tool visualization cards for Bash, Edit, Read, Write, Grep, and more
- **Thinking modes** — Standard, Think, Think Hard, Think Harder, Ultrathink
- Interactive tool approval with countdown timer
- Voice input with enhancement modes (Raw, Clean, Expand, Code)
- File mentions (`@filename`), image attachments (drag & drop), and slash commands
- Token tracking with cost estimation and response time metrics
- Chat search (Ctrl+F), message history navigation, draft persistence

### Code Editor
- **CodeMirror 6** with syntax highlighting for TypeScript, JavaScript, Python, HTML, Vue, CSS, JSON, Markdown
- Multi-tab editing, diff view, and side-by-side merge comparison
- Optional minimap with colored chunk gutters
- Configurable font size, indentation, word wrap, line numbers, and themes

### Git Integration
- Stage, commit, push, pull — all from the browser
- Per-file status with inline diff viewer (green/red line-by-line)
- **AI-generated commit messages** via Claude (streaming)
- Branch management, remote operations, commit history with lazy loading
- Multi-select staging and discard with confirmation

### Terminal
- Full PTY terminal powered by **xterm.js + node-pty**
- WebGL rendering with GPU acceleration
- 5,000-line scrollback, clickable URLs, copy/paste support

### Task Board
- Kanban (To Do / In Progress / Done) with drag & drop
- **PRD parsing** for hierarchical task breakdown
- AI-powered subtask generation
- Task dependencies and priority filters

### Graph Runner
- Visual **multi-agent workflow editor** using Vue Flow
- 6 node types: Agent, Subagent, Expert, Skill, MCP, Rule
- 8 pre-built templates (Full-Stack Team, Code Review, Security Audit, etc.)
- Real-time execution with animated edges and status overlays
- **DVR-like timeline replay** — play, pause, step, variable speed

### Autopilot
- **Dual-Claude autonomous collaboration** — two specialized agents work together in cycles
- 6 built-in profiles: Research, Architecture, Implementation, Testing, Documentation, Integration
- Scheduled execution with time windows
- Automatic scoped git commits per cycle
- Real-time WebSocket updates with 24 event types

### Sessions & Projects
- Browse and resume past Claude sessions
- Multi-project listing from `~/.claude/projects/`
- Real-time session updates, search, pagination, and delete
- GitHub clone with streaming progress

---

## Tech Stack

| Layer | Technologies |
|---|---|
| **Frontend** | Vue 3, Pinia, Vue Router, Tailwind CSS 4, shadcn-vue |
| **Editor** | CodeMirror 6, @codemirror/merge |
| **Terminal** | xterm.js 6, WebGL addon |
| **Graphs** | Vue Flow |
| **Backend** | Express 5, WebSocket (ws), SQLite (better-sqlite3) |
| **Auth** | JWT + bcrypt |
| **Terminal backend** | node-pty |
| **Git** | simple-git |
| **Claude integration** | @anthropic-ai/claude-code CLI (child_process + stream-json) |
| **Build** | Vite 7, pnpm workspaces, TypeScript strict |

---

## Getting Started

### Prerequisites

- **Node.js** 18+
- **pnpm** 9+
- **Claude Code CLI** installed and authenticated (`claude` in PATH)
- **Git**

### Install

```bash
git clone https://github.com/your-username/viridian.git
cd viridian
pnpm install
```

### Configure

```bash
cp .env.example .env
```

Edit `.env`:

```ini
HOST=localhost
PORT=3010
JWT_SECRET=your-secure-secret-at-least-32-chars
CORS_ORIGIN=http://localhost:5174
NODE_ENV=development
```

### Run (development)

```bash
# Server + client
pnpm dev

# All including docs
pnpm dev:all

# Individually
pnpm dev:server   # http://localhost:3010
pnpm dev:client   # http://localhost:5174
pnpm dev:docs     # http://localhost:5173
```

### Build (production)

```bash
pnpm build
node server/dist/index.js
```

### LAN access

For access from other devices on your network (e.g. a tablet), use the provided scripts:

```bash
./start-lan.sh
```

---

## Project Structure

```
viridian/
├── client/          # Vue 3 SPA (Vite)
│   └── src/
│       ├── components/   # chat, editor, git, terminal, tasks, graph, autopilot
│       ├── stores/       # Pinia state (chat, git, files, settings, autopilot, graphs)
│       ├── composables/  # useClaudeStream, useWebSocket, useConfirmDialog, …
│       ├── pages/        # Route-level components
│       └── types/        # TypeScript interfaces
│
├── server/          # Express + WebSocket backend
│   └── src/
│       ├── routes/       # REST API (auth, files, git, sessions, graphs, autopilot, …)
│       ├── ws/           # WebSocket handlers (chat, shell, sessions, graph-runner, autopilot)
│       ├── services/     # Business logic (claude, git, terminal, autopilot, providers)
│       └── db/           # SQLite schema and migrations
│
├── docs/            # VitePress documentation
│   ├── guide/       # User guides (chat, editor, git, terminal, tasks, graphs, autopilot)
│   └── architecture/# Technical deep-dives
│
└── e2e/             # Playwright end-to-end tests
```

---

## Running Tests

```bash
pnpm test           # All unit tests
pnpm test:client    # Vue unit tests (Vitest)
pnpm test:server    # Express unit tests (Vitest)
pnpm test:e2e       # Playwright e2e tests
pnpm test:e2e:ui    # Playwright UI mode
```

---

## Documentation

Full documentation is available in the `docs/` folder and served via VitePress (`pnpm dev:docs`).

- [Getting Started](./docs/guide/getting-started.md)
- [Chat](./docs/guide/chat.md)
- [Code Editor](./docs/guide/editor.md)
- [Git Integration](./docs/guide/git.md)
- [Terminal](./docs/guide/terminal.md)
- [Tasks](./docs/guide/tasks.md)
- [Graph Runner](./docs/guide/graphs.md)
- [Autopilot](./docs/guide/autopilot.md)
- [Architecture Overview](./docs/architecture/overview.md)
- [Changelog](./docs/guide/changelog.md)

---

## License

MIT
