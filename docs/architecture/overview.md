# Architecture Overview

Viridian is a full-stack application that provides a browser-based interface for interacting with the Claude CLI. It follows a three-tier architecture: a Vue 3 single-page application communicates with an Express server over REST and WebSocket, and the server spawns Claude CLI processes to execute AI conversations.

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                          Browser (Client)                           │
│                                                                     │
│   Vue 3 SPA  ─────  Pinia Stores  ─────  Composables               │
│       │                   │                    │                    │
│       │            ┌──────┴──────┐      ┌──────┴──────┐            │
│       │            │ REST fetch  │      │  WebSocket  │            │
│       │            └──────┬──────┘      └──────┬──────┘            │
└───────┼───────────────────┼────────────────────┼────────────────────┘
        │                   │                    │
        │            ┌──────┴──────┐      ┌──────┴──────┐
        │            │  HTTP /api  │      │ /ws/chat    │
        │            │  endpoints  │      │ /ws/shell   │
        │            └──────┬──────┘      │ /ws/sessions│
        │                   │             │ /ws/graph   │
        │                   │             │ /ws/autopilot│
        │                   │             └──────┬──────┘
┌───────┼───────────────────┼────────────────────┼────────────────────┐
│       ▼                   ▼                    ▼                    │
│                      Express Server                                 │
│                                                                     │
│   Middleware ──── Routes ──── Services ──── WebSocket Handlers      │
│       │              │           │                │                  │
│       │              │     ┌─────┴─────┐         │                  │
│       │              │     │ claude.ts  │         │                  │
│       │              │     │  (session  │         │                  │
│       │              │     │  manager)  │         │                  │
│       │              │     └─────┬─────┘         │                  │
│       │              │           │                │                  │
│   ┌───┴───┐    ┌─────┴─────┐    │          ┌─────┴─────┐           │
│   │SQLite │    │  auth.ts   │    │          │terminal.ts│           │
│   │  DB   │    │  files.ts  │    │          │ (node-pty)│           │
│   └───────┘    │  git.ts    │    │          └───────────┘           │
│                └───────────┘    │                                    │
└─────────────────────────────────┼────────────────────────────────────┘
                                  │
                                  ▼
                    ┌──────────────────────────┐
                    │      Claude CLI          │
                    │  (child_process.spawn)   │
                    │                          │
                    │  --output-format         │
                    │    stream-json           │
                    │  --input-format          │
                    │    stream-json           │
                    │  --resume <sessionId>    │
                    │  --permission-mode       │
                    │    bypassPermissions     │
                    └──────────────────────────┘
```

The data flows in two directions:

- **User messages** travel from the Vue client through a WebSocket to the server, which spawns (or resumes) a Claude CLI process and pipes the prompt via stdin.
- **Claude responses** stream back as JSON events from the CLI's stdout, are parsed by the server's SDK layer, translated into WebSocket events, and rendered in real time by the client.

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Client framework** | Vue 3 (Composition API) | Reactive SPA with `<script setup>`, composables, and fine-grained reactivity |
| **State management** | Pinia | Type-safe stores with devtools support; each domain (chat, git, files, etc.) has its own store |
| **Routing** | Vue Router 5 | SPA navigation with route guards for authentication |
| **UI components** | shadcn-vue (reka-ui) | Headless, accessible component primitives styled with Tailwind CSS |
| **Styling** | Tailwind CSS 4 | Utility-first CSS with dark mode support via CSS variables |
| **Code editor** | CodeMirror 6 | In-browser file editor with syntax highlighting and diff view |
| **Terminal** | xterm.js 6 | Browser-based terminal connected to server-side PTY |
| **Graph editor** | Vue Flow | Node-based visual editor for building multi-step agent workflows |
| **Toasts** | vue-sonner | Non-blocking notification system |
| **i18n** | vue-i18n | Internationalization support |
| **Server framework** | Express 5 | HTTP API with middleware pipeline |
| **WebSocket** | ws | Persistent duplex connections for streaming, terminal I/O, and live updates |
| **Database** | SQLite (better-sqlite3) | Zero-config embedded database with WAL mode for concurrent reads |
| **Authentication** | jsonwebtoken + bcrypt | JWT-based stateless auth with bcrypt password hashing |
| **Terminal backend** | node-pty | Pseudo-terminal for full shell emulation |
| **Git** | simple-git | Programmatic git operations (status, diff, log, commit, branch management) |
| **File watching** | chokidar | Real-time file system change detection |
| **Claude integration** | @anthropic-ai/claude-code CLI | Spawned as child process with stream-json I/O for bidirectional communication |
| **Build (client)** | Vite 7 | Fast HMR development server and optimized production builds |
| **Build (server)** | tsx / tsc | tsx for development watch mode, tsc for production compilation |
| **Monorepo** | pnpm workspaces | Workspace-based dependency management with shared root scripts |
| **Docs** | VitePress | Static site generator for project documentation |

## Monorepo Structure

The project uses **pnpm workspaces** defined in `pnpm-workspace.yaml`:

```yaml
packages:
  - "client"
  - "server"
  - "docs"
