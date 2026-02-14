# Design Decisions

This page documents the key architectural decisions made during the development of Viridian, presented as an Architecture Decision Record (ADR) log. Each entry captures the context, alternatives, and rationale behind a choice so that future contributors can understand _why_ the codebase looks the way it does.

---

## ADR-1: CLI Wrapping vs SDK

**Decision:** Wrap the official Claude CLI (`@anthropic-ai/claude-code`) via `child_process` instead of calling the Anthropic API SDK directly.

**Context:** Viridian needs to interact with Claude for chat, tool use, session management, and multi-agent coordination. There are two viable integration paths: spawn the CLI as a subprocess, or use the `@anthropic-ai/sdk` HTTP client to hit the Messages API.

**Alternatives Considered:**
- **Anthropic API SDK (`@anthropic-ai/sdk`)** — Direct HTTP calls to the Messages API. Full control over request construction, streaming, and error handling. Would require re-implementing tool use orchestration, session persistence, and prompt management from scratch.
- **Custom agent framework** — Build a bespoke agent loop on top of the raw API. Maximum flexibility but enormous surface area to maintain.

**Rationale:** The CLI provides MCP (Model Context Protocol) integration, tool use orchestration, session persistence via JSONL files, and `CLAUDE.md` project-memory support out of the box. Wrapping it means the project inherits these features for free and stays in sync with upstream improvements. The `--resume` flag enables session continuity across server restarts by referencing the JSONL session file. The trade-off is less granular control over the request lifecycle, but the benefits in reduced implementation scope and automatic feature parity far outweigh that cost.

---

## ADR-2: Dual Session IDs

**Decision:** Maintain two distinct session identifiers: a server-generated UUID and the Claude CLI session ID (the JSONL filename).

**Context:** The server needs its own session tracking for the in-memory `activeSessions` Map, WebSocket routing, and database records. However, the Claude CLI identifies sessions by JSONL filename, and the `--resume` flag requires that exact identifier to restore conversation state.

**Alternatives Considered:**
- **Single ID (server UUID only)** — Map server UUIDs to CLI sessions internally. This creates a translation layer that breaks when the server restarts and loses its in-memory map.
- **Single ID (CLI session ID only)** — Use the JSONL filename as the sole identifier everywhere. This couples server internals to an external naming convention and makes it harder to manage sessions that have no CLI counterpart (e.g., pre-creation states).

**Rationale:** Keeping both IDs gives each layer sovereignty over its own identity while maintaining a clear mapping between them. The client stores `sessionId` (server UUID) and `claudeSessionId` (CLI session ID), sending the latter with every message so the server can pass it to `--resume`. URLs use the `claudeSessionId` so that bookmarking and sharing reference the actual conversation file. Historical sessions loaded from the sidebar set `claudeSessionId = session.id` for backward compatibility.

---

## ADR-3: WebSocket for Chat

**Decision:** Use WebSocket connections for real-time chat streaming between client and server.

**Context:** Chat with Claude produces a stream of tokens, tool-use events, and status updates that must reach the client in real time. The client also needs to send signals back to the server mid-stream (tool approval/rejection, abort requests).

**Alternatives Considered:**
- **Server-Sent Events (SSE)** — Simple unidirectional streaming over HTTP. Would require a separate HTTP endpoint for client-to-server signals (tool approval, abort), introducing split-brain state management.
- **HTTP long-polling** — Simulated streaming via repeated requests. High overhead, poor latency, no real benefit over SSE or WebSocket.

**Rationale:** WebSocket provides full-duplex communication over a single persistent connection. This is essential for the chat use case where the server streams tokens to the client while the client may need to approve tool invocations or abort the generation at any moment. A single connection simplifies state management: both sides share one channel with typed message events, and connection lifecycle (open, close, error) maps cleanly to session lifecycle. SSE is used elsewhere in the project for simpler one-directional streams (see ADR-12), but chat demands bidirectionality.

---

