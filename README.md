<div align="center">
  <img src="./docs/public/logo.png" alt="Viridian Logo" width="160" />

  # Viridian

  **A full-featured browser UI for AI coding CLIs**

  [![Version](https://img.shields.io/badge/version-0.4.0-teal)](./package.json)
  [![Vue 3](https://img.shields.io/badge/Vue-3-42b883?logo=vue.js)](https://vuejs.org)
  [![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript)](https://typescriptlang.org)
  [![License](https://img.shields.io/badge/license-MIT-green)](./LICENSE)

  Chat with AI, edit code, manage git, run a terminal, orchestrate agents — all from your browser.

</div>

---

## What is Viridian?

Viridian turns AI coding CLIs into a rich, browser-based IDE. Instead of working in a terminal, you get a full-featured workspace accessible from any device on your network — with real-time streaming, visual git tools, a live terminal, kanban tasks, and an autonomous multi-agent Autopilot system.

It works by spawning the AI CLI as a child process on your server and streaming its output to your browser over WebSocket.

---

## Supported Providers

Viridian has a provider abstraction layer that supports multiple AI coding CLIs. Each provider is detected automatically if its binary is available in `PATH`.

| Provider | CLI binary | Status | Notes |
|---|---|---|---|
| **Claude Code** | `claude` | ✅ Tested | Full feature support — primary provider |
| **Kiro** | `kiro-cli` | ⚠️ Experimental | Steering, custom agents, Bedrock models |
| **Gemini CLI** | `gemini` | ⚠️ Experimental | No session resume, no sub-agents |
| **Codex CLI** | `codex` | ⚠️ Experimental | No control requests, no plan mode |
| **Aider** | `aider` | ⚠️ Experimental | Plain text, resume via chat history file |
| **Qwen Code** | `qwen` | ⚠️ Experimental | 256k context, multi-model support |
| **OpenCode** | `opencode` | ⚠️ Experimental | Multi-provider, LSP integration |

> **Experimental providers** have adapters implemented but have not been thoroughly tested end-to-end. If you try one and run into issues, please [open an issue](https://github.com/mirodrigom/viridian/issues) — I'll look into it.

### Feature Matrix

| Feature | Claude | Kiro | Gemini | Codex | Aider | Qwen | OpenCode |
|---|---|---|---|---|---|---|---|
| Text streaming | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Extended thinking | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Tool use (file ops) | ✅ | ✅ | MCP | ✅ | ✅ | ✅ | ✅ |
| Session resume | ✅ | ✅ | ❌ | ✅ | ✅† | ✅ | ✅ |
| Permission modes | 4 | 2 | 1 | 2 | 1 | 1 | 2 |
| Interactive approval | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Image input | ✅ | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Sub-agents / Autopilot | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ |
| Plan mode | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

*† Aider resumes via chat history file, not a native session ID.*

---

## Features

### Chat
- Streaming responses with Markdown, syntax highlighting, LaTeX, and tables
- Tool visualization cards for Bash, Edit, Read, Write, Grep, and more
- **Thinking modes** — Standard, Think, Think Hard, Think Harder, Ultrathink
- Interactive tool approval with countdown timer
- Voice input with enhancement modes (Raw, Clean, Expand, Code)
- File mentions (`@filename`), image & CSV attachments (drag & drop), and slash commands
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
- **Dual-AI autonomous collaboration** — two specialized agents work together in cycles
- 6 built-in profiles: Research, Architecture, Implementation, Testing, Documentation, Integration
- Scheduled execution with time windows
- Automatic scoped git commits per cycle
- Real-time WebSocket updates with 24 event types

### Sessions & Projects
- Browse and resume past sessions
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
| **Logging** | pino + pino-roll (structured JSON, daily rotation) |
| **Validation** | Zod (all REST routes) |
| **Terminal backend** | node-pty |
| **Git** | simple-git |
| **AI integration** | Provider abstraction layer — Claude Code, Kiro, Gemini, Codex, Aider, Qwen, OpenCode |
| **Build** | Vite 7, pnpm workspaces, TypeScript strict |

---

## Getting Started

### Prerequisites

- **Node.js** 20+
- **pnpm** 9+
- At least one supported AI CLI installed and authenticated (e.g. `claude`, `kiro-cli`, `gemini`, `codex`)
- **Git**

### Install

```bash
git clone https://github.com/mirodrigom/viridian.git
cd viridian
pnpm install
```

Or use the bootstrap script (checks deps, copies `.env`, optionally pulls Langfuse images):

```bash
bash setup.sh
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

Generate a secure JWT secret: `openssl rand -base64 64`

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

For access from other devices on your network (e.g. a tablet):

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
│       ├── stores/       # Pinia state (chat, git, files, settings, autopilot, graphs, provider)
│       ├── composables/  # useClaudeStream, useWebSocket, useConfirmDialog, …
│       ├── pages/        # Route-level components
│       └── types/        # TypeScript interfaces
│
├── server/          # Express + WebSocket backend
│   └── src/
│       ├── providers/    # AI provider adapters (claude, kiro, gemini, codex, aider, qwen, opencode)
│       ├── routes/       # REST API (auth, files, git, sessions, graphs, autopilot, providers, …)
│       ├── ws/           # WebSocket handlers (chat, shell, sessions, graph-runner, autopilot)
│       ├── services/     # Business logic (claude, git, terminal, autopilot)
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

## Contributing

Issues and PRs are welcome. If you test an experimental provider and hit a bug, please [open an issue](https://github.com/mirodrigom/viridian/issues) describing:

- Which provider (Kiro, Gemini, Codex, etc.)
- The error or unexpected behavior
- Your OS and CLI version

I'll verify and fix.

---

## License

MIT
