# Claude Code Web - Feature Backlog

> Comparison against [claudecodeui](https://github.com/siteboon/claudecodeui) v1.16.3
> Generated: 2026-02-11

## Legend
- **Priority**: P0 (critical) / P1 (high) / P2 (medium) / P3 (nice-to-have)
- **Effort**: S (simple, <2h) / M (medium, 2-8h) / C (complex, >8h)
- **Status**: `[ ]` todo / `[x]` we already have it / `[~]` partial

---

## 1. Chat & Conversation

| # | Feature | Priority | Effort | Status | Reference (claudecodeui) | Our files |
|---|---------|----------|--------|--------|--------------------------|-----------|
| 1.1 | **Rich Markdown rendering** (GFM, tables, math/LaTeX, syntax highlight) | P0 | M | `[x]` | `ChatInterface.jsx:107-123` (react-markdown + remark-gfm + rehype-katex) | `lib/markdown.ts` (highlight.js + marked custom renderer + copy buttons) |
| 1.2 | **Tool use visualization** (Edit=diff, Bash=$prompt, Read=file link, Grep=summary, TodoWrite=checklist) | P0 | C | `[x]` | `ChatInterface.jsx:498-818, 1109-1500` | `components/chat/tools/Tool{Bash,Edit,Read,Write,GrepGlob,TodoWrite,Default,View}.vue` |
| 1.3 | **Thinking messages** (collapsible reasoning blocks) | P1 | S | `[x]` | `ChatInterface.jsx:1730-1746` | `MessageBubble.vue` (collapsible thinking with Brain icon), `stores/chat.ts`, `services/claude.ts` |
| 1.4 | **Thinking mode selector** (Standard/Think/Think Hard/Think Harder/Ultrathink) | P2 | S | `[x]` | `ThinkingModeSelector.jsx:5-182` | `ChatInput.vue` (Brain icon selector), `stores/settings.ts` (ThinkingMode type), `useClaudeStream.ts` (prefix injection) |
| 1.5 | **Slash command system** (/help, /clear, /model, /cost, /memory, /config, /status, /rewind + custom) | P2 | M | `[x]` | `CommandMenu.jsx:14-342`, `server/routes/commands.js:1-522` | `ChatInput.vue` (7 commands: /clear /model /think /permission /status /cost /help, arrow+tab navigation, filtered popup) |
| 1.6 | **Image attachments** (drag-drop, up to 5, base64 encode) | P2 | M | `[x]` | `ChatInterface.jsx:1820-1855`, server multer config | `ChatInput.vue` (drag-drop, paste, file picker, 5 max, previews), `MessageBubble.vue` (display), `useClaudeStream.ts` (send), `ws/chat.ts` + `services/claude.ts` (temp files + --image flag) |
| 1.7 | **Chat search** (fuzzy with Fuse.js) | P2 | S | `[x]` | Fuse.js integration in ChatInterface | `MessageList.vue` (Ctrl+F search, result navigation, yellow highlights on matches) |
| 1.8 | **Input draft persistence** (save typed text per session to localStorage) | P3 | S | `[x]` | `ChatInterface.jsx:168-248` | `ChatInput.vue` (localStorage keyed by sessionId, auto-save/restore on session switch) |
| 1.9 | **File mentions** (reference files in chat input as context) | P2 | S | `[x]` | `ChatInterface.jsx:1857-1999` | `ChatInput.vue` (@autocomplete, debounced file search, badge display, context prepend), `routes/files.ts:GET /search`, `services/files.ts:searchFiles()` |
| 1.10 | **Token budget control** (set max output tokens per response) | P3 | S | `[x]` | `ChatInterface.jsx:1857-1999` | `stores/settings.ts` (maxOutputTokens), `SettingsDialog.vue` (select 4k-64k/unlimited), `useClaudeStream.ts` → `ws/chat.ts` → `services/claude.ts` (--max-tokens flag) |
| 1.11 | **Interactive tool approval** (approve/deny buttons with 55s timeout) | P1 | C | `[x]` | `ChatInterface.jsx:1569-1650`, `claude-sdk.js:1-725` | `MessageBubble.vue` (approve/deny + 55s countdown), `useClaudeStream.ts`, streaming tool input via `tool_input_delta` |
| 1.12 | **Voice input** (Whisper transcription + 4 enhancement modes) | P3 | M | `[ ]` | `MicButton.jsx:5-176` | Not implemented |

---

## 2. Session Management

| # | Feature | Priority | Effort | Status | Reference (claudecodeui) | Our files |
|---|---------|----------|--------|--------|--------------------------|-----------|
| 2.1 | **Session list from JSONL history** | P0 | - | `[x]` | `projects.js:55-180` | `routes/sessions.ts` |
| 2.2 | **Session resume with message loading** | P0 | - | `[x]` | `projects.js:878+` | `SessionSidebar.vue:71-88`, `routes/sessions.ts:209-304` |
| 2.3 | **Session pagination** (load 5, then "Load More") | P1 | S | `[x]` | `api.js:49-50`, `Sidebar.jsx:436-473` | `SessionSidebar.vue` (visibleCount=5, loadMore +10) |
| 2.4 | **Session delete** (with confirmation) | P1 | S | `[x]` | `Sidebar.jsx:496-1543`, `api.js:75-86` | `SessionSidebar.vue` (confirm + Trash2), `routes/sessions.ts:DELETE /:id` |
| 2.5 | **Session search/filter** | P2 | S | `[x]` | `Sidebar.jsx:70-86, 476-485` | `SessionSidebar.vue` (searchQuery, filteredGroups computed) |
| 2.6 | **Real-time session updates** (chokidar file watch + WebSocket broadcast) | P1 | M | `[x]` | `server/index.js` chokidar setup | `ws/sessions.ts` (chokidar v5 watches JSONL, debounced broadcast), `SessionSidebar.vue` (WS client, auto-reconnect) |
| 2.7 | **Session protection** (prevent WS updates from interrupting active chat) | P2 | S | `[x]` | `ChatInterface.jsx:1857-1999` | `SessionSidebar.vue` (skip fetchSessions during streaming, block resumeSession while streaming) |

---

## 3. Project Management

| # | Feature | Priority | Effort | Status | Reference (claudecodeui) | Our files |
|---|---------|----------|--------|--------|--------------------------|-----------|
| 3.1 | **Multi-project listing** (all projects from ~/.claude/projects/) | P1 | S | `[x]` | `projects.js:382+` | `SessionSidebar.vue` (projectGroups computed, expand/collapse, current first) |
| 3.2 | **Project renaming** (custom display names) | P3 | S | `[x]` | `api.js:70-73`, `Sidebar.jsx` inline rename | `SessionSidebar.vue` (inline rename with Pencil icon, localStorage persistence, custom display names in sidebar + search) |
| 3.3 | **Starred/favorite projects** | P3 | S | `[x]` | `Sidebar.jsx:94-102, 208-223` | `SessionSidebar.vue` (Star toggle, yellow fill, localStorage persistence, starred sort before non-starred) |
| 3.4 | **Project sort** (by name or date) | P3 | S | `[x]` | `Sidebar.jsx:260-279` | `SessionSidebar.vue` (projectSort toggle button, Date/Name modes, current project always first) |
| 3.5 | **Project delete** (with force option) | P2 | S | `[x]` | `api.js:75-86` | `routes/sessions.ts:DELETE /project/:dir` (deletes all JSONL + empty dir), `SessionSidebar.vue` (hover Trash2 button with confirm) |
| 3.6 | **Filesystem browser** (for selecting project dirs) | P2 | M | `[x]` | `server/routes/projects.js`, `api.js:155-160` | `components/DirectoryPicker.vue` (dialog with breadcrumbs, directory listing, path input, home/up nav), `DashboardPage.vue` (Browse button) |
| 3.7 | **GitHub clone** (with SSE progress) | P3 | M | `[x]` | `server/routes/projects.js` SSE clone | `routes/files.ts:POST /clone` (SSE streaming git clone --progress), `DashboardPage.vue` (Clone Repository card with URL input, progress bar, auto-open) |

---

## 4. Token Usage & Cost

| # | Feature | Priority | Effort | Status | Reference (claudecodeui) | Our files |
|---|---------|----------|--------|--------|--------------------------|-----------|
| 4.1 | **Context usage bar** (color-coded: green/yellow/red) | P1 | - | `[x]` | `TokenUsagePie.jsx:1-53` (pie chart) | `ChatInput.vue` has progress bar |
| 4.2 | **Token usage tooltip** (input/output/cost/response time) | P1 | - | `[x]` | `ChatInterface.jsx:126-166` | `ChatInput.vue` tooltip |
| 4.3 | **Token usage pie chart** (SVG circular indicator) | P3 | S | `[x]` | `TokenUsagePie.jsx:1-53` | `components/chat/TokenUsageChart.vue` (SVG donut, input=primary + output=violet arcs, percentage center), `ChatInput.vue` (replaces linear bar) |
| 4.4 | **Usage limit with reset time** (timezone-aware reset display) | P3 | S | `[x]` | `ChatInterface.jsx:126-166` | `stores/chat.ts` (sessionDurationMin, tokensPerMin, rateLimitReset computed), `ChatInput.vue` tooltip (rate + reset countdown) |

---

## 5. Code Editor

| # | Feature | Priority | Effort | Status | Reference (claudecodeui) | Our files |
|---|---------|----------|--------|--------|--------------------------|-----------|
| 5.1 | **CodeMirror editor** (syntax, line numbers, bracket matching) | P0 | - | `[x]` | `CodeEditor.jsx:640-686` | `EditorView.vue` |
| 5.2 | **Diff view** (unified merge view with navigation) | P1 | M | `[x]` | `CodeEditor.jsx:44-106` (@codemirror/merge) | `DiffEditorView.vue` (@codemirror/merge MergeView, side-by-side, collapseUnchanged), `stores/files.ts` (DiffData, openDiff/closeDiff), `MainTabs.vue` (auto-switch), `routes/git.ts:GET /file-versions`, `services/git.ts:getFileVersions()`, `GitStatus.vue` + `DiffViewer.vue` (Columns2 buttons) |
| 5.3 | **Minimap** with colored chunk gutters | P3 | M | `[ ]` | `CodeEditor.jsx:44-106` (@replit/codemirror-minimap) | Not implemented |
| 5.4 | **Editor settings** (theme, word wrap, font size, line numbers) | P2 | S | `[x]` | `CodeEditor.jsx:17-41`, `Settings.jsx:65-100` | `stores/settings.ts` (4 editor settings), `EditorView.vue` (reactive recreation), `SettingsDialog.vue` (Editor section) |
| 5.5 | **Ctrl+S save** | P1 | - | `[x]` | `CodeEditor.jsx:323-376` | `EditorView.vue` |
| 5.6 | **File type icons** (color-coded by category) | P1 | - | `[x]` | `FileTree.jsx:143-200` | `FileTree.vue` has icons |

---

## 6. Git Integration

| # | Feature | Priority | Effort | Status | Reference (claudecodeui) | Our files |
|---|---------|----------|--------|--------|--------------------------|-----------|
| 6.1 | **Status + stage/unstage** | P0 | - | `[x]` | `GitPanel.jsx:78-123` | `GitView.vue`, `GitStatus.vue` |
| 6.2 | **Diff viewer** (styled +/- lines) | P1 | M | `[x]` | `GitPanel.jsx:618-788` | `DiffViewer.vue` — per-file parsing, line numbers, hunk headers, add/del coloring, summary bar |
| 6.3 | **AI-generated commit messages** (Claude analyzes diffs) | P1 | M | `[x]` | `GitPanel.jsx:483-507` | `GitView.vue` sparkle button, `stores/git.ts:generateCommitMessage()`, `routes/git.ts:generate-commit-message` |
| 6.4 | **Branch management** (list, switch, create) | P1 | M | `[x]` | `GitPanel.jsx:156-210` | `GitView.vue` collapsible branch list, create/switch/checkout, `routes/git.ts:checkout,create-branch` |
| 6.5 | **Remote operations** (fetch/pull/push/publish) | P1 | M | `[x]` | `GitPanel.jsx:212-318` | `GitView.vue` Fetch/Pull/Push buttons, `routes/git.ts:pull,push,fetch` |
| 6.6 | **Discard changes / delete untracked** (per-file, with confirm) | P2 | S | `[x]` | `GitPanel.jsx:320-406` | `GitStatus.vue` undo button per file with confirm(), `routes/git.ts:discard` |
| 6.7 | **Commit history viewer** (log + per-commit diffs) | P2 | M | `[x]` | `GitPanel.jsx:798-1398` | `GitView.vue` collapsible history, click commit → show diff, `routes/git.ts:show` |
| 6.8 | **File selection for commits** (checkboxes + select all) | P2 | S | `[x]` | `GitPanel.jsx:549-606` | `GitStatus.vue` (checkboxes, select all, indeterminate, Stage Selected), `stores/git.ts` (selectedFiles Set) |
| 6.9 | **Open file with diff context** (click git file → editor with diff) | P3 | S | `[x]` | `GitPanel.jsx:424-452` | `stores/git.ts:openFileInEditor()` (sets rootPath, closes diff, opens file), `DiffViewer.vue` (FileText + Columns2 buttons per file header) |

---

## 7. Terminal

| # | Feature | Priority | Effort | Status | Reference (claudecodeui) | Our files |
|---|---------|----------|--------|--------|--------------------------|-----------|
| 7.1 | **Full PTY terminal** (xterm.js + node-pty) | P0 | - | `[x]` | `Shell.jsx:292-476` | `Terminal.vue` |
| 7.2 | **WebGL rendering** | P2 | S | `[x]` | `Shell.jsx:340-370` WebGLAddon | `Terminal.vue` (WebglAddon with canvas fallback) |
| 7.3 | **Clickable URLs** (WebLinksAddon) | P2 | S | `[x]` | `Shell.jsx:340-370` WebLinksAddon | `Terminal.vue` (WebLinksAddon) |
| 7.4 | **Auth URL detection** (overlay with Open/Copy buttons) | P3 | M | `[x]` | `Shell.jsx:499-543` | `Terminal.vue` (AUTH_URL_PATTERN regex, overlay with Open/Copy/Dismiss, 30s auto-dismiss) |
| 7.5 | **Copy/paste handling** (Ctrl+C copies selection or SIGINT) | P1 | S | `[x]` | `Shell.jsx:371-419` | `Terminal.vue` (Ctrl+C=copy selection or SIGINT, Ctrl+V/Ctrl+Shift+V=paste, right-click paste) |

---

## 8. Settings & Configuration

| # | Feature | Priority | Effort | Status | Reference (claudecodeui) | Our files |
|---|---------|----------|--------|--------|--------------------------|-----------|
| 8.1 | **Settings dialog** (model, permissions, tools) | P0 | - | `[x]` | `Settings.jsx:24-100` | `SettingsDialog.vue`, `ToolsSettingsDialog.vue` |
| 8.2 | **Tool permission patterns** (allowedTools/disallowedTools with Bash(command:*)) | P1 | M | `[x]` | `ChatInterface.jsx:250-344` | `ToolsSettingsDialog.vue` (quick-add common tools/blocks, pattern syntax help), `stores/settings.ts` (COMMON_TOOLS/COMMON_DISALLOWED), `services/claude.ts` (--allowedTools/--disallowedTools flags), `ws/chat.ts` (forward from client) |
| 8.3 | **MCP server management** (CRUD: add/list/remove stdio/HTTP/SSE servers) | P2 | C | `[ ]` | `server/routes/mcp.js:1-551` | Not implemented |
| 8.4 | **API key management** (create/list/revoke ck_ prefixed keys) | P3 | M | `[ ]` | `server/routes/settings.js:1-179` | Not implemented |
| 8.5 | **Git user config** (view/set name + email) | P3 | S | `[x]` | `api.js:167-175` | `SettingsDialog.vue` (Git Identity section, auto-load on open), `routes/git.ts:GET/PUT /user-config`, `services/git.ts:getUserConfig/setUserConfig` |

---

## 9. UI/UX

| # | Feature | Priority | Effort | Status | Reference (claudecodeui) | Our files |
|---|---------|----------|--------|--------|--------------------------|-----------|
| 9.1 | **Dark mode toggle** | P0 | - | `[x]` | `ThemeContext.jsx` | `stores/settings.ts` |
| 9.2 | **Resizable panels** | P0 | - | `[x]` | `MainContent.jsx:62-80` | `AppLayout.vue` |
| 9.3 | **PWA support** (installable, service worker) | P2 | S | `[x]` | `public/manifest.json`, `public/sw.js` | `public/manifest.json` + `public/sw.js` (network-first HTML, cache-first assets) + `index.html` (meta tags, SW registration) |
| 9.4 | **i18n** (English, Chinese, Korean) | P3 | M | `[ ]` | i18next + react-i18next | Not implemented |
| 9.5 | **Responsive mobile design** (touch handlers, iPad double-tap prevention) | P2 | M | `[x]` | `Sidebar.jsx:104-115`, `MainContent.jsx:617-670` | `ChatView.vue` (mobile slide-out sidebar), `AppLayout.vue` (auto-hide panels), `TopBar.vue` (compact), `ChatInput.vue` (wrapping status bar), `style.css` (safe-area insets, touch targets, transitions) |
| 9.6 | **Version update notification** | P3 | S | `[x]` | `useVersionCheck.js` | `composables/useVersionCheck.ts` (GitHub releases check, 12h interval, dismiss persistence), `DashboardPage.vue` (banner + version footer), `server/index.ts` (/api/version endpoint) |
| 9.7 | **Onboarding flow** (first-time wizard) | P3 | M | `[x]` | `api.js:176-181`, `AuthContext.jsx:46-57` | `components/OnboardingWizard.vue` (3-step dialog: projects dir, model+permissions, tips), `DashboardPage.vue` (auto-shows on first visit) |

---

## 10. Advanced / Future

| # | Feature | Priority | Effort | Status | Reference (claudecodeui) | Our files |
|---|---------|----------|--------|--------|--------------------------|-----------|
| 10.1 | **Multi-provider** (Cursor CLI + Codex SDK alongside Claude) | P3 | C | `[ ]` | `cursor-cli.js`, `openai-codex.js`, `shared/modelConstants.js` | Claude only |
| 10.2 | **Headless agent API** (REST API for programmatic Claude execution + GitHub PRs) | P3 | C | `[ ]` | `server/routes/agent.js:1-1232` | Not implemented |
| 10.3 | **TaskMaster integration** (task management from PRDs) | P3 | C | `[ ]` | `server/routes/taskmaster.js:1-1963` | Not implemented |
| 10.4 | **Claude Agent SDK** (instead of CLI spawning) | P2 | C | `[ ]` | `server/claude-sdk.js:1-725` | We spawn CLI directly |

---

## Recommended Implementation Order

### Phase 1 - Chat Quality (P0/P1, biggest UX impact)
1. **1.1** Rich Markdown rendering (M) - makes messages readable
2. **1.2** Tool use visualization (C) - shows what Claude is doing
3. **1.3** Thinking messages collapsible (S) - reduces noise
4. **1.11** Interactive tool approval UI (C) - enables non-bypass modes

### Phase 2 - Git & Editor Polish (P1)
5. **6.2** Diff viewer styled (M) - complete the git tab
6. **6.3** AI commit messages (M) - killer feature
7. **5.2** Editor diff view (M) - see changes inline
8. **6.5** Remote operations UI (M) - push/pull from web

### Phase 3 - Session & Project UX (P1/P2)
9. **2.6** Chokidar file watching (M) - live session updates
10. **2.3** Session pagination (S) - performance
11. **2.4** Session delete (S) - cleanup
12. **3.1** Multi-project sidebar (S) - show all projects

### Phase 4 - Nice-to-haves (P2/P3)
13. **1.5** Slash commands (M)
14. **1.6** Image attachments (M)
15. **9.3** PWA support (S)
16. **8.3** MCP server management (C)
17. **7.2** WebGL + WebLinks addons (S)
18. **1.4** Thinking mode selector (S)
