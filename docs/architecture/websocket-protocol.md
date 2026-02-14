# WebSocket Protocol

Viridian uses WebSockets for all real-time, bidirectional communication between the Vue client and the Express server. This page documents the five WebSocket endpoints, their message types, authentication, and error handling.

## Overview

The application exposes five WebSocket endpoints:

| Endpoint | Purpose | Pattern |
|---|---|---|
| `/ws/chat` | Claude CLI streaming (deltas, tool use, thinking) | 1:1 per browser tab |
| `/ws/shell` | Interactive terminal PTY I/O | 1:1 per terminal instance |
| `/ws/sessions` | Session list file-watching broadcasts | 1:N broadcast to all clients |
| `/ws/graph-runner` | Multi-node agent graph execution events | 1:1 per graph run |
| `/ws/autopilot` | Dual-agent autonomous collaboration events | 1:1 per autopilot run |

### Why WebSocket instead of REST

These endpoints require capabilities that HTTP request/response cannot provide efficiently:

- **Streaming tokens** -- Claude CLI emits text deltas character-by-character; SSE would work but WS allows the client to also send abort/permission signals on the same connection.
- **PTY I/O** -- Terminal input and output are continuous bidirectional byte streams. REST polling would introduce unacceptable latency.
- **File-watch broadcasts** -- The sessions endpoint pushes JSONL change notifications to all connected clients simultaneously when Claude writes session files to disk.
- **Long-running orchestration** -- Graph runner and autopilot runs span minutes to hours with dozens of event types; a persistent connection avoids repeated HTTP overhead and simplifies event ordering.

## Connection Management

### The `useWebSocket` composable

All client-side WebSocket connections go through a single composable at `client/src/composables/useWebSocket.ts`. It provides:

```ts
const { ws, connected, connect, send, on, off, disconnect } = useWebSocket('/ws/chat');
```

**Key behaviors:**

| Feature | Detail |
|---|---|
| **Authentication** | Appends `?token=<jwt>` from the auth store to the connection URL |
| **Auto-reconnect** | Exponential backoff starting at 500ms, capped at 10s (`BASE_RECONNECT_DELAY * 2^attempts`) |
| **Connection guard** | A `connecting` flag prevents overlapping connection attempts |
| **Toast notifications** | Shows "Connection lost. Reconnecting..." on unexpected close; dismisses on reconnect |
| **Type-based dispatch** | Incoming messages are JSON-parsed and dispatched by `data.type` to registered handlers |
| **Wildcard handler** | Handlers registered with `on('*', fn)` receive every message regardless of type |
| **Vue lifecycle cleanup** | `onUnmounted` automatically calls `disconnect()`, preventing leaked sockets |

**Reconnect sequence:**

```
  Client                          Server
    |                                |
    |--- WebSocket OPEN ------------>|
    |<-- Connected (onopen) ---------|
    |                                |
    |    ... connection drops ...     |
    |                                |
    |   [wait 500ms]                 |
    |--- Reconnect attempt 1 ------->| (fails)
    |   [wait 1000ms]                |
    |--- Reconnect attempt 2 ------->| (fails)
    |   [wait 2000ms]                |
    |--- Reconnect attempt 3 ------->|
    |<-- Connected (onopen) ---------|
    |   [reset attempts to 0]        |
```

### Server-side keepalive

All server WS endpoints implement a ping/pong heartbeat:

- Server sends a `ping` frame every **30 seconds**
- If no `pong` is received before the next ping cycle, the connection is terminated via `ws.terminate()`
- This detects half-open TCP connections that the OS would not close for minutes

## Chat WebSocket (`/ws/chat`)

The chat endpoint streams Claude CLI output to the browser and accepts user messages, abort signals, and tool permission responses.

### Client-to-server messages

| `type` | Fields | Description |
|---|---|---|
| `chat` | `prompt`, `sessionId?`, `claudeSessionId?`, `cwd?`, `model?`, `permissionMode?`, `images?`, `maxOutputTokens?`, `allowedTools?`, `disallowedTools?` | Send a user message to Claude. Creates or resumes a session. |
| `check_session` | `sessionId` | Query whether a session is still streaming (used after page reload). If streaming, re-wires event listeners and returns accumulated text. |
| `tool_response` | `requestId`, `approved` | Respond to a tool permission request (accept/reject). |
| `abort` | _(none beyond type)_ | Abort the current streaming response. |

