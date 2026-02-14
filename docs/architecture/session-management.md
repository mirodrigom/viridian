# Session Management Architecture

Viridian wraps the Claude CLI binary and exposes it through a web interface. The CLI was designed for terminal use with built-in session persistence via JSONL files. Adapting this model to a web client that can disconnect, reconnect, and browse history required a session management layer that bridges two fundamentally different identity systems.

This document explains why that layer exists, how it works, and the trade-offs behind each design choice.

---

## The Dual Session ID Problem

Every active conversation is identified by **two different IDs** that serve different purposes:

| ID | Created by | Format | Purpose |
|----|-----------|--------|---------|
| `sessionId` | Server (`uuid()`) | UUID v4 | Key into the in-memory `activeSessions` Map. Used for server-side operations: sending messages, aborting streams, checking status. |
| `claudeSessionId` | Claude CLI | UUID-like string | Filename of the `.jsonl` file in `~/.claude/projects/`. Passed to the CLI via `--resume` to continue a conversation with full context. |

**Why not use one ID?** The server creates its session *before* the CLI process starts. The CLI assigns its own session ID internally and writes it to a JSONL file. The server cannot predict or control what the CLI will name the file. By the time the CLI reports its session ID (via a `system` or `result` event), the server has already been using its own UUID to route WebSocket events.

The server UUID is ephemeral -- it lives only as long as the Express process runs. The Claude session ID is permanent -- it maps to a file on disk that survives server restarts, reboots, and even migration between machines.

```
Server Memory                          Disk (~/.claude/projects/)
+---------------------------+          +--------------------------------+
| activeSessions Map        |          | -home-user-myproject/          |
|                           |          |   a1b2c3d4-....jsonl           |
| "f47ac10b-..." => {      |          |   e5f6a7b8-....jsonl           |
|   id: "f47ac10b-..."     |  ---->   |                                |
|   claudeSessionId:        |          | -home-user-other/              |
|     "a1b2c3d4-..."       |          |   ...                          |
|   process: ChildProcess   |          +--------------------------------+
|   emitter: EventEmitter   |
|   isStreaming: true        |
| }                         |
+---------------------------+
     ^                                      ^
     |                                      |
  Ephemeral                             Permanent
  (lost on restart)                     (survives everything)
```

---

## Session Lifecycle

### Phase 1: Creation

When the user sends their first message, the client has no `sessionId` yet. The server creates a new entry in the `activeSessions` Map with a fresh UUID, and the client gets this ID back on `stream_end`.

```
Client                          Server                         Claude CLI
  |                               |                               |
  |-- WS: { type: "chat",        |                               |
  |         prompt: "Hello",      |                               |
  |         sessionId: null,      |                               |
  |         claudeSessionId: null,|                               |
  |         cwd: "/home/..." }    |                               |
  |   --------------------------> |                               |
  |                               |-- createSession(cwd)          |
  |                               |   id = uuid() = "f47ac..."   |
  |                               |   activeSessions.set(id, ...) |
  |                               |                               |
  |                               |-- spawn("claude",             |
  |                               |     "--output-format",        |
  |                               |     "stream-json",            |
  |                               |     "--input-format",         |
  |                               |     "stream-json", ...)       |
  |                               |   --------------------------> |
  |                               |                               |
  |                               |   <-- { type: "system",       |
  |                               |         session_id: "a1b2.."} |
  |                               |                               |
  |                               |   server stores:              |
  |                               |   session.claudeSessionId     |
  |                               |     = "a1b2c3d4-..."          |
  |                               |                               |
  |   <-- stream_delta, etc.      |   <-- content_block events    |
  |                               |                               |
  |   <-- stream_end {            |   <-- { type: "result",       |
  |         sessionId: "f47ac..", |         session_id: "a1b2.."} |
  |         claudeSessionId:      |                               |
  |           "a1b2c3d4-..." }    |                               |
  |                               |                               |
  |   client stores both IDs      |                               |
  |   URL -> /chat/a1b2c3d4-...  |                               |
```

Key details:

1. **`createSession(cwd, claudeSessionId?)`** in `server/src/services/claude.ts` generates the server UUID and optionally accepts a `claudeSessionId` for resuming.

2. The Claude CLI reports its session ID twice: first in the `system` event at stream start, then in the `result` event at stream end. The server captures it from both (line 122 and 137 in `claude.ts`).

3. The `stream_end` event sent to the client includes **both** IDs. The client saves both and uses `claudeSessionId` for the URL.

### Phase 2: Subsequent Messages

On the second message, the client sends both IDs. The server uses `sessionId` to find the existing in-memory session, avoiding creation of a new one. The `claudeSessionId` is passed to the CLI via `--resume`.

```
Client                          Server                         Claude CLI
  |                               |                               |
  |-- WS: { type: "chat",        |                               |
  |         prompt: "Next msg",   |                               |
  |         sessionId: "f47ac..", |                               |
  |         claudeSessionId:      |                               |
  |           "a1b2c3d4-..." }    |                               |
  |   --------------------------> |                               |
  |                               |-- getSession("f47ac...")      |
  |                               |   (found in activeSessions)   |
  |                               |                               |
  |                               |-- claudeQuery({               |
  |                               |     sessionId: "a1b2c3d4-..", |
  |                               |     ...                       |
  |                               |   })                          |
  |                               |   --------------------------> |
  |                               |      claude --resume          |
  |                               |        "a1b2c3d4-..."         |
```

### Phase 3: Server Restart Recovery

If the server restarts, all `activeSessions` entries are lost. The client still has both IDs in `sessionStorage`. On reconnect, the client sends a `chat` message with both IDs. Since the server UUID no longer maps to anything, the server creates a **new** session but passes the preserved `claudeSessionId` to the CLI. The CLI reads its JSONL file and resumes with full context.

```
Client                          Server (restarted)             Claude CLI
  |                               |                               |
  |-- WS: { type: "chat",        | activeSessions is EMPTY       |
  |         sessionId: "f47ac..", |                               |
  |         claudeSessionId:      |                               |
  |           "a1b2c3d4-..." }    |                               |
  |   --------------------------> |                               |
  |                               |-- getSession("f47ac...")      |
  |                               |   (NOT found -- Map is empty) |
  |                               |                               |
  |                               |-- createSession(cwd,          |
  |                               |     "a1b2c3d4-...")           |
  |                               |   new id = "x9y8z7..."       |
  |                               |                               |
  |                               |-- claudeQuery({               |
  |                               |     sessionId: "a1b2c3d4-..", |
  |                               |     ...                       |
  |                               |   })                          |
  |                               |   --------------------------> |
  |                               |      claude --resume          |
  |                               |        "a1b2c3d4-..."         |
  |                               |                               |
  |                               |   CLI reads JSONL from disk,  |
  |                               |   full conversation context   |
  |                               |   is restored.                |
```

**This is the core reason `claudeSessionId` exists.** Without it, the conversation would be lost on every server restart. The server UUID is a runtime convenience; the Claude session ID is the source of truth.

---

## JSONL Files

The Claude CLI stores every conversation as a JSONL (JSON Lines) file. Each line is a self-contained JSON object representing one event in the conversation.

### File Location

```
~/.claude/projects/
  -home-user-project-name/          <-- project path with / replaced by -
    a1b2c3d4-5678-9abc-def0.jsonl   <-- Claude session ID as filename
    e5f6a7b8-1234-5678-9012.jsonl
  -home-user-other-project/
    ...
```

The directory name is the project's absolute path with slashes replaced by hyphens. For example, `/home/user/myproject` becomes `-home-user-myproject`. The filename (minus `.jsonl`) is the Claude CLI session ID.

### File Structure

Each line contains one of these entry types:

```jsonl
{"type":"system","session_id":"a1b2c3d4-...","cwd":"/home/user/project","timestamp":"2025-01-15T10:30:00Z"}
{"type":"user","uuid":"msg-001","message":{"role":"user","content":"Explain this code"},"timestamp":"2025-01-15T10:30:01Z"}
{"type":"assistant","uuid":"msg-002","message":{"role":"assistant","content":[{"type":"thinking","thinking":"Let me analyze..."},{"type":"text","text":"This code does..."},{"type":"tool_use","id":"tool-001","name":"Read","input":{"file_path":"/src/main.ts"}}],"usage":{"input_tokens":1500,"output_tokens":800}},"timestamp":"2025-01-15T10:30:05Z"}
{"type":"summary","summary":"Explained the main.ts file structure"}
```

The server reads these files in two contexts:

1. **Session listing** (`GET /api/sessions`) -- Extracts metadata (title, message count, timestamps) by streaming through each file line-by-line.
2. **Message loading** (`GET /api/sessions/:id/messages`) -- Parses user/assistant entries into a structured message list with pagination.

### Why JSONL?

The CLI chose JSONL because it supports append-only writes (each new message is one appended line), which is safe for concurrent reads and crash-resilient. The web server reads these files as a data source but never writes to them -- only the CLI process does.

---

## The --resume Flag

The `--resume` flag is the CLI's mechanism for continuing an existing conversation. When passed a session ID:

1. The CLI locates the corresponding JSONL file
2. It loads the full conversation history into context
3. It appends new messages to the same file
4. The response maintains continuity with all prior context

In `server/src/services/claude-sdk.ts`, this is implemented at line 263-265:

```typescript
if (options.sessionId) {
  args.push('--resume', options.sessionId);
}
```

And the session ID is forwarded from the service layer in `server/src/services/claude.ts` at line 78:

```typescript
const stream = claudeQuery({
  prompt,
  cwd: session.cwd,
  sessionId: session.claudeSessionId,  // <-- passed to --resume
  // ...
});
```

### When --resume is NOT passed

On the very first message of a new conversation, `claudeSessionId` is undefined, so `--resume` is omitted. The CLI creates a new JSONL file and reports the new session ID via the `system` event. The server captures this:

```typescript
case 'system':
  if (msg.sessionId) session.claudeSessionId = msg.sessionId;
  return null;
```

And again from the `result` event when the response completes:

```typescript
case 'result':
  if (msg.sessionId) session.claudeSessionId = msg.sessionId;
  // ...
```

This double-capture ensures the `claudeSessionId` is available even if the `system` event was missed (e.g., during a reconnect).

---

## Client-Side Tracking

The Pinia chat store (`client/src/stores/chat.ts`) maintains both IDs as reactive refs:

```typescript
const sessionId = ref<string | null>(sessionStorage.getItem('chat-sessionId'));
const claudeSessionId = ref<string | null>(sessionStorage.getItem('chat-claudeSessionId'));
```

### sessionStorage Persistence

Both values are persisted to `sessionStorage` via watchers (lines 282-289):

```typescript
watch(sessionId, (v) => {
  if (v) sessionStorage.setItem('chat-sessionId', v);
  else sessionStorage.removeItem('chat-sessionId');
});
watch(claudeSessionId, (v) => {
  if (v) sessionStorage.setItem('chat-claudeSessionId', v);
  else sessionStorage.removeItem('chat-claudeSessionId');
});
```

**Why sessionStorage, not localStorage?** `sessionStorage` is scoped to a single browser tab. Opening a second tab gives it a clean slate, preventing two tabs from interfering with each other's session state. This is intentional -- each tab is an independent chat client.

### URL Routing

The URL uses `claudeSessionId`, not the server UUID:

```typescript
// In useClaudeStream.ts, on stream_end:
const urlSessionId = d.claudeSessionId || d.sessionId;
if (urlSessionId) {
  router.replace({
    name: 'chat-session',
    params: { sessionId: urlSessionId },
  });
}
```

**Why the CLI session ID in the URL?** Because the URL should identify a conversation permanently. The server UUID dies with the process; the Claude session ID maps to a file on disk. A bookmarked URL like `/chat/a1b2c3d4-...` can be loaded by reading the JSONL file, even after the server has been restarted multiple times.

