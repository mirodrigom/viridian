# Terminal

Viridian includes a fully interactive terminal embedded in the browser. It is not a command runner that captures output line-by-line — it is a real PTY (pseudo-terminal) session streamed to the client via WebSocket, giving you the same experience you would have in a native terminal emulator.

## How It Works

The terminal is built on two main pieces:

| Layer | Technology | Role |
|-------|-----------|------|
| **Client** | [xterm.js](https://xtermjs.org/) | Terminal emulator rendered in the browser |
| **Server** | [node-pty](https://github.com/nicolestandifer3/node-pty-prebuilt-multiarch) | Spawns a real PTY process (your shell) |

When you open the terminal panel, the client opens a WebSocket connection to `/ws/shell`. The server spawns a shell process (from `$SHELL`, falling back to `/bin/bash`) inside a pseudo-terminal set to `xterm-256color`. Every byte of output from the PTY is forwarded to the browser over the WebSocket, and every keystroke you type is sent back.

```
Browser (xterm.js)  <──WebSocket──>  Server (node-pty)  <──PTY──>  bash/zsh
```

The terminal's working directory defaults to the currently selected project path.

## Rendering

xterm.js supports multiple rendering backends. Viridian attempts to load the **WebGL addon** first for GPU-accelerated rendering, which provides noticeably smoother scrolling and lower CPU usage. If WebGL is unavailable (e.g., in some remote desktop environments), it silently falls back to the **canvas renderer**.

::: info
The WebGL addon must be loaded after `terminal.open()` — the code handles this automatically.
:::

## Terminal Features

### Copy & Paste

The terminal provides clipboard integration that matches native terminal conventions:

- **Ctrl+C** — Copies selected text if a selection exists; otherwise sends `SIGINT` (interrupt) to the running process
- **Ctrl+Shift+C** — Always copies the selection
- **Ctrl+V** / **Ctrl+Shift+V** — Pastes from the system clipboard into the terminal
- **Right-click** — Pastes from the clipboard (like many Linux terminal emulators)

Pasted text is sent directly to the PTY as input, so it works with any program (editors, REPLs, interactive prompts).

### Clickable URLs

The [WebLinksAddon](https://github.com/xtermjs/xterm.js/tree/master/addons/addon-web-links) is loaded automatically. Any URL printed to the terminal becomes a clickable link that opens in a new browser tab.

### Scrollback

The terminal keeps a scrollback buffer of **5,000 lines**, so you can scroll up to review earlier output.

## Auth URL Detection

When a CLI tool (e.g., `gh auth login`, `gcloud auth login`) prints an authentication URL, the terminal detects it automatically and shows an overlay banner with three actions:

- **Open in Browser** — Opens the URL in a new tab
- **Copy URL** — Copies the URL to your clipboard
- **Dismiss** — Hides the banner

The detection uses a regex that matches URLs containing common auth-related path segments (`/auth`, `/login`, `/oauth`, `/device`, `/callback`, etc.) or query parameters (`code=`, `token=`, `state=`).

::: tip
The overlay auto-dismisses after 30 seconds if you don't interact with it.
:::

## Resizable Panel

The terminal lives inside a `TerminalPanel` component rendered at the bottom of the main layout. You can drag the divider to resize it vertically. The terminal automatically re-fits its column and row count to the new dimensions using xterm.js's `FitAddon`, and sends a `resize` message to the server so the PTY dimensions stay in sync.

```json
{ "type": "resize", "cols": 120, "rows": 30 }
```

This ensures programs like `vim`, `htop`, and `less` render correctly at any panel size.

## Toggling the Terminal

The terminal panel can be toggled on and off from the **TopBar**. When hidden, the WebSocket connection and PTY process are cleaned up. When shown again, a fresh shell session is spawned.

## WebSocket Protocol

The `/ws/shell` endpoint uses a simple JSON message protocol:

**Client to Server:**

| Type | Fields | Description |
|------|--------|-------------|
| `input` | `data: string` | Keystrokes or pasted text to write to the PTY |
| `resize` | `cols: number, rows: number` | Resize the PTY to match the client viewport |

**Server to Client:**

| Type | Fields | Description |
|------|--------|-------------|
| `terminal_ready` | `id: string` | Session ID assigned to this terminal |
| `output` | `data: string` | Raw output from the PTY |
| `exit` | `exitCode: number` | The shell process has exited |
| `error` | `message: string` | Terminal could not be created (e.g., `node-pty` missing) |

Authentication is handled via a `token` query parameter on the WebSocket URL, validated against the same JWT used by the REST API.

## Why PTY Instead of Just Running Commands?

A naive approach would be to spawn `child_process.exec()` for each command and stream `stdout`/`stderr`. That works for one-off commands, but breaks down for anything interactive:

- **Interactive programs** like `vim`, `htop`, `python`, `ssh`, and `docker exec -it` require a TTY to function. Without one, they either refuse to start or behave incorrectly.
- **Job control** (`Ctrl+Z`, `fg`, `bg`) requires a real terminal session.
- **Signal handling** (`Ctrl+C` as SIGINT, `Ctrl+\` as SIGQUIT) relies on the TTY driver.
- **Line editing** (arrow keys, history, tab completion) is provided by the shell's readline integration with the PTY.
- **Environment continuity** — a PTY session keeps shell state (variables, aliases, virtual environments) across multiple commands, just like a local terminal.

By using `node-pty`, the terminal provides the same fidelity as a desktop terminal emulator.

::: tip
If `node-pty` is not installed (it requires native compilation), the terminal feature is gracefully disabled and the server logs a warning. The rest of the application continues to work normally.
:::