### Server-to-client messages

| `type` | Fields | Description |
|---|---|---|
| `stream_start` | `sessionId` | Claude has begun generating a response |
| `stream_delta` | `sessionId`, `text` | Incremental text token |
| `thinking_start` | `sessionId` | Extended thinking block begins |
| `thinking_delta` | `sessionId`, `text` | Incremental thinking token |
| `thinking_end` | `sessionId` | Extended thinking block ends |
| `tool_use` | `sessionId`, `tool`, `input`, `requestId` | Claude is invoking a tool |
| `tool_input_delta` | `sessionId`, `tool`, `requestId`, ... | Streaming tool input JSON delta |
| `tool_input_complete` | `sessionId`, `tool`, `requestId`, ... | Tool input fully received |
| `control_request` | `sessionId`, `requestId`, ... | Permission request for a tool action |
| `stream_end` | `sessionId`, `result?`, ... | Response complete |
| `session_status` | `sessionId`, `isStreaming`, `accumulatedText?` | Reply to `check_session` |
| `error` | `error` | Error string |

### Streaming flow

```
  Client                            Server (Claude CLI)
    |                                  |
    |-- { type: "chat", prompt } ----->|
    |                                  |  spawn/resume Claude CLI
    |<-- { type: "stream_start" } -----|
    |<-- { type: "thinking_start" } ---|  (if extended thinking)
    |<-- { type: "thinking_delta" } ---|  ...repeats...
    |<-- { type: "thinking_end" } -----|
    |<-- { type: "stream_delta" } -----|  ...repeats for each token...
    |<-- { type: "stream_delta" } -----|
    |<-- { type: "tool_use" } ---------|  Claude wants to use a tool
    |<-- { type: "tool_input_delta" } -|  ...streaming tool args...
    |<-- { type: "tool_input_complete"}|
    |<-- { type: "control_request" } --|  needs permission
    |-- { type: "tool_response" } ---->|  user approves/rejects
    |<-- { type: "stream_delta" } -----|  ...more tokens...
    |<-- { type: "stream_end" } -------|
    |                                  |
```

### Session resumption after page reload

```
  Client (new tab)                  Server
    |                                  |
    |-- { type: "check_session",  ---->|
    |     sessionId: "abc123" }        |
    |                                  |  check in-memory session map
    |<-- { type: "session_status", ----|
    |     isStreaming: true,           |
    |     accumulatedText: "..." }     |
    |                                  |  re-wires emitter listeners
    |<-- { type: "stream_delta" } -----|  remaining deltas continue
    |<-- { type: "stream_end" } -------|
```

### Allowed models and permission modes

The server validates these values before passing them to the Claude CLI:

- **Models:** `claude-sonnet-4-5-20250929`, `claude-opus-4-6`, `claude-haiku-4-5-20251001`
- **Permission modes:** `default`, `acceptEdits`, `plan`, `bypassPermissions`

## Shell WebSocket (`/ws/shell`)

The shell endpoint connects a browser-based terminal emulator (xterm.js) to a server-side PTY via `node-pty`.

### Connection

The working directory is set via query parameter: `/ws/shell?token=<jwt>&cwd=/path/to/project`. On connection, the server creates a PTY and sends a `terminal_ready` message.

### Client-to-server messages

| `type` | Fields | Description |
|---|---|---|
| `input` | `data` (string) | Keyboard input forwarded to the PTY |
| `resize` | `cols`, `rows` (numbers) | Terminal dimensions changed (triggers PTY resize) |
| _(raw text)_ | _(none)_ | Fallback: non-JSON data is written directly to the PTY |

### Server-to-client messages

| `type` | Fields | Description |
|---|---|---|
| `terminal_ready` | `id` | PTY created, terminal session ID returned |
| `output` | `data` (string) | PTY stdout/stderr data (ANSI escape sequences included) |
| `exit` | `exitCode` | Shell process exited |
| `error` | `message` | PTY creation failed (e.g., `node-pty` not installed) |

### PTY I/O flow