### How Both IDs Are Sent

Every chat message includes both:

```typescript
// In useClaudeStream.ts sendMessage():
const payload = {
  type: 'chat',
  prompt: effectivePrompt,
  sessionId: chat.sessionId,           // server UUID (may be stale)
  claudeSessionId: chat.claudeSessionId, // CLI session ID (permanent)
  cwd: chat.projectPath,
  // ...
};
```

The server tries `sessionId` first (fast Map lookup). If it fails (server restarted), it falls back to creating a new session with the preserved `claudeSessionId`.

---

## Session Listing

The `GET /api/sessions` endpoint in `server/src/routes/sessions.ts` builds a list of all sessions by scanning JSONL files on disk.

### The Scan Process

```
~/.claude/projects/
  |
  +-- List project directories
  |   (readdirSync, filter isDirectory)
  |
  +-- For each project dir:
  |   +-- List .jsonl files (exclude agent-* files)
  |   |
  |   +-- For each file:
  |       +-- Check SQLite cache (by project_dir + session_id)
  |       |
  |       +-- Cache HIT (mtime matches)?
  |       |   +-- Return cached metadata
  |       |
  |       +-- Cache MISS?
  |           +-- Stream-parse JSONL line by line
  |           +-- Extract: title, messageCount, cwd, lastTimestamp
  |           +-- Upsert into SQLite cache
  |           +-- Return parsed metadata
  |
  +-- Tag sessions that are currently streaming
  |   (getStreamingClaudeSessionIds())
  |
  +-- Sort by lastActive DESC
  |
  +-- Return JSON response
```

### SQLite Caching

Parsing every JSONL file on every sidebar refresh would be expensive, especially with large conversation histories. The server uses a `session_cache` table in SQLite:

```sql
INSERT OR REPLACE INTO session_cache
  (id, project_dir, title, project_path, message_count, last_active, file_mtime)
VALUES (?, ?, ?, ?, ?, ?, ?)
```

The cache key is `(project_dir, id)` and the invalidation signal is `file_mtime`. If the file's modification time has not changed since the last cache write, the cached metadata is used directly. Otherwise, the file is re-parsed and the cache is updated.

**Why mtime, not a hash?** Calling `statSync` is nearly free (one syscall). Computing a hash would require reading the entire file. Since JSONL files are append-only, mtime changes reliably indicate new content.

### Title Extraction

The title comes from the first available source, in priority order:

1. A `summary` entry in the JSONL (Claude sometimes writes these)
2. The first user message text (truncated to 80 characters)

Common prompt prefixes like "ultrathink" or "think harder" are stripped from titles so they describe the actual conversation topic.

---

## Real-Time Updates

The `SessionSidebar` component connects to a second WebSocket (`/ws/sessions`) that receives notifications when JSONL files change on disk.

### Server-Side: chokidar File Watcher

In `server/src/ws/sessions.ts`, the server uses chokidar to watch `~/.claude/projects/`:

```typescript
const watcher = watch(CLAUDE_DIR, {
  ignoreInitial: true,
  depth: 1,
  usePolling: true,
  interval: 2000,
  awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 300 },
});
```

**Why polling mode?** The JSONL files are written by the Claude CLI process, which may be running in a sandboxed environment (Flatpak). Native filesystem events (`inotify`) can be unreliable across sandbox boundaries. Polling at 2-second intervals ensures detection regardless of the filesystem setup.

**Why `awaitWriteFinish`?** The CLI writes to JSONL files incrementally during a response. Without this option, chokidar would fire dozens of events during a single response. `stabilityThreshold: 500` means the watcher waits until the file has been stable for 500ms before firing, collapsing rapid writes into a single event.

### Debouncing

On top of `awaitWriteFinish`, the server applies its own debounce per file:

```
add events:    1000ms debounce  (new sessions appear after CLI finishes writing)
change events:  500ms debounce  (mid-conversation updates)
unlink events:  500ms debounce  (deletion)
```

### Broadcast Message

When a change is detected, the server broadcasts to all connected sidebar clients:

```json
{
  "type": "sessions_updated",
  "timestamp": 1705312200000,
  "changedFile": {
    "projectDir": "-home-user-myproject",
    "sessionId": "a1b2c3d4-...",
    "eventType": "change"
  }
}
```

### Client-Side Handling

The `SessionSidebar` component receives this and:

1. Calls `fetchSessions()` to refresh the session list (but **not** if `chat.isStreaming` -- see Session Protection below)
2. If the changed file matches the currently viewed session, calls `fetchNewMessages()` to append new messages via the delta API

```
chokidar                Server WS               Client Sidebar
  |                        |                        |
  |-- file changed         |                        |
  |   (debounced)          |                        |
  |  --------------------> |                        |
  |                        |-- broadcast             |
  |                        |   sessions_updated      |
  |                        |  --------------------> |
  |                        |                        |
  |                        |                        |-- if !isStreaming:
  |                        |                        |     fetchSessions()
  |                        |                        |
  |                        |                        |-- if changedFile matches
  |                        |                        |   current session:
  |                        |                        |     fetchNewMessages()
```

---

## Historical Sessions

When the user clicks a session in the sidebar, the `resumeSession()` function in `SessionSidebar.vue` executes:

```typescript
async function resumeSession(session: SessionItem) {
  if (chat.isStreaming) chat.abortStream();
  chat.clearMessages();

  chat.sessionId = session.id;
  chat.claudeSessionId = session.id;  // JSONL filename = Claude CLI session ID
  chat.activeProjectDir = session.projectDir;

  router.replace({
    name: 'chat-session',
    params: { sessionId: session.id },
  });

  // Fetch messages from the JSONL file
  const res = await fetch(
    `/api/sessions/${session.id}/messages?projectDir=${...}&limit=50`
  );
  // ...
  chat.loadMessages(data.messages, { total, hasMore, oldestIndex });
}
```

### The Identity Alignment Trick

Notice line 84: `chat.claudeSessionId = session.id`. The session list uses the JSONL filename as the session's `id` (extracted by stripping `.jsonl` from the filename in the sessions route). Since the JSONL filename **is** the Claude CLI session ID, setting `claudeSessionId` to this value means the next message the user sends will correctly `--resume` the historical conversation.

The `sessionId` (server UUID) is also set to `session.id` -- but this is just a placeholder. Since no in-memory session exists yet, the server will create a new one on the next message and assign a fresh UUID.

### Message Pagination

Historical sessions can be long. The server supports pagination:

- **Initial load:** Returns the last 50 messages (`limit=50`, no `before` param)
- **Load older:** Client sends `before=<oldestIndex>` to fetch the preceding page
- **Delta mode:** Client sends `after=<lastIndex>` to fetch only new messages since a known point

This keeps the initial load fast even for sessions with thousands of messages.

---

## Session Protection

Active streaming sessions need protection from two sources of interference:

### 1. Session List Refresh Suppression

When the user is actively chatting, the sidebar should not refresh the session list because:
- It would trigger HTTP requests to re-parse the JSONL file being actively written to
- The UI would flicker as the "currently active" session updates its metadata mid-response

The client checks `chat.isStreaming` before acting on `sessions_updated` events:

```typescript
sessionsWs.onmessage = (ev) => {
  const data = JSON.parse(ev.data);
  if (data.type === 'sessions_updated') {
    if (!chat.isStreaming) {
      fetchSessions();
    }
    // ...
    if (match && !chat.isStreaming) {
      fetchNewMessages(changed.projectDir);
    }
  }
};
```

### 2. Streaming Session ID Tagging

When the session list IS refreshed (after streaming ends), the server tags sessions that are currently streaming:

```typescript
const streamingIds = getStreamingClaudeSessionIds();
for (const s of sessions) {
  if (streamingIds.has(s.id)) {
    s.isStreaming = true;
  }
}
```

`getStreamingClaudeSessionIds()` in `claude.ts` iterates the `activeSessions` Map and collects `claudeSessionId` values where `isStreaming === true`. The sidebar uses this flag to show a spinning loader icon.