## ADR-4: SQLite over Postgres

**Decision:** Use SQLite via `better-sqlite3` with raw SQL queries instead of PostgreSQL or an ORM.

**Context:** The application needs persistent storage for sessions, autopilot configurations, profiles, runs, cycles, and user accounts. The target deployment is self-hosted, typically single-user or small-team.

**Alternatives Considered:**
- **PostgreSQL** — Industry-standard relational database. Excellent concurrency, rich ecosystem, but requires a separate running service and configuration.
- **ORM (Prisma, Drizzle, TypeORM)** — Abstraction layer over any database. Provides migrations, type safety, and query building at the cost of added complexity and bundle size.
- **JSON file storage** — Zero-dependency persistence. Fragile under concurrent writes, no query capability, poor scalability.

**Rationale:** SQLite is a single-file, zero-configuration, embedded database that requires no external services. For a self-hosted tool with one or a handful of concurrent users, it provides more than enough performance. The `better-sqlite3` driver is synchronous (no callback/promise overhead) and faster than alternatives for single-connection workloads. Raw SQL was chosen over an ORM to keep the dependency footprint small, maintain full control over queries, and avoid the migration tooling overhead that ORMs introduce. The database file lives alongside the project data, making backup and portability trivial.

---

## ADR-5: PTY Terminal

**Decision:** Implement a full pseudo-terminal using `xterm.js` on the client and `node-pty` on the server.

**Context:** Users need to run commands from the web interface -- not just fire-and-forget executions, but interactive sessions with programs that expect a TTY (e.g., `vim`, `htop`, `ssh`, `git` interactive rebase).

**Alternatives Considered:**
- **Simple command execution (`child_process.exec`)** — Run commands and return stdout/stderr. No interactivity, no job control, no support for programs that require a terminal.
- **Terminal emulator without PTY** — Render output in a terminal-like UI but without actual PTY allocation. Would break any program that checks `isatty()` or uses terminal escape codes.