```
  Browser (xterm.js)               Server (node-pty)
    |                                  |
    |--- WS connect (/ws/shell) ------>|
    |                                  |  createTerminal(cwd)
    |<-- { type: "terminal_ready",  ---|
    |       id: "term-xyz" }           |
    |                                  |
    |-- { type: "input",               |
    |     data: "ls -la\r" } --------->|  writeTerminal()
    |                                  |
    |<-- { type: "output",          ---|  pty.onData()
    |     data: "total 42\n..." }      |
    |                                  |
    |-- { type: "resize",              |
    |     cols: 120, rows: 40 } ------>|  resizeTerminal()
    |                                  |
    |    ... user closes tab ...       |
    |--- WS close -------------------->|  destroyTerminal()
```

### Lifecycle

- One PTY per WebSocket connection
- PTY is destroyed when the WebSocket closes (no background persistence)
- If `node-pty` is not available (e.g., Flatpak sandbox), the server sends an error and closes the socket

## Sessions WebSocket (`/ws/sessions`)

The sessions endpoint is a **broadcast-only** channel. The server watches the `~/.claude/projects/` directory for JSONL file changes and pushes notifications to all connected clients so the session sidebar can update in real time.

### Server-to-client messages

| `type` | Fields | Description |
|---|---|---|
| `sessions_updated` | `timestamp`, `changedFile?` | A JSONL session file was created, modified, or deleted |

The `changedFile` object (when present) contains:

| Field | Type | Description |
|---|---|---|
| `projectDir` | `string` | The project directory name within `~/.claude/projects/` |
| `sessionId` | `string` | The session ID (JSONL filename without extension) |
| `eventType` | `'change' \| 'add' \| 'unlink'` | The filesystem event type |

### Client-to-server messages

None. This is a unidirectional broadcast endpoint. The client only connects and listens.

### File watching details

- Uses `chokidar` with **polling** enabled (2-second interval) for cross-filesystem reliability
- Watches at **depth 1** (project directory / session file)
- Ignores files matching `agent-*` pattern (autopilot internal sessions)
- Debounces events: 1 second for `add`, 500ms for `change` and `unlink`
- `awaitWriteFinish` with 500ms stability threshold prevents partial-write notifications

### Broadcast flow

```
  Claude CLI writes to disk          Server (chokidar)         All Clients
        |                                |                        |
        |-- write session.jsonl -------->|                        |
        |                                |  [debounce 500ms]      |
        |                                |-- sessions_updated --->| Client A
        |                                |-- sessions_updated --->| Client B
        |                                |-- sessions_updated --->| Client C
```

## Graph Runner WebSocket (`/ws/graph-runner`)

The graph runner executes multi-node agent graphs where each node is a Claude session. This endpoint streams the full execution lifecycle: node starts, streaming deltas, tool use, delegation between nodes, and run completion.

### Client-to-server messages

| `type` | Fields | Description |
|---|---|---|
| `run_graph` | `graphData` (nodes + edges), `prompt`, `cwd`, `graphId?` | Start executing a graph |
| `abort_run` | _(none)_ | Abort the currently running graph |

The `graphData` object must contain:

```ts
{
  nodes: { id, type, position: { x, y }, data: Record<string, unknown> }[]
  edges: { id, source, target, sourceHandle?, targetHandle?, data: Record<string, unknown> }[]
}
```

### Server-to-client messages

| `type` | Fields | Description |
|---|---|---|
| `run_started` | `runId`, `rootNodeId` | Graph execution begins |
| `node_started` | `nodeId`, `nodeLabel`, `nodeType`, `inputPrompt`, `parentNodeId` | A node begins execution |
| `node_delta` | `nodeId`, `text` | Streaming text delta from a node |
| `node_thinking_start` | `nodeId` | Extended thinking begins for a node |
| `node_thinking_delta` | `nodeId`, `text` | Thinking text delta |
| `node_thinking_end` | `nodeId` | Extended thinking ends |
| `node_tool_use` | `nodeId`, `tool`, `input`, `requestId` | Node invokes a tool |
| `node_completed` | `nodeId`, `outputText`, `usage` | Node finished successfully |
| `node_failed` | `nodeId`, `error` | Node execution failed |
| `node_delegated` | `nodeId`, `nodeLabel`, `nodeType`, `parentNodeId`, `inputPrompt` | A child node was spawned via delegation |
| `node_skipped` | `nodeId`, `reason` | Node was skipped (condition not met) |
| `delegation` | `parentNodeId`, `childNodeId`, `childLabel`, `task` | Parent delegates a task to a child node |
| `result_return` | `parentNodeId`, `childNodeId`, `childLabel`, `result` | Child returns its result to parent |
| `run_completed` | `runId`, `finalOutput` | All nodes finished, graph run complete |
| `run_failed` | `runId`, `error` | Graph run failed |
| `run_aborted` | `runId` | Graph run was aborted by user |
| `error` | `error` | Protocol-level error |

