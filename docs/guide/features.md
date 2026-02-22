# Features Overview

Viridian organizes all its functionality into **seven main tabs**, a **resizable terminal panel**, and a **settings system**. This page provides a guided tour of each section — what it does, how it's structured, and where to go for details.

## Chat

The chat interface is the core of Viridian — your primary channel for interacting with Claude.

**Layout:** Three-panel design with a session sidebar (left), conversation area (center), and contextual panels (right) that show Claude's todo list or plan review.

**Key capabilities:**

- **Multimodal input** — Send text, paste or drag-and-drop up to 5 images, and use `@filename` mentions to attach project files as context.
- **Message history** — Navigate through sent messages with Arrow Up/Down keys (up to 50 per session).
- **Message templates** — 15+ pre-built prompt templates organized into 5 categories (Debug, Review, Refactor, Docs, Testing) with `Ctrl+1` through `Ctrl+5` keyboard shortcuts.
- **Thinking modes** — Five levels of reasoning depth (Standard, Think, Think Hard, Think Harder, Ultrathink) accessible from the status bar. Higher levels produce more thorough responses for complex problems.
- **Tool visualization** — When Claude uses tools (Bash, Edit, Read, Write, Grep, Glob, TodoWrite), each invocation is rendered as a dedicated card with tool-specific formatting — terminal output for Bash, diff views for edits, checklists for todos.
- **Interactive approval** — In secure mode, each tool call shows Allow/Deny buttons with a 55-second countdown timer. In Full Auto mode, tools execute without prompting.
- **Voice input** — Microphone button for speech-to-text with four enhancement modes (Raw, Clean, Expand, Code).
- **Slash commands** — Type `/` to access `/clear`, `/model`, `/think`, `/permission`, `/status`, `/cost`, and `/help`.
- **Session management** — Collapsible sidebar (36px collapsed, 280px expanded) listing all sessions sorted by time or name, with search, pagination, delete, and real-time WebSocket updates when session files change on disk.
- **Suggested prompts** — Empty sessions show quick-start buttons (Debug, Explain Code, Refactor) to help you get started.
- **Tab notifications** — Document title changes and a sound plays when Claude finishes responding while on a different browser tab.
- **Search** — `Ctrl+F` to find and navigate through matches across all messages.
- **Token tracking** — Status bar shows context usage percentage, cost, input/output tokens, and response time.
- **Draft persistence** — Unsent messages are saved to localStorage per session and survive page reloads.
- **Traces Panel** — When Langfuse is configured, the right panel shows a live list of the last 20 agent traces (auto-refreshes every 3s), with expandable observations (generation + tool spans).

::: tip
Sessions are identified by their JSONL filename, which is also the Claude CLI session ID. You can resume any web session from the CLI with `claude --resume <id>` and vice versa.
:::

[Full documentation →](./chat)

---

## Code Editor

A browser-based code editor built on CodeMirror 6 for viewing, editing, and diffing project files.

**Layout:** Tab bar at the top with open files, editor area in the center, and an optional minimap on the right.

**Key capabilities:**

- **File opening** — Click files in the sidebar explorer, or click filenames in chat tool results. Files from Git diff views can also be opened directly.
- **Multi-tab editing** — Each open file gets a tab with an unsaved-changes indicator (colored dot). Tabs scroll horizontally when many files are open.
- **Syntax highlighting** — Full grammar support for TypeScript/TSX, JavaScript/JSX, Python, HTML/Vue/Svelte/Astro, CSS/SCSS, JSON, and Markdown.
- **Editor features** — Active line highlighting, bracket matching, indent-with-tab, default keybindings, and optional line numbers, word wrap, and minimap.
- **Diff view** — Side-by-side comparison using `@codemirror/merge` with collapsed unchanged regions, syntax highlighting on both sides, and a color legend header. Triggered from the Git panel.
- **Save** — `Ctrl+S` / `Cmd+S` saves the active file to disk via the server API.
- **Theming** — Light and dark themes that inherit CSS custom properties from the app. Font: JetBrains Mono / Fira Code.
- **Configurable** — Font size, tab size, word wrap, line numbers, and minimap are all adjustable in Settings and take effect immediately.