**Rationale:** A full PTY gives users a genuine terminal experience: interactive programs work, ANSI escape codes render correctly, job control (`Ctrl+C`, `Ctrl+Z`) functions as expected, and line editing (readline, arrow keys) behaves normally. The `xterm.js` + `node-pty` combination is the industry standard for web-based terminals (used by VS Code's integrated terminal, among others). The cost is a native Node.js addon (`node-pty`), but since the server already runs on Node.js with native dependencies (`better-sqlite3`), this adds no new deployment complexity.

---

## ADR-6: Vue 3 + Pinia

**Decision:** Build the client with Vue 3 (Composition API) and Pinia for state management.

**Context:** The project needed a reactive UI framework capable of handling complex state (multiple stores for chat, files, git, autopilot, graph runner, settings, auth, tasks) with strong TypeScript support.

**Alternatives Considered:**
- **React + Zustand/Redux** — Largest ecosystem, most hiring availability. JSX is powerful but verbose for template-heavy UIs. State management options are fragmented.
- **Svelte/SvelteKit** — Excellent DX and performance. Smaller ecosystem, fewer UI component libraries, less mature TypeScript support at the time of decision.
- **Vue 3 + Vuex** — Vue's legacy state management. Verbose, weaker TypeScript inference, mutation/action ceremony.

**Rationale:** Vue 3's Composition API provides excellent code organization through composables (`useClaudeStream`, `useWebSocket`, `useGraphRunner`), and Single File Components keep template, logic, and scoped styles co-located. Pinia was chosen over Vuex for its first-class TypeScript support, simpler API (no mutations, direct state access), and devtools integration. The `vue-i18n` ecosystem also provides clean internationalization with 3 locales. The overall developer experience -- reactive refs, computed properties, watchers, and SFC syntax -- maps well to a real-time application with many interconnected UI states.

---

## ADR-7: CodeMirror 6 over Monaco

**Decision:** Use CodeMirror 6 for the built-in code editor, including `@codemirror/merge` for diff views.

**Context:** The application includes a file editor that needs syntax highlighting, line numbers, and diff visualization for reviewing changes.

**Alternatives Considered:**
- **Monaco Editor** — The editor that powers VS Code. Feature-rich (IntelliSense, multi-cursor, minimap, extensive language support) but ships a very large bundle (~5-10 MB) and is designed for desktop-class environments.
- **Ace Editor** — Mature, lighter than Monaco, but its architecture predates modern bundling practices and has a less active maintenance trajectory.
- **Simple textarea with highlighting (e.g., Prism.js)** — Minimal weight but no real editing capabilities.

**Rationale:** CodeMirror 6 was designed from the ground up to be modular: you import only the extensions you need, keeping the bundle size small. Its architecture is built around an immutable state model that integrates well with Vue's reactivity. The `@codemirror/merge` extension provides diff visualization without pulling in a separate library. Mobile support is better than Monaco's, which matters for a web application that might be accessed from tablets. The trade-off is fewer out-of-the-box IDE features, but for a file viewer/editor (not a full IDE), CodeMirror 6 hits the right balance of capability and weight.

---

## ADR-8: Autopilot Dual-Agent Architecture

**Decision:** Implement the autopilot feature with two distinct agents -- an analyzer and an implementer -- rather than a single autonomous loop.

**Context:** The autopilot feature allows Claude to work autonomously on a codebase within scheduled time windows. A single-agent approach would have one Claude instance analyze problems and implement solutions in the same conversation, but this tends toward tunnel vision as context accumulates.

**Alternatives Considered:**
- **Single-agent loop** — One Claude instance cycles between analysis and implementation. Simpler to implement but prone to fixation on initial assumptions, context window exhaustion, and reduced solution quality over long runs.
- **Multi-agent swarm** — Many specialized agents (planner, coder, reviewer, tester). High coordination overhead, complex orchestration, diminishing returns for the typical use case.

**Rationale:** The dual-agent split provides separation of concerns: the analyzer evaluates the codebase state, identifies issues, and proposes a plan, while the implementer executes that plan with fresh context. This mirrors effective human workflows (architect vs. builder) and reduces tunnel vision because the implementer starts each cycle with a clean perspective informed by the analyzer's assessment. Each agent gets its own `claudeSessionId` for `--resume` across cycles, maintaining continuity within its role. Scope enforcement is layered: soft (system prompt boundaries) and hard (git staging filter via minimatch to prevent changes outside the designated scope).

---

## ADR-9: Graph Runner as Separate Feature

**Decision:** Provide a visual node-graph editor (built on Vue Flow) for multi-agent workflow coordination, separate from the chat and autopilot features.

**Context:** Users may want to orchestrate multiple Claude agents in complex workflows -- sequential processing, parallel fan-out, conditional branching, human-in-the-loop checkpoints. Expressing these as code is powerful but has a high barrier to entry.

**Alternatives Considered:**
- **Code-only orchestration** — Define workflows in JavaScript/TypeScript files. Maximum flexibility for developers but excludes less technical users and makes it hard to visualize execution flow.
- **YAML/JSON configuration** — Declarative workflow definitions. Easier than code but still requires manual editing and offers no visual feedback during execution.
- **Integrate into chat** — Let users describe workflows in natural language and have Claude orchestrate sub-agents. Novel but unpredictable and hard to debug.

**Rationale:** A drag-and-drop node graph provides immediate visual feedback about workflow structure and execution state. Vue Flow gives a solid foundation for the graph UI with built-in support for nodes, edges, handles, and viewport controls. Users can see which agents are running, which have completed, and where data flows between them. The graph runner is kept as a separate feature (not merged into chat or autopilot) because its interaction model is fundamentally different: it is about designing and executing structured multi-step workflows rather than conversational interaction or autonomous operation.

---

## ADR-10: JWT Auth without OAuth

**Decision:** Implement authentication with JWT tokens and bcrypt-hashed passwords, without OAuth/OIDC integration.

**Context:** The application needs user authentication to protect access to the terminal, file system, and Claude API keys. The typical deployment is a self-hosted instance on a developer's machine or a small team's server.

**Alternatives Considered:**
- **OAuth 2.0 / OIDC (Google, GitHub, etc.)** — Delegated authentication. Requires registering OAuth applications, handling redirect flows, managing refresh tokens, and depending on external identity providers.
- **No authentication** — Rely on network-level security (VPN, firewall). Simplest but dangerous if the instance is accidentally exposed.
- **API key only** — Stateless authentication via a shared secret. No user identity, no audit trail, awkward for multi-user setups.

**Rationale:** JWT + bcrypt provides a self-contained authentication system with no external dependencies. For a self-hosted tool, this is the right trade-off: users create an account on their own instance, passwords are securely hashed, and JWTs provide stateless session management. OAuth would add significant complexity (callback URLs, provider configuration, token refresh logic) for minimal benefit when the user base is typically one person or a small team that already controls the server. If multi-tenant SaaS deployment becomes a goal in the future, OAuth can be added as an additional authentication method without replacing the existing system.

---

## ADR-11: shadcn-vue over Full Component Library

**Decision:** Use `shadcn-vue` (copy-paste component primitives built on Radix Vue) instead of a full component library like Vuetify or Quasar.

**Context:** The UI requires a consistent set of components (buttons, dialogs, dropdowns, tabs, inputs, toasts) with a cohesive design language that can be customized extensively.

**Alternatives Considered:**
- **Vuetify** — Material Design component library. Comprehensive but opinionated about styling, heavy bundle, and version upgrades can be painful.
- **Quasar** — Full-framework approach with its own CLI, build system, and component set. Powerful but introduces significant lock-in.
- **Headless UI + custom CSS** — Maximum control but requires building every component interaction from scratch.
- **PrimeVue** — Large component set, multiple themes. Less opinionated than Vuetify but still a managed dependency with its own update cycle.

**Rationale:** `shadcn-vue` components are copied into the project source (`components/ui/`), not installed as a dependency. This gives full ownership of the code: components can be modified without fighting an upstream API, there is no version lock-in, and unused components are never bundled. The primitives are built on Radix Vue, which handles accessibility and keyboard interactions correctly. Styling uses Tailwind CSS utility classes, which aligns with the project's approach to styling. Toast notifications use `vue-sonner`, which integrates cleanly with this setup. The result is a smaller bundle, faster builds, and complete control over every component's behavior and appearance.

---

## ADR-12: SSE for Long-Running Operations

**Decision:** Use Server-Sent Events (SSE) for long-running, one-directional streaming operations like git clone, PRD parsing, and AI-generated commit messages.

**Context:** Several features produce a stream of progress updates or partial results that need to reach the client in real time, but the client does not need to send data back during the operation.

**Alternatives Considered:**
- **WebSocket** — Already used for chat (ADR-3). Could be reused for these operations, but managing a persistent bidirectional connection for a short-lived one-way stream adds unnecessary complexity.
- **HTTP polling** — Client repeatedly hits an endpoint to check for updates. High latency, wasted requests, poor user experience for progress indication.
- **HTTP response streaming (chunked transfer)** — Send data as it becomes available in a single HTTP response. Works but lacks the structured event format and automatic reconnection that SSE provides.

**Rationale:** SSE is the right tool for one-directional streaming: the server pushes events to the client over a standard HTTP connection that auto-closes when the operation completes. It requires no connection management on the client beyond an `EventSource` instance, supports named event types for structured data, and has built-in browser reconnection logic. Using SSE for these operations keeps the WebSocket channel reserved for the interactive chat use case, where bidirectional communication is genuinely needed. This separation of concerns makes each transport's lifecycle easier to reason about: WebSocket connections are long-lived and tied to sessions, while SSE connections are short-lived and tied to individual operations.