### 3. WebSocket Event Isolation

The `useClaudeStream` composable tracks which server session it is listening to and discards events from other sessions:

```typescript
let activeSessionId: string | null = chat.sessionId;

function isForCurrentSession(data: unknown): boolean {
  const d = data as { sessionId?: string };
  if (!d.sessionId) return true;
  if (!activeSessionId) return false;
  return d.sessionId === activeSessionId;
}
```

Every incoming event (except `stream_start` and `session_status`) is filtered through `isForCurrentSession`. This prevents stale events from a previous session leaking into the current chat view, which could happen if the server is still flushing events from an aborted session.

### 4. Reconnection Mid-Stream

If the WebSocket disconnects and reconnects while a response is streaming:

1. On reconnect, the client sends `check_session` with its persisted `sessionId`
2. The server checks if that session is still streaming
3. If yes, it sends back `session_status` with `isStreaming: true` and `accumulatedText` (all text generated so far)
4. The client creates a placeholder assistant message with the accumulated text and re-wires the EventEmitter listeners
5. When the stream finishes, the client does a full reload from disk to get an accurate final state

```
Client (reconnected)         Server                    Claude CLI
  |                            |                          |
  |-- check_session            |                          | (still streaming)
  |   { sessionId: "f47ac.." } |                          |
  |   -----------------------> |                          |
  |                            |-- isSessionStreaming()?   |
  |                            |   YES                    |
  |                            |                          |
  |   <-- session_status       |                          |
  |       { isStreaming: true, |                          |
  |         accumulatedText:   |                          |
  |           "Here is the..." }                          |
  |                            |                          |
  |   (restore streaming UI,   |                          |
  |    show accumulated text)  |                          |
  |                            |                          |
  |   <-- stream_delta ...     |   <-- more content       |
  |   <-- stream_end           |   <-- result             |
  |                            |                          |
  |   (full reload from JSONL  |                          |
  |    to get complete state)  |                          |
```

---

## Summary of Data Flow

```
+------------------+     +-------------------+     +------------------+
|   Browser Tab    |     |   Express Server  |     |   Claude CLI     |
|                  |     |                   |     |                  |
| sessionStorage:  |     | activeSessions:   |     | JSONL files:     |
|  - sessionId     |     |  Map<UUID, {      |     |  ~/.claude/      |
|  - claudeSession |     |    id (UUID),     |     |  projects/       |
|    Id            |     |    claudeSession  |     |    dir/          |
|  - projectPath   |     |    Id,            |     |      id.jsonl    |
|  - activeProject |     |    process,       |     |                  |
|    Dir           |     |    emitter,       |     |                  |
|                  |     |    isStreaming,    |     |                  |
| URL:             |     |    accumulated    |     |                  |
|  /chat/{claude   |     |    Text           |     |                  |
|   SessionId}     |     |  }>               |     |                  |
+--------+---------+     +--------+----------+     +--------+---------+
         |                        |                         |
         | WS /ws/chat            | spawn + stdin/stdout    | read/append
         | (sessionId +           | (--resume flag)         | JSONL
         |  claudeSessionId)      |                         |
         +------------------------+-------------------------+
                                  |
                          SQLite session_cache
                          (title, mtime, msg count)
                                  |
                          chokidar watcher
                          (polling, debounced)
                                  |
                          WS /ws/sessions
                          (broadcasts to sidebar)
```

### Key Invariants

1. **claudeSessionId is the source of truth** for conversation identity. It maps 1:1 to a JSONL file on disk.
2. **sessionId is ephemeral.** It exists only in server memory and is used for fast in-memory lookups during an active connection.
3. **The URL always uses claudeSessionId** so bookmarks and page reloads work across server restarts.
4. **sessionStorage scopes state to the tab** so multiple tabs can have independent conversations.
5. **Streaming sessions suppress sidebar refreshes** to prevent flickering and JSONL read conflicts.
6. **The --resume flag is the only mechanism for conversation continuity.** Without it, every message starts a new conversation from scratch.