[Full documentation →](./editor)

---

## Git Integration

A full Git workflow interface — stage, commit, branch, push/pull — with visual diffs and AI-generated commit messages.

**Layout:** Two-panel design on desktop with a fixed left panel (288px) for status, staging, commits, and branches, and a flexible right panel for the inline diff viewer. On mobile, switches to a tab-based layout (Controls / Diff).

**Key capabilities:**

- **File status** — Shows staged changes and unstaged changes (modified + untracked) with per-file status badges.
- **Staging** — Individual file staging (+), checkbox multi-select with a "Stage Selected (N)" button, and bulk Stage All / Unstage All operations.
- **Inline diff viewer** — Parses unified diff output into a structured view with line-level coloring (green for additions, red for deletions), line numbers for both sides, and a summary bar with totals. Toggle between Working Changes and Staged Changes.
- **Commit** — Multi-line textarea (pinned at top) with a Commit button showing a staged file count badge, disabled when the message is empty or nothing is staged.
- **AI commit messages** — Click the sparkle button to generate a conventional commit message from the staged diff. Uses SSE streaming for a live typewriter effect.
- **Branch management** — Collapsible panel listing all branches, with checkout on click and a create-branch input.
- **Remote operations** — Fetch, Pull, and Push buttons with loading spinners and error toasts.
- **Commit history** — Lazy-loaded log with commit message, short hash, author, and date. Click a commit to view its full diff.
- **Discard changes** — Red undo icon (on hover) with a confirmation dialog. Runs `git checkout -- <file>` on the server.
- **Editor integration** — "Open in editor" and "Open diff in editor" buttons on each file in the diff view.

[Full documentation →](./git)

---

## Terminal

A fully interactive PTY terminal embedded in the browser — not a command runner, but a real shell session.

**Layout:** Resizable panel at the bottom of the main layout, toggled from the top bar.

