# Changelog

All notable changes to Viridian are documented here. This project follows [Semantic Versioning](https://semver.org/).

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
