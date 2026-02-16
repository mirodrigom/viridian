# Changelog

All notable changes to Viridian are documented here. This project follows [Semantic Versioning](https://semver.org/).

## [0.2.0] — 2026-02-16

### Added

- **Message history navigation** — Arrow Up/Down to browse sent messages (up to 50 per session), Escape to return to draft
- **Message templates** — 15+ pre-built prompt templates in 5 categories (Debug, Review, Refactor, Docs, Testing) with Ctrl+1-5 keyboard shortcuts
- **Suggested prompts** — Empty chat sessions show quick-start buttons (Debug, Explain Code, Refactor)
- **Tab notifications** — Document title changes and sound plays when Claude finishes responding on a background tab
- **Collapsible chat sidebar** — Sidebar collapses to 36px strip with toggle button and quick "New session" button
- **Send to Chat** — Forward any task from the Task Board to the Chat tab as a formatted prompt with full context
- **Task Markdown support** — Description and details fields render Markdown with preview/edit toggle in the detail dialog
- **Interleaved content blocks** — Autopilot dual chat renders text and tool calls in the order they appear during execution
- **Graph auto-save** — Graphs auto-save before running if not yet persisted

### Changed

- **Git view mobile layout** — Tab-based layout (Controls / Diff) replaces the two-panel view on mobile, with pinned commit form and staged count badge
- **Graph templates dialog** — Replaced QuickRunWizard with a unified templates dialog offering Import and Run actions per template
- **Graph editor mobile layout** — Full-canvas layout with floating action button, bottom sheets for palette/properties/runner
- **Autopilot mobile layout** — Tab-based navigation (Chat / Timeline / Dashboard) with slide-out sidebar overlay
- **Autopilot controls** — Responsive design with icon-only buttons and compact cycle display on mobile
- **Task board responsive columns** — 3 columns on desktop, 2 on tablet, 1 on mobile
- **File sidebar** — Moved from main layout into Editor tab (resizable on desktop, overlay on mobile)
- **Viewport height** — Switched from `h-screen` to `h-dvh` for proper mobile viewport handling

### Removed

- **QuickRunWizard** — Functionality merged into the Templates dialog

## [0.1.0] — 2026-02-14

Initial release.

### Added

- **Chat** — Rich conversation UI with thinking modes, tool visualization, voice input, image attachments, slash commands, file mentions, session search, and token tracking
- **Code Editor** — CodeMirror 6 with syntax highlighting, diff view, minimap, multi-tab support, and direct editing from tool results
- **Git Integration** — Full git workflow (stage, commit, branch, push/pull) with AI-generated commit messages and inline diff viewer
- **Terminal** — PTY-based interactive terminal (xterm.js + node-pty) with WebGL rendering, clickable URLs, and auth URL detection
- **Task Board** — Kanban board with manual tasks, PRD parsing, task expansion, drag-and-drop, dependencies, and subtasks
- **Autopilot** — Dual-agent autonomous collaboration with 20+ profiles, scheduling, scope enforcement, rate limiting, session continuity, and git integration
- **Graph Runner** — Visual multi-agent coordination with 6 node types, typed edges, 8 templates, execution timeline, and runner panel
- **Settings** — API key management, MCP configuration, permissions, and i18n (English, Korean, Chinese)
- **Authentication** — JWT-based auth with login/logout and API key management
- **Architecture** — Express + SQLite server, Vue 3 + Pinia client, WebSocket real-time communication (5 endpoints), Claude CLI integration with `--resume` for session continuity
- **Documentation** — VitePress site with user guides, architecture docs, and auto-generated API reference