### Node lifecycle

```
  Client                             Server (graph-runner)
    |                                    |
    |-- { type: "run_graph", ... } ----->|
    |                                    |  create RunContext + AbortController
    |<-- { type: "run_started" } --------|
    |                                    |
    |<-- { type: "node_started",     ----|  Root node begins
    |       nodeId: "A" }                |
    |<-- { type: "node_thinking_start" }-|
    |<-- { type: "node_thinking_delta" }-|  ...thinking tokens...
    |<-- { type: "node_thinking_end" } --|
    |<-- { type: "node_delta" } ---------|  ...output tokens...
    |<-- { type: "node_tool_use" } ------|
    |<-- { type: "node_delta" } ---------|
    |                                    |
    |<-- { type: "delegation",       ----|  Node A delegates to Node B
    |       parentNodeId: "A",           |
    |       childNodeId: "B" }           |
    |<-- { type: "node_delegated",   ----|
    |       nodeId: "B",                 |
    |       parentNodeId: "A" }          |
    |<-- { type: "node_delta",       ----|  Node B streams
    |       nodeId: "B" }                |
    |<-- { type: "node_completed",   ----|  Node B finishes
    |       nodeId: "B" }                |
    |<-- { type: "result_return",    ----|  Result flows back to A
    |       childNodeId: "B",            |
    |       parentNodeId: "A" }          |
    |                                    |
    |<-- { type: "node_completed",   ----|  Node A finishes
    |       nodeId: "A" }                |
    |<-- { type: "run_completed" } ------|
```

### Persistence

Graph runs are automatically persisted to SQLite (`graph_runs` table) with full timeline, per-node execution data, and token usage. The `wireRunPersistence` function listens on the same emitter as the WebSocket forwarder.

### Abort behavior

- Sending `abort_run` triggers `AbortController.abort()` on the `RunContext`
- If the WebSocket closes while a run is active, the run is also aborted
- Aborted runs emit `run_aborted` and are persisted with status `'aborted'`

## Autopilot WebSocket (`/ws/autopilot`)

The autopilot endpoint manages dual-agent autonomous collaboration. Two Claude agents (Agent A and Agent B) alternate in cycles, each building on the other's output. The server streams 24 distinct event types.

### Client-to-server messages

| `type` | Fields | Description |
|---|---|---|
| `start_adhoc` | `goalPrompt`, `agentAProfileId`, `agentBProfileId`, `agentAModel?`, `agentBModel?`, `cwd`, `allowedPaths`, `maxIterations` | Start an ad-hoc autopilot run without a saved config |
| `start_run` | `configId`, `cwd` | Start a run from a saved config (loaded from DB) |
| `pause_run` | `runId` | Pause the run after the current cycle completes |
| `resume_run` | `runId` | Resume a paused run |
| `abort_run` | `runId` | Abort the run immediately |
| `resume_failed_run` | `runId` | Retry a failed run from where it stopped |
| `get_run_state` | `runId` | Request current run snapshot (re-wires event listeners) |

### Server-to-client messages (24 event types)

#### Run lifecycle events

| `type` | Fields | Description |
|---|---|---|
| `run_started` | `runId`, `configId`, `branchName`, `agentAProfile`, `agentBProfile` | Autopilot run initialized, git branch created |
| `run_paused` | `runId`, `reason` | Run paused (user-requested or schedule window ended) |
| `run_resumed` | `runId` | Run resumed |
| `run_completed` | `runId`, `totalCycles`, `totalCommits`, `summary` | All cycles finished |
| `run_failed` | `runId`, `error` | Run failed with error |
| `run_aborted` | `runId` | Run aborted by user |
| `run_state` | `run` (full run snapshot) | Response to `get_run_state` |