```

```
claude-code-web/
├── package.json              # Root — shared scripts (dev, build)
├── pnpm-workspace.yaml       # Workspace definition
├── pnpm-lock.yaml
│
├── client/                   # Vue 3 SPA
│   ├── package.json
│   ├── vite.config.ts
│   ├── tsconfig.json
│   └── src/
│       ├── main.ts           # App bootstrap (Pinia, Router, i18n)
│       ├── App.vue           # Root component (RouterView + Toaster + ConfirmDialog)
│       ├── router/           # Route definitions + auth guard
│       ├── stores/           # Pinia stores (chat, auth, files, git, settings, ...)
│       ├── composables/      # Reusable logic (useClaudeStream, useWebSocket, ...)
│       ├── components/       # UI components organized by domain
│       │   ├── layout/       # AppLayout, TopBar, MainTabs, FileSidebar
│       │   ├── chat/         # ChatInput, MessageList, SessionSidebar
│       │   ├── editor/       # EditorView (CodeMirror)
│       │   ├── git/          # Git status, diff, commit UI
│       │   ├── graph/        # Graph editor (Vue Flow)
│       │   ├── autopilot/    # Dual-agent autonomous mode
│       │   ├── terminal/     # xterm.js terminal
│       │   ├── tasks/        # Task management
│       │   ├── settings/     # Settings + tools dialogs
│       │   └── ui/           # shadcn-vue primitives
│       ├── pages/            # Route-level page components
│       ├── lib/              # Utility functions
│       └── i18n/             # Localization files
│
├── server/                   # Express + WebSocket backend
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts          # Server entry — Express app, routes, WS setup
│       ├── config.ts         # Environment configuration
│       ├── db/
│       │   └── database.ts   # SQLite schema + migrations
│       ├── middleware/
│       │   └── auth.ts       # JWT authentication middleware
│       ├── routes/           # REST API endpoints
│       │   ├── auth.ts       # Login, register, status
│       │   ├── files.ts      # File CRUD operations
│       │   ├── git.ts        # Git operations
│       │   ├── sessions.ts   # Chat session management
│       │   ├── graphs.ts     # Graph definitions CRUD
│       │   ├── graph-runs.ts # Graph execution history
│       │   ├── autopilot.ts  # Autopilot configs, runs, cycles
│       │   ├── tasks.ts      # Task management
│       │   ├── apikeys.ts    # API key management
│       │   ├── agent.ts      # Agent-related endpoints
│       │   └── mcp.ts        # MCP server configuration
│       ├── services/         # Business logic
│       │   ├── claude.ts     # Session lifecycle (create, send, abort, resume)
│       │   ├── claude-sdk.ts # Claude CLI spawn + stream-json parsing
│       │   ├── auth.ts       # User auth (bcrypt, JWT)
│       │   ├── files.ts      # File system operations
│       │   ├── git.ts        # Git service (simple-git)
│       │   ├── terminal.ts   # PTY management (node-pty)
│       │   ├── graph-runner.ts # Multi-step graph execution engine
│       │   ├── autopilot.ts  # Dual-agent autonomous loop
│       │   ├── autopilot-profiles.ts  # Built-in agent profiles
│       │   ├── autopilot-scheduler.ts # Cron-like scheduler
│       │   └── autopilot-git.ts       # Branch + scoped auto-commit
│       └── ws/               # WebSocket endpoint handlers
│           ├── chat.ts       # /ws/chat — streaming chat
│           ├── shell.ts      # /ws/shell — terminal I/O
│           ├── sessions.ts   # /ws/sessions — live session list
│           ├── graph-runner.ts # /ws/graph — graph execution events
│           └── autopilot.ts  # /ws/autopilot — autopilot events
│
└── docs/                     # VitePress documentation site
    ├── package.json
    ├── .vitepress/
    └── guide/