**How it works:** The client runs [xterm.js](https://xtermjs.org/) and connects via WebSocket to [node-pty](https://github.com/nicolestandifer3/node-pty-prebuilt-multiarch) on the server, which spawns your actual shell (`$SHELL` or `/bin/bash`) inside a pseudo-terminal. Every keystroke goes to the PTY, every byte of output comes back — programs like `vim`, `htop`, and `ssh` work exactly as expected.

**Key capabilities:**

- **WebGL rendering** — GPU-accelerated rendering via the WebGL addon, with automatic fallback to canvas.
- **Copy & paste** — `Ctrl+C` copies selected text (or sends SIGINT), `Ctrl+V` pastes, right-click pastes.
- **Clickable URLs** — URLs printed in the terminal become clickable links.
- **5,000-line scrollback** — Scroll up to review earlier output.
- **Auth URL detection** — Automatically detects authentication URLs (OAuth, login flows) and shows an overlay with "Open in Browser", "Copy URL", and "Dismiss" buttons. Auto-dismisses after 30 seconds.
- **Resizable** — Drag the divider to resize. The terminal re-fits columns/rows and sends a resize message to keep the PTY in sync.

[Full documentation →](./terminal)

---

## Task Board

A Kanban-style task board for planning and tracking work, with AI-powered task generation from PRDs.

**Layout:** Three columns — To Do, In Progress, Done — with a progress bar header. Responsive: 3 columns on desktop, 2 on tablet, 1 on mobile.

**Key capabilities:**

- **Manual tasks** — Create tasks with title, description, and priority (high/medium/low). Drag cards between columns to change status.
- **PRD parsing** — Paste a Product Requirements Document and Claude generates a hierarchical task breakdown with parent tasks (epics/features) and nested subtasks, including dependencies.
- **Task expansion** — Click the sparkle icon on any root task to have Claude generate 3-7 subtasks. Re-run expansion to get different breakdowns.
- **Drag and drop** — Move tasks between columns. Parent task status auto-derives from children (all done = done, all todo = todo, mixed = in progress).
- **Markdown support** — Task descriptions and details render as Markdown with a preview/edit toggle in the detail dialog.
- **Send to Chat** — Forward any task to the Chat tab as a formatted prompt with full context (title, description, details, subtasks, dependencies).
- **Dependencies** — Tasks can depend on other tasks. Blocked tasks show an orange badge. Dependencies are resolved automatically during PRD parsing.
- **Subtask management** — Inline subtask lists with clickable status icons that cycle through todo → in progress → done.
- **Project scoping** — Tasks are scoped to the project directory. Switching projects loads a different task board.
- **Filters** — Filter by status or priority using dropdown selectors in the header.

[Full documentation →](./tasks)

---

## Graph Runner

A visual multi-agent coordination system — design agent workflows as directed graphs, then execute them.

**Layout:** Three-panel resizable layout on desktop with a node palette (left), Vue Flow canvas (center), and properties/runner panel (right). On mobile, uses a full-canvas layout with bottom sheets for palette, properties, and runner, plus a floating action button for adding nodes.

**Key capabilities:**

- **Six node types** — Three executable (Agent, Subagent, Expert) and three auxiliary (Skill, MCP, Rule). Executable nodes spawn Claude CLI instances; auxiliary nodes modify their behavior.
- **Typed edges** — Delegation (parent→child), skill-usage, tool-access (MCP), rule-constraint, and data-flow. Connection rules are enforced in real time.
- **Properties panel** — Configure each node's model, system prompt, permissions, allowed tools, and type-specific fields. AI prompt generation (sparkle button) creates prompts aware of the node's connections.
- **8 templates** — Pre-built workflows including Full-Stack Dev Team, Code Review Pipeline, Security Audit Team, API Development Team, and more. Each template can be **imported** into the editor or **run directly** from the templates dialog.
- **Graph execution** — Enter a prompt and the root node orchestrates delegation to its children. Rules become `CLAUDE.md`, MCP nodes become `.mcp.json` in a temp directory. Graphs auto-save before running.
- **Real-time monitoring** — Canvas overlays show node status (yellow=running, blue=delegated, green=completed, red=failed) with animated edge flows for delegation and result returns.
- **Timeline scrubber** — DVR-like controls for replaying completed runs: step forward/backward, play/pause, variable speed (0.5x to 4x), and LIVE mode toggle.
- **Runner panel** — Three tabs: Timeline (chronological event feed), Node Detail (full output, tokens, tools, errors for a selected node), and History (past runs with load and delete).
- **Save/Load** — Graphs persist in SQLite with full node positions, edges, and viewport state. Dirty indicator for unsaved changes.
- **Auto Layout** — Arranges nodes hierarchically by type (Agents → Subagents → Experts → Auxiliary).

[Full documentation →](./graphs)

---

## Autopilot

A dual-Claude autonomous collaboration system — two specialized agents work together in cycles to analyze, implement, and commit code improvements without human intervention.

**Layout:** Three-panel resizable design on desktop with a session sidebar (left), dual chat view (center), and timeline/dashboard tabs (right). On mobile, switches to a tab-based layout (Chat / Timeline / Dashboard) with a slide-out sidebar overlay.

**The A-B-Commit cycle:**

1. **Agent A (Thinker)** — Reads the codebase, reviews previous results, suggests ONE specific improvement.
2. **Agent B (Executor)** — Receives the suggestion, implements it, summarizes what changed.
3. **Auto-commit** — Stages scope-filtered files and commits to a dedicated `autopilot/<date>-session-N` branch.
4. **Loop check** — Continue if max iterations, token budget, schedule window, and completion signal (`AUTOPILOT_COMPLETE`) all allow it.

**Key capabilities:**

- **20+ built-in profiles** — Organized by category: General (Analyst, Architect, Code Reviewer), Development (Feature Creator, Full-Stack Dev, Frontend/Backend Specialist), Testing (QA Engineer, Security Auditor, Performance Analyst), DevOps (CI/CD Optimizer, Container Specialist), Domain Experts (DB Optimizer, i18n Specialist, Doc Writer), and Orchestrators (Multi-Agent Coordinator, Sprint Planner).
- **Configuration** — Four-tab dialog: Goal (with presets), Profiles (independent model selection per agent), Scope (allowed-path globs + max iterations), and Schedule (time windows with day-of-week filtering).
- **Dual-layer scope enforcement** — Soft (system prompt instructions) + Hard (git staging filter via minimatch). Even if an agent modifies out-of-scope files, they won't be committed.
- **Rate limiting** — Automatic detection and recovery with parsed reset times, 5-second buffer, and automatic resumption.
- **Session continuity** — Each agent maintains its own `claudeSessionId` for `--resume` across cycles. Context accumulates, reducing re-reads and cost.
- **Controls** — Start, Pause (graceful — finishes current cycle), Resume, and Stop (immediate abort). Failed/aborted runs can be resumed from where they left off.
- **Scheduling** — Cron-like time windows for unattended operation. Cross-midnight windows supported.
- **Dashboard** — Live metrics: cycles, commits, files changed, estimated cost, token breakdown, and commit history.
- **Git integration** — Automatic branch creation, scoped auto-commits, push to origin, and PR creation via `gh` CLI with auto-merge.

[Full documentation →](./autopilot)

---

## Management

A project dashboard for managing long-running services, one-shot scripts, environment files, and monitoring running processes — all scoped to the active project.

**Layout:** A two-column widget grid with drag-to-reorder support. Each widget can be resized to half-width or full-width.

**Four widgets:**

| Widget | Purpose |
|--------|---------|
| **Services** | Define and control long-running processes (dev servers, workers). Start/stop individual services, view real-time stdout/stderr logs, and see uptime. Status updates stream via WebSocket. |
| **Scripts** | One-shot commands with real-time SSE output streaming. Click Run to execute; output scrolls in a terminal-style view. |
| **Env** | In-browser editor for any `.env` file in the project. Read and write the file directly from the UI. |
| **Processes** | Live snapshot of all currently running managed services, showing PID, uptime, and working directory. |

**Key capabilities:**

- **Project scoping** — Services and scripts are associated with the active project path. Switching projects loads a different set of items.
- **Drag-to-reorder** — Grab the drag handle on any widget header to reorder the grid. Layout is persisted in localStorage.
- **Running count badge** — The Management tab shows a green badge with the count of currently running services.

---

## Settings & Configuration

All preferences and integrations, accessible from the top bar.

**Quick access:**
- **Gear icon** → Main Settings (appearance, editor, integrations, git identity)
- **Wrench icon** → Tool permissions (allowed/disallowed tool patterns)
- **Sun/Moon icon** → Dark mode toggle

**Key areas:**

| Area | What it controls |
|------|-----------------|
| **Model selection** | Sonnet 4.6, Opus 4.6, or Haiku 4.5 — switchable mid-conversation from the status bar |
| **Thinking mode** | Five levels from Standard to Ultrathink — inline selector in status bar |
| **Permission mode** | Full Auto, Accept Edits, Plan Mode, Ask Every Time — inline selector |
| **Tool permissions** | Allowed/disallowed tool patterns with quick-add buttons (e.g., `Bash(git:*)`, `Read`, `Write`) |
| **MCP servers** | Register external tool servers (stdio, SSE, HTTP) with commands, URLs, env vars, and headers |
| **API keys** | Create `ck_`-prefixed bearer tokens for programmatic access. One-time display, hashed storage |
| **Editor** | Font size, tab size, word wrap, line numbers, minimap — all immediate effect |
| **Dark mode** | Single-click toggle, persisted in localStorage |
| **Language** | English, Chinese (中文), Korean (한국어) — stored in localStorage |
| **Git identity** | Project-scoped `user.name` and `user.email` configuration |

[Full documentation →](./settings)