#### Cycle lifecycle events

| `type` | Fields | Description |
|---|---|---|
| `cycle_started` | `runId`, `cycleNumber`, `phase: 'agent_a'` | New cycle begins with Agent A |
| `cycle_phase_change` | `runId`, `cycleNumber`, `phase: 'agent_b'` | Agent A finished, Agent B starts |
| `cycle_completed` | `runId`, `cycleNumber`, `summary` | Cycle finished (both agents done) |

#### Agent A streaming events

| `type` | Fields | Description |
|---|---|---|
| `agent_a_delta` | `runId`, `cycleNumber`, `text` | Agent A text token |
| `agent_a_thinking_start` | `runId`, `cycleNumber` | Agent A extended thinking begins |
| `agent_a_thinking_delta` | `runId`, `cycleNumber`, `text` | Agent A thinking token |
| `agent_a_thinking_end` | `runId`, `cycleNumber` | Agent A extended thinking ends |
| `agent_a_tool_use` | `runId`, `cycleNumber`, `tool`, `input`, `requestId` | Agent A tool invocation |
| `agent_a_complete` | `runId`, `cycleNumber`, `response`, `tokens` | Agent A finished its turn |

#### Agent B streaming events

| `type` | Fields | Description |
|---|---|---|
| `agent_b_delta` | `runId`, `cycleNumber`, `text` | Agent B text token |
| `agent_b_thinking_start` | `runId`, `cycleNumber` | Agent B extended thinking begins |
| `agent_b_thinking_delta` | `runId`, `cycleNumber`, `text` | Agent B thinking token |
| `agent_b_thinking_end` | `runId`, `cycleNumber` | Agent B extended thinking ends |
| `agent_b_tool_use` | `runId`, `cycleNumber`, `tool`, `input`, `requestId` | Agent B tool invocation |
| `agent_b_complete` | `runId`, `cycleNumber`, `response`, `tokens` | Agent B finished its turn |

#### Git and rate-limit events

| `type` | Fields | Description |
|---|---|---|
| `commit_made` | `runId`, `cycleNumber`, `hash`, `message`, `filesChanged` | Auto-commit after a cycle |
| `pr_created` | `runId`, `prUrl` | Pull request created |
| `rate_limited` | `runId`, `until` (timestamp) | API rate limit hit, waiting |
| `rate_limit_cleared` | `runId` | Rate limit expired, resuming |

#### Error event

| `type` | Fields | Description |
|---|---|---|
| `error` | `error` | Protocol-level or validation error |

### Cycle lifecycle

```
  Client                                Server (autopilot)
    |                                      |
    |-- { type: "start_adhoc", ... } ----->|
    |                                      |  create branch, init run
    |<-- { type: "run_started" } ----------|
    |                                      |
    |  +=== Cycle 1 =====================  |
    |<-- { type: "cycle_started",      ----|
    |       cycleNumber: 1,                |
    |       phase: "agent_a" }             |
    |<-- { type: "agent_a_delta" } --------|  ...Agent A streams...
    |<-- { type: "agent_a_tool_use" } -----|
    |<-- { type: "agent_a_delta" } --------|
    |<-- { type: "agent_a_complete" } -----|
    |                                      |
    |<-- { type: "cycle_phase_change", ----|
    |       phase: "agent_b" }             |
    |<-- { type: "agent_b_delta" } --------|  ...Agent B streams...
    |<-- { type: "agent_b_tool_use" } -----|
    |<-- { type: "agent_b_complete" } -----|
    |                                      |
    |<-- { type: "commit_made",        ----|  auto-commit changes
    |       hash: "abc1234" }              |
    |<-- { type: "cycle_completed" } ------|
    |  +=================================  |
    |                                      |
    |  +=== Cycle 2 =====================  |
    |<-- { type: "cycle_started" } --------|
    |       ...repeats...                  |
    |  +=================================  |
    |                                      |
    |<-- { type: "run_completed" } --------|
    |<-- { type: "pr_created" } -----------|  (optional)
```

### Background execution