```

Root-level scripts orchestrate the workspaces:

```json
{
  "dev": "concurrently \"pnpm --filter server dev\" \"pnpm --filter client dev\"",
  "build": "pnpm --filter client build && pnpm --filter server build"
}
```

## Server Architecture

### Entry Point (`server/src/index.ts`)

The server initializes in this order:

1. **Create Express app** with an HTTP server (`createServer`)
2. **Apply global middleware** — CORS (configured origin) and JSON body parser (10 MB limit)
3. **Mount routes** — public (`/api/auth`) and protected (all others)
4. **Setup WebSocket handlers** — each handler upgrades connections on a distinct path
5. **Start listening** — then clean up zombie autopilot runs and start the scheduler
6. **Register shutdown hooks** — SIGTERM/SIGINT trigger graceful cleanup

### Middleware Chain

```
Request
  │
  ├── cors({ origin: config.corsOrigin })
  ├── express.json({ limit: '10mb' })
  │
  ├── /api/auth/*  ────────────────────────  (no auth required)
  │
  ├── /api/files/*  ─── authMiddleware ───── filesRoutes
  ├── /api/git/*    ─── authMiddleware ───── gitRoutes
  ├── /api/sessions/* ─ authMiddleware ───── sessionsRoutes
  ├── /api/graphs/* ─── authMiddleware ───── graphsRoutes
  ├── /api/autopilot/* ─ authMiddleware ──── autopilotRoutes
  ├── /api/tasks/*  ─── authMiddleware ───── tasksRoutes
  ├── /api/keys/*   ─── authMiddleware ───── apikeysRoutes
  ├── /api/agent/*  ─── authMiddleware ───── agentRoutes
  └── /api/mcp/*    ─── authMiddleware ───── mcpRoutes
```

::: info Design Rationale: Auth Middleware
Each route module applies `authMiddleware` internally (via `router.use(authMiddleware)` in its own file), rather than applying it globally. This keeps `/api/auth` public for login and registration, and lets individual routes opt into or out of authentication as needed (e.g., `/api/health` and `/api/version` are also public).
:::

### WebSocket Upgrade

WebSocket connections are handled using the `noServer` mode of the `ws` library. The HTTP server's `upgrade` event is intercepted, and the URL pathname determines which `WebSocketServer` handles the connection:

```
HTTP Upgrade Request
  │
  ├── /ws/chat      → setupChatWs      (streaming Claude conversations)
  ├── /ws/shell     → setupShellWs     (terminal PTY I/O)
  ├── /ws/sessions  → setupSessionsWs  (live session list updates)
  ├── /ws/graph     → setupGraphRunnerWs (graph execution events)
  └── /ws/autopilot → setupAutopilotWs (autopilot run events)
```

Each WebSocket handler authenticates the connection by extracting a JWT from the `?token=` query parameter during the upgrade handshake. Connections without a valid token are immediately destroyed.

### Services Layer

Services encapsulate the core business logic and are the only layer that directly interacts with external systems:

| Service | Responsibility |
|---------|---------------|
| `claude.ts` | Session lifecycle: create, send messages, abort, resume. Maintains an in-memory `Map<string, ClaudeSession>` of active sessions with EventEmitters for streaming events |
| `claude-sdk.ts` | Low-level Claude CLI interaction: binary resolution, process spawning, stream-json parsing, async generator yielding typed `SDKMessage` events |
| `auth.ts` | User registration (bcrypt hashing), login (JWT signing), token verification |
| `files.ts` | File system operations: read, write, list directory trees, search |
| `git.ts` | Git operations via simple-git: status, diff, log, commit, branch, stash |
| `terminal.ts` | PTY lifecycle management via node-pty |
| `graph-runner.ts` | Orchestrates multi-step agent workflows (graph nodes executed sequentially) |
| `autopilot.ts` | Dual-agent autonomous loop: Agent A plans, Agent B implements, auto-commit |
| `autopilot-scheduler.ts` | Cron-like 60-second tick that starts/stops autopilot runs based on time windows |
| `autopilot-profiles.ts` | Built-in and user-defined agent profile management |
| `autopilot-git.ts` | Branch creation and scoped auto-commit for autopilot runs |

### Configuration (`server/src/config.ts`)

Configuration is resolved at startup from environment variables with sensible defaults:

| Variable | Default | Notes |
|----------|---------|-------|
| `HOST` | `localhost` | Bind address |
| `PORT` | `3010` | Server port (validated 1-65535) |
| `JWT_SECRET` | Dev fallback | **Required** in production (min 32 chars) |
| `CORS_ORIGIN` | `http://localhost:5174` | Allowed CORS origin (Vite dev server) |
| `CLAUDE_PATH` | Auto-detected | Override path to Claude CLI binary |

## Client Architecture

### Bootstrap (`client/src/main.ts`)

```ts
const app = createApp(App);
const pinia = createPinia();
app.use(pinia);           // State management
app.use(router);          // SPA routing
app.use(i18n);            // Internationalization
useSettingsStore().init(); // Apply saved preferences (dark mode, etc.)
app.mount('#app');
```

The root `App.vue` is minimal — it renders `<RouterView />`, the global `<Toaster />` for notifications, and a `<ConfirmDialog />` singleton.

### Routing

All authenticated routes resolve to `ProjectPage.vue`, which renders the `AppLayout`. The active tab is driven by `route.meta.tab`:

| Path | Tab | Description |
|------|-----|-------------|
| `/` | — | Dashboard (project picker) |
| `/login` | — | Login/register page (public) |
| `/project` | `chat` | New chat session |
| `/chat/:sessionId` | `chat` | Resumed chat session |
| `/editor` | `editor` | Code editor with file sidebar |
| `/git` | `git` | Git status, diff, commit |
| `/tasks` | `tasks` | Task management |
| `/graph` | `graph` | Visual graph editor |
| `/graph/:graphId` | `graph` | Open specific graph |
| `/autopilot` | `autopilot` | Autopilot dashboard |
| `/autopilot/:runId` | `autopilot` | Specific autopilot run |

A navigation guard redirects unauthenticated users to `/login` and redirects authenticated users away from `/login` to `/`:

```ts
router.beforeEach((to) => {
  const auth = useAuthStore();
  if (!to.meta.public && !auth.isAuthenticated) return { name: 'login' };
  if (to.name === 'login' && auth.isAuthenticated) return { name: 'dashboard' };
});
```

### Component Hierarchy

```
App.vue
└── RouterView
    ├── LoginPage.vue
    ├── DashboardPage.vue
    └── ProjectPage.vue
        └── AppLayout.vue
            ├── TopBar.vue
            ├── ResizablePanelGroup (vertical)
            │   ├── ResizablePanelGroup (horizontal)
            │   │   ├── MainTabs.vue
            │   │   │   ├── ChatView (ChatInput + MessageList + SessionSidebar)
            │   │   │   ├── EditorView (CodeMirror)
            │   │   │   ├── GitView
            │   │   │   ├── TasksView
            │   │   │   ├── GraphView (Vue Flow)
            │   │   │   └── AutopilotView
            │   │   └── FileSidebar.vue (editor tab only)
            │   └── TerminalPanel.vue (toggleable)
            ├── SettingsDialog.vue
            └── ToolsSettingsDialog.vue
```

### Pinia Stores

Each feature domain has its own Pinia store:

| Store | Key State | Purpose |
|-------|-----------|---------|
| `auth` | `token`, `username`, `isAuthenticated` | JWT storage, login/register/logout |
| `chat` | `messages`, `sessionId`, `claudeSessionId`, `isStreaming`, `usage` | Chat message buffer, session tracking, token usage |
| `settings` | `model`, `permissionMode`, `darkMode`, `thinkingMode` | User preferences persisted via REST API |
| `files` | `tree`, `openFiles`, `activeFile` | File explorer state, open editors |
| `git` | `status`, `diff`, `log`, `branches` | Git repository state |
| `tasks` | `tasks`, `selectedTask` | Task management state |
| `graph` | `graphs`, `currentGraphId` | Graph definitions |
| `graphRunner` | `currentRun`, `executions`, `timeline` | Active graph execution state |
| `autopilot` | `configs`, `currentRun`, `cycles` | Autopilot configuration and run state |

### Composables

Composables encapsulate reusable, stateful logic:

| Composable | Responsibility |
|------------|---------------|
| `useClaudeStream` | Core chat: connects WebSocket, sends messages, handles all streaming events (text, thinking, tool_use, errors), manages session lifecycle |
| `useWebSocket` | Generic reconnecting WebSocket with event emitter pattern, JWT token injection, keepalive pings |
| `useGraphRunner` | Graph execution: WebSocket connection for graph run events |
| `useAutopilot` | Autopilot WebSocket connection and event handling |
| `useConfirmDialog` | Promise-based modal confirmation (module-level singleton) |
| `useKeyboardShortcuts` | Global keyboard shortcuts (Ctrl+K, Ctrl+`, etc.) |
| `useModeTheme` | Dark/light mode CSS variable management |
| `useNotificationSound` | Audio notification on stream completion |
| `useVersionCheck` | Periodic version polling for update notifications |

## Database

The application uses **SQLite** via `better-sqlite3` with **WAL (Write-Ahead Logging)** mode for concurrent read performance. The database file lives at `server/data/auth.db`.

### Schema

#### Core Tables

```sql
-- User accounts
users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
)

-- Chat sessions (links server UUID to Claude CLI session ID)
sessions (
  id                TEXT PRIMARY KEY,          -- Server-generated UUID
  user_id           INTEGER REFERENCES users,
  project_path      TEXT NOT NULL,
  claude_session_id TEXT,                      -- Claude CLI JSONL filename
  created_at        DATETIME,
  updated_at        DATETIME
)

-- User preferences (key-value store)
settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
)

-- API keys for programmatic access
api_keys (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER REFERENCES users,
  name        TEXT NOT NULL,
  key_prefix  TEXT NOT NULL,              -- First 8 chars for display
  key_hash    TEXT NOT NULL,              -- bcrypt hash of full key
  created_at  DATETIME,
  last_used_at DATETIME,
  revoked     INTEGER DEFAULT 0
)
```

#### Session Cache

```sql
-- Cached session metadata (avoids re-parsing JSONL files)
session_cache (
  id            TEXT NOT NULL,
  project_dir   TEXT NOT NULL,
  title         TEXT NOT NULL,
  project_path  TEXT DEFAULT '',
  message_count INTEGER DEFAULT 0,
  last_active   INTEGER NOT NULL,
  file_mtime    INTEGER NOT NULL,          -- JSONL file modification time
  PRIMARY KEY (project_dir, id)
)
```

#### Task Management

```sql
tasks (
  id             TEXT PRIMARY KEY,
  user_id        INTEGER REFERENCES users,
  project_path   TEXT NOT NULL,
  title          TEXT NOT NULL,
  description    TEXT DEFAULT '',
  details        TEXT DEFAULT '',
  status         TEXT DEFAULT 'todo',       -- todo, in_progress, done
  priority       TEXT DEFAULT 'medium',     -- low, medium, high
  parent_id      TEXT REFERENCES tasks,     -- Subtask hierarchy
  dependency_ids TEXT DEFAULT '[]',         -- JSON array of task IDs
  prd_source     TEXT,
  sort_order     INTEGER DEFAULT 0,
  created_at     DATETIME,
  updated_at     DATETIME
)
```

#### Graph System

```sql
-- Graph definitions (node-based workflows)
graphs (
  id           TEXT PRIMARY KEY,
  user_id      INTEGER REFERENCES users,
  project_path TEXT NOT NULL,
  name         TEXT NOT NULL,
  description  TEXT DEFAULT '',
  graph_data   TEXT NOT NULL DEFAULT '{}',  -- JSON: nodes + edges
  created_at   DATETIME,
  updated_at   DATETIME
)

-- Graph execution history
graph_runs (
  id                  TEXT PRIMARY KEY,
  graph_id            TEXT REFERENCES graphs,
  user_id             INTEGER REFERENCES users,
  project_path        TEXT NOT NULL,
  prompt              TEXT NOT NULL,
  status              TEXT DEFAULT 'running',
  final_output        TEXT,
  error               TEXT,
  timeline            TEXT DEFAULT '[]',     -- JSON execution timeline
  executions          TEXT DEFAULT '{}',     -- JSON per-node results
  total_input_tokens  INTEGER DEFAULT 0,
  total_output_tokens INTEGER DEFAULT 0,
  started_at          DATETIME,
  completed_at        DATETIME
)
```

#### Autopilot System

```sql
-- Agent profiles (built-in + user-defined)
autopilot_profiles (
  id             TEXT PRIMARY KEY,
  user_id        INTEGER REFERENCES users,
  name           TEXT NOT NULL,
  role           TEXT NOT NULL,
  description    TEXT DEFAULT '',
  system_prompt  TEXT NOT NULL,
  allowed_tools  TEXT DEFAULT '[]',
  disallowed_tools TEXT DEFAULT '[]',
  model          TEXT,
  is_builtin     INTEGER DEFAULT 0,
  category       TEXT DEFAULT 'general',
  tags           TEXT DEFAULT '[]',
  subagents      TEXT DEFAULT '[]',
  mcp_servers    TEXT DEFAULT '[]',
  icon           TEXT,
  difficulty     TEXT,
  created_at     DATETIME
)

-- Autopilot session configuration
autopilot_configs (
  id                       TEXT PRIMARY KEY,
  user_id                  INTEGER REFERENCES users,
  project_path             TEXT NOT NULL,
  name                     TEXT NOT NULL,
  agent_a_profile          TEXT NOT NULL,
  agent_b_profile          TEXT NOT NULL,
  allowed_paths            TEXT DEFAULT '[]',
  agent_a_model            TEXT DEFAULT 'claude-sonnet-4-20250514',
  agent_b_model            TEXT DEFAULT 'claude-sonnet-4-20250514',
  max_iterations           INTEGER DEFAULT 50,
  max_tokens_per_session   INTEGER DEFAULT 500000,
  schedule_enabled         INTEGER DEFAULT 0,
  schedule_start_time      TEXT,
  schedule_end_time         TEXT,
  schedule_days            TEXT DEFAULT '[1,2,3,4,5]',
  schedule_timezone        TEXT DEFAULT 'UTC',
  goal_prompt              TEXT NOT NULL,
  created_at               DATETIME,
  updated_at               DATETIME
)

-- Autopilot execution runs
autopilot_runs (
  id                       TEXT PRIMARY KEY,
  config_id                TEXT REFERENCES autopilot_configs,
  user_id                  INTEGER REFERENCES users,
  project_path             TEXT NOT NULL,
  status                   TEXT DEFAULT 'pending',
  branch_name              TEXT,
  commit_count             INTEGER DEFAULT 0,
  cycle_count              INTEGER DEFAULT 0,
  agent_a_input_tokens     INTEGER DEFAULT 0,
  agent_a_output_tokens    INTEGER DEFAULT 0,
  agent_b_input_tokens     INTEGER DEFAULT 0,
  agent_b_output_tokens    INTEGER DEFAULT 0,
  agent_a_claude_session_id TEXT,
  agent_b_claude_session_id TEXT,
  agent_a_profile_id       TEXT,
  agent_b_profile_id       TEXT,
  goal_prompt              TEXT DEFAULT '',
  rate_limited_until       DATETIME,
  started_at               DATETIME,
  paused_at                DATETIME,
  completed_at             DATETIME,
  error                    TEXT
)

-- Individual autopilot cycles (Agent A → Agent B turns)
autopilot_cycles (
  id               TEXT PRIMARY KEY,
  run_id           TEXT REFERENCES autopilot_runs,
  cycle_number     INTEGER NOT NULL,
  agent_a_prompt   TEXT,
  agent_a_response TEXT,
  agent_a_tokens_in  INTEGER DEFAULT 0,
  agent_a_tokens_out INTEGER DEFAULT 0,
  agent_b_prompt   TEXT,
  agent_b_response TEXT,
  agent_b_tokens_in  INTEGER DEFAULT 0,
  agent_b_tokens_out INTEGER DEFAULT 0,
  commit_hash      TEXT,
  commit_message   TEXT,
  files_changed    TEXT DEFAULT '[]',
  status           TEXT DEFAULT 'pending',
  started_at       DATETIME,
  completed_at     DATETIME
)
```

::: info Design Rationale: SQLite
SQLite was chosen over PostgreSQL or MySQL because Viridian is designed as a **single-user or small-team tool** running on a developer's local machine. SQLite requires zero configuration, stores everything in a single file, and with WAL mode provides excellent read concurrency. The embedded nature also means no separate database process to manage.
:::

## Communication Patterns

The application uses three distinct communication patterns, each chosen for a specific use case:

### REST API (CRUD Operations)

Standard HTTP endpoints under `/api/*` handle stateless operations:

```
Client                          Server
  │                               │
  │  POST /api/auth/login         │
  │  ─────────────────────────►   │
  │  ◄─────────────────────────   │
  │  { token, username }          │
  │                               │
  │  GET /api/files/tree          │
  │  Authorization: Bearer <jwt>  │
  │  ─────────────────────────►   │
  │  ◄─────────────────────────   │
  │  { tree: [...] }              │
  │                               │
  │  GET /api/sessions/:id/messages│
  │  ─────────────────────────►   │
  │  ◄─────────────────────────   │
  │  { messages, total, hasMore } │
```

Used for: authentication, file operations, git operations, session listing, task CRUD, graph CRUD, settings, API key management.

### WebSocket (Real-Time Streaming)

Persistent WebSocket connections handle bidirectional, event-driven communication:

```
Client                          Server                    Claude CLI
  │                               │                          │
  │  WS Connect /ws/chat          │                          │
  │  ?token=<jwt>                 │                          │
  │  ════════════════════════►    │                          │
  │                               │                          │
  │  { type: "chat",             │                          │
  │    prompt: "Hello",          │                          │
  │    sessionId, claudeSessionId,│                          │
  │    cwd, model }              │                          │
  │  ─────────────────────────►  │  spawn claude            │
  │                               │  --resume <id>           │
  │                               │  ──────────────────────► │
  │                               │                          │
  │  ◄── stream_start            │                          │
  │  ◄── thinking_start          │  ◄── content_block_start │
  │  ◄── thinking_delta          │  ◄── content_block_delta │
  │  ◄── thinking_end            │  ◄── content_block_stop  │
  │  ◄── stream_delta            │  ◄── text_delta          │
  │  ◄── stream_delta            │  ◄── text_delta          │
  │  ◄── tool_use                │  ◄── tool_use            │
  │  ◄── tool_input_delta        │  ◄── input_json_delta    │
  │  ◄── tool_input_complete     │  ◄── content_block_stop  │
  │  ◄── control_request         │  ◄── control_request     │
  │                               │                          │
  │  { type: "tool_response",    │  control_response        │
  │    requestId, approved }     │  ──────────────────────► │
  │  ─────────────────────────►  │                          │
  │                               │                          │
  │  ◄── stream_end              │  ◄── result              │
  │  { sessionId,                │                          │
  │    claudeSessionId,          │                          │
  │    usage }                   │                          │
```

Key WebSocket event types for chat:

| Event | Direction | Purpose |
|-------|-----------|---------|
| `chat` | Client to Server | Send a message to Claude |
| `stream_start` | Server to Client | Response streaming has begun |
| `stream_delta` | Server to Client | Incremental text chunk |
| `thinking_start/delta/end` | Server to Client | Extended thinking content |
| `tool_use` | Server to Client | Claude wants to use a tool |
| `tool_input_delta` | Server to Client | Streaming tool input JSON |
| `tool_input_complete` | Server to Client | Final parsed tool input |
| `control_request` | Server to Client | Permission prompt from CLI |
| `tool_response` | Client to Server | User approves/denies tool |
| `stream_end` | Server to Client | Response complete, includes usage |
| `check_session` | Client to Server | Reconnect to an active session |
| `session_status` | Server to Client | Session streaming state |
| `abort` | Client to Server | Cancel current response |
| `error` | Server to Client | Error (rate limit, CLI crash, etc.) |

::: info Design Rationale: WebSocket Reconnection
The client uses `useWebSocket`, a composable that automatically reconnects on disconnection with exponential backoff. On reconnection, it sends a `check_session` message. If the server reports the session is still streaming, the client re-wires event listeners and resumes receiving events. If streaming has finished, it fetches missed messages via REST. This makes the system resilient to network interruptions.
:::

### WebSocket Keepalive

Each WebSocket connection has a ping/pong heartbeat:

- The server pings every **30 seconds**
- If no pong is received within **10 seconds**, the connection is terminated
- The client's `useWebSocket` composable detects disconnection and reconnects automatically

## Authentication Flow

```
┌─────────┐                    ┌─────────┐                   ┌────────┐
│  Client  │                    │  Server  │                   │ SQLite │
└────┬─────┘                    └────┬─────┘                   └───┬────┘
     │                               │                             │
     │  POST /api/auth/register      │                             │
     │  { username, password }       │                             │
     │  ─────────────────────────►   │                             │
     │                               │  bcrypt.hash(password)      │
     │                               │  ──────────────────────►    │
     │                               │  INSERT INTO users          │
     │                               │  ◄──────────────────────    │
     │                               │  jwt.sign({ id, username }) │
     │  ◄─────────────────────────   │                             │
     │  { token, username }          │                             │
     │                               │                             │
     │  localStorage.setItem(        │                             │
     │    'token', token)            │                             │
     │                               │                             │
     │  GET /api/files/tree          │                             │
     │  Authorization: Bearer <jwt>  │                             │
     │  ─────────────────────────►   │                             │
     │                               │  jwt.verify(token)          │
     │                               │  → { id, username }         │
     │                               │                             │
     │  WS /ws/chat?token=<jwt>      │                             │
     │  ════════════════════════►    │                             │
     │                               │  verifyToken(token)         │
     │                               │  → connection accepted      │
```

**Token storage:** The client stores the JWT in `localStorage` (via the `auth` Pinia store). The token is:

- Sent as `Authorization: Bearer <token>` for REST API calls
- Passed as `?token=<token>` query parameter for WebSocket upgrades

**Token validation:** The `authMiddleware` extracts the Bearer token from the `Authorization` header, verifies it using `jsonwebtoken`, and attaches the decoded user to `req.user`. WebSocket handlers verify the token during the upgrade handshake.

**Security measures:**
- Passwords are hashed with **bcrypt** before storage
- JWT secret must be at least **32 characters** in production
- A default development secret is used only when `NODE_ENV !== 'production'`

## Claude Integration

### Binary Resolution

The `claude-sdk.ts` module locates the Claude CLI binary in this priority order:

1. `CLAUDE_PATH` environment variable (explicit override)
2. VS Code extension's native binary (searched in `~/.vscode/extensions/anthropic.claude-code-*/resources/native-binary/claude`)
3. `which claude` (system PATH fallback)

::: info Design Rationale: VS Code Extension Binary
The Claude Code VS Code extension ships a native binary that is faster and more reliable than the npm wrapper. The SDK searches for it first because many developers already have the extension installed, making the setup zero-configuration.
:::

### Process Spawning

Each conversation spawns a new Claude CLI process using `child_process.spawn`:

```ts
const proc = spawn(claudeBin, [
  '--output-format', 'stream-json',   // JSON events on stdout
  '--input-format', 'stream-json',    // JSON messages on stdin
  '--verbose',                         // Include token usage events
  '--include-partial-messages',        // Stream tool input as it's generated
  '--resume', sessionId,               // Resume existing conversation
  '--model', model,                    // Claude model selection
  '--permission-mode', 'bypassPermissions',  // Default permission mode
  '--allowedTools', 'Read,Write,...',  // Tool whitelist
], {
  cwd: projectDir,                     // Working directory for file operations
  stdio: ['pipe', 'pipe', 'pipe'],     // Bidirectional communication
});
```

### Bidirectional Communication

The CLI uses **stream-json** format for both input and output:

**Input (stdin):** The initial user message is sent as JSON:
```json
{ "type": "user", "message": { "role": "user", "content": "Hello" } }
```

Permission responses are sent back via stdin:
```json
{
  "type": "control_response",
  "response": {
    "subtype": "success",
    "request_id": "req_123",
    "response": { "behavior": "allow" }
  }
}
```

**Output (stdout):** The CLI emits a stream of JSON events, one per line:
- `system` — session ID assignment
- `stream_event` — wraps Anthropic API events (content_block_start/delta/stop, message_start/delta)
- `control_request` — permission prompt (can_use_tool)
- `assistant` — complete assistant messages (for sub-agent results)
- `user` — tool results (sub-agent completion)
- `result` — final event with session ID and exit code

### Session Resumption

Claude CLI maintains conversation history in JSONL files (one per session). The `--resume <sessionId>` flag tells the CLI to continue an existing conversation rather than starting a new one.

The application tracks two distinct session IDs:

| ID | Scope | Purpose |
|----|-------|---------|
| `sessionId` | Server | UUID key for the in-memory `activeSessions` Map. Ephemeral — lost on server restart. |
| `claudeSessionId` | Claude CLI | JSONL filename. Persistent — survives server restarts. Used with `--resume`. |

The client persists `claudeSessionId` in `sessionStorage` and sends it with every `chat` message. When the server creates a new session, it passes this ID to `claudeQuery()` so the CLI resumes the correct conversation. This means:

1. A page reload reconnects to the same Claude conversation
2. A server restart still allows resuming (the JSONL file persists on disk)
3. The URL uses `claudeSessionId` so bookmark-sharing and sidebar navigation work correctly

### Session Lifecycle

```
1. User sends first message
   └─► Server creates ClaudeSession (UUID + EventEmitter)
       └─► claudeQuery() spawns CLI process
           └─► CLI emits "system" event with its session ID
               └─► Server stores as claudeSessionId

2. User sends follow-up message
   └─► Server finds existing ClaudeSession by UUID
       └─► claudeQuery() spawns new CLI process with --resume
           └─► CLI loads JSONL history and continues conversation

3. Page reload
   └─► Client reads claudeSessionId from sessionStorage
       └─► Sends check_session to server
           ├─► If streaming: re-wires event listeners, resumes
           └─► If finished: fetches messages via REST

4. Server restart
   └─► All in-memory sessions are lost (UUID → ClaudeSession map)
       └─► Client still has claudeSessionId in sessionStorage
           └─► Creates new server session with preserved claudeSessionId
               └─► --resume works because JSONL file is on disk
```

### SDK Message Types

The `claude-sdk.ts` module parses raw CLI events and yields a typed `SDKMessage` union:

| Type | Content |
|------|---------|
| `text_delta` | Incremental assistant text |
| `thinking_start/delta/end` | Extended thinking block |
| `tool_use` | Tool invocation (name, input, requestId) |
| `tool_input_delta` | Streaming partial JSON for tool input |
| `tool_input_complete` | Final parsed tool input |
| `control_request` | Permission prompt from CLI |
| `message_start` | Token usage (input, cache creation, cache read) |
| `message_delta` | Token usage (output) |
| `subagent_result` | Sub-agent task completion |
| `system` | Session ID assignment |
| `result` | Conversation complete (session ID, exit code) |
| `error` | Error from stderr (rate limits, CLI crashes) |

The SDK uses an **async generator** pattern (`async function*`), allowing callers to consume events with a simple `for await...of` loop:

```ts
for await (const msg of claudeQuery({ prompt, cwd, sessionId })) {
  switch (msg.type) {
    case 'text_delta':   session.accumulatedText += msg.text; break;
    case 'tool_use':     session.emitter.emit('tool_use', { ... }); break;
    case 'result':       session.isStreaming = false; break;
  }
}
```

::: info Design Rationale: CLI over API
The application spawns the Claude CLI binary rather than calling the Anthropic API directly. This gives access to Claude's built-in tool ecosystem (file read/write, bash, search, etc.) without reimplementing any tool execution logic. The CLI handles tool execution, permission management, and conversation history — the web app just provides the interface.
:::