Unlike the graph runner, the autopilot run is **not** aborted when the WebSocket disconnects. The run continues in the background. Clients can reconnect and call `get_run_state` to re-attach to a running instance and re-wire event listeners.

## Authentication

All five WebSocket endpoints use the same authentication mechanism:

1. The client includes a JWT token as a query parameter in the WebSocket URL:
   ```
   wss://host/ws/chat?token=eyJhbGciOiJIUzI1NiIs...
   ```

2. During the HTTP upgrade request, the server extracts the token and calls `verifyToken(token)`.

3. If the token is missing or invalid, the raw TCP socket is destroyed immediately via `socket.destroy()` -- the upgrade never completes and no WebSocket connection is established.

4. For endpoints that need user identity (`/ws/graph-runner`, `/ws/autopilot`), the decoded user object (`{ id, username }`) is attached to the WebSocket instance and used for DB operations (e.g., persisting graph runs, loading user-owned configs).

```
  Browser                              Server
    |                                     |
    |-- HTTP Upgrade                      |
    |   GET /ws/chat?token=<jwt>          |
    |   Connection: Upgrade               |
    |   Upgrade: websocket       -------->|
    |                                     |  verifyToken(jwt)
    |                                     |  -- valid: handleUpgrade()
    |<-- 101 Switching Protocols ---------|
    |                                     |
    |   (or if invalid:)                  |
    |                                     |  socket.destroy()
    |<-- TCP RST (connection refused) ----|
```

**Security note:** The token is visible in server logs and browser history via the URL. In production, ensure HTTPS/WSS is used so the token is encrypted in transit.

## Error Handling

### Error message format

All endpoints use a consistent error message format:

```json
{
  "type": "error",
  "error": "Human-readable error description"
}
```

Some endpoints use `"message"` instead of `"error"` for the payload field (notably the shell endpoint uses `{ type: "error", message: "..." }`).

### Common error conditions

| Condition | Endpoint(s) | Error message |
|---|---|---|
| Malformed JSON | All | `"Invalid message format"` |
| Missing required fields | `/ws/chat` | `"Missing or invalid prompt"` |
| Missing graph data | `/ws/graph-runner` | `"Missing graphData, prompt, or cwd"` |
| Missing autopilot fields | `/ws/autopilot` | `"Missing required fields: goalPrompt=..., agentA=..., agentB=..., cwd=..."` |
| Config not found | `/ws/autopilot` | `"Config not found"` |
| Run not found | `/ws/autopilot` | `"Run not found"` or `"Run not found or not paused"` |
| PTY unavailable | `/ws/shell` | `"Terminal not available (node-pty not installed)"` |

### Connection recovery patterns

| Scenario | Behavior |
|---|---|
| **Network drop** | Client `useWebSocket` detects `onclose`, shows toast, begins exponential backoff reconnect |
| **Server restart** | All connections close; clients reconnect automatically; chat sessions can be resumed via `check_session` |
| **Token expired** | Upgrade request fails with `socket.destroy()`; client sees `onclose` and attempts reconnect (which will also fail until re-authentication) |
| **Chat session resume** | After reconnect, client sends `check_session` with the previous `sessionId`; server re-wires emitter listeners if the session is still active in memory |
| **Autopilot reconnect** | Client sends `get_run_state` with `runId`; server returns full snapshot and re-wires event listeners; run was never interrupted |
| **Graph runner disconnect** | Active run is **aborted** on WS close (unlike autopilot); client must start a new run |

### The `safeSend` pattern

Every server endpoint wraps outbound messages with a `safeSend` helper that checks `ws.readyState === WebSocket.OPEN` before sending. This prevents crashes when emitter events fire after the socket has closed but before cleanup runs:

```ts
function safeSend(ws: WebSocket, data: unknown) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}
```

### Event listener cleanup

All endpoints that wire EventEmitter listeners to WebSocket connections return a cleanup function. This function is called on `ws.close` to remove only that connection's listeners from the shared emitter, preventing memory leaks when multiple clients connect to the same session or run:

```ts
function wireEmitter(ws, emitter, sessionId): () => void {
  const listeners = [];
  // ... add listeners ...
  return () => {
    for (const { event, handler } of listeners) {
      emitter.removeListener(event, handler);
    }
  };
}
```
