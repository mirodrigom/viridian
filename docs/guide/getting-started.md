# Getting Started

Viridian is a full-stack web application that provides a browser-based UI for [Claude Code](https://docs.anthropic.com/en/docs/claude-code). It wraps the Claude CLI with a rich interface including chat, code editing, git management, and autonomous agent features.

## Prerequisites

- **Node.js** 18+
- **pnpm** 9+
- **Claude Code CLI** installed and authenticated (`claude` command available in PATH)
- **Git** (for git integration features)

## Installation

Clone the repository and run the bootstrap script:

```bash
git clone https://github.com/mirodrigom/viridian.git viridian
cd viridian
bash setup.sh
```

`setup.sh` is idempotent — safe to run multiple times. It:

1. Checks that Node.js 20+ is available
2. Installs pnpm if missing
3. Installs npm dependencies (skips if lockfile unchanged)
4. Copies `.env.example` → `.env` if `.env` is missing

Alternatively, install manually:

```bash
git clone https://github.com/mirodrigom/viridian.git viridian
cd viridian
pnpm install
cp .env.example .env
```

## Configuration

Edit `.env` with your settings:

```ini
# Server Configuration
HOST=localhost
PORT=12000

# JWT secret (minimum 32 characters in production)
JWT_SECRET=your-secure-jwt-secret-here

# CORS origin (client dev server)
CORS_ORIGIN=http://localhost:12001

# Environment
NODE_ENV=production

# Claude CLI path (optional — override auto-detection)
# CLAUDE_PATH="C:\Program Files\nodejs\claude.cmd"

# Local Whisper (optional — see Local Whisper section below)
LOCAL_WHISPER_URL=http://localhost:8300
WHISPER_MODEL=Systran/faster-whisper-medium
WHISPER_PORT=8300
```

::: tip
Generate a secure JWT secret with: `openssl rand -base64 64`
:::

## Built-in Tracing

Viridian automatically traces every Claude turn — prompts, tool calls, subagent spans, and token usage — to the built-in SQLite database. No external service is required; tracing is always enabled with zero configuration.

Traces appear in the **Traces Panel** (right side of Chat) and in the full-page **Traces** view.

## Local Whisper (optional)

For local speech-to-text without sending audio to cloud APIs, Viridian supports [Faster Whisper](https://github.com/SYSTRAN/faster-whisper) via Docker:

```bash
docker compose up faster-whisper -d
```

Configure in `.env`:

```ini
LOCAL_WHISPER_URL=http://localhost:8300
WHISPER_MODEL=Systran/faster-whisper-medium
WHISPER_PORT=8300
```

Available models (trade-off between accuracy and VRAM usage):

| Model | VRAM | Notes |
|-------|------|-------|
| `Systran/faster-whisper-large-v3` | ~10 GB | Best accuracy |
| `Systran/faster-whisper-medium` | ~5 GB | Default, good balance |
| `Systran/faster-whisper-small` | ~2 GB | Faster, less accurate |
| `Systran/faster-whisper-base` | ~1 GB | Fastest, basic accuracy |

::: tip
If you prefer cloud providers, Viridian also supports Groq, Deepgram, Gladia, and AssemblyAI for speech-to-text. Configure them in Settings → Audio Provider.
:::

## Running in Development

Start both client and server:

```bash
pnpm dev
```

This runs concurrently:
- **Server** at `http://localhost:12000` (Express + WebSocket)
- **Client** at `http://localhost:12001` (Vite dev server with proxy)

Open `http://localhost:12001` in your browser.

### LAN Access

To access Viridian from other devices on your network (e.g., tablets, phones):

```bash
bash start-lan.sh
```

This starts with HTTPS (required for microphone access on LAN) and auto-detects your local IP. Services are available at:

- **Client**: `https://{LAN_IP}:12001`
- **Server**: `http://{LAN_IP}:12000`
- **Docs**: `http://{LAN_IP}:12002`

## First Use

1. **Login** — On first visit you'll be prompted to create credentials
2. **Select a Project** — Choose a directory from the dashboard or clone a GitHub repo
3. **Start Chatting** — Send messages to Claude in the Chat tab
4. **Explore Tabs** — Switch between Chat, Editor, Git, Tasks, Graph, Autopilot, and Management

## Building for Production

```bash
pnpm build
```

This builds:
- Client → `client/dist/` (static files served by Express in production)
- Server → `server/dist/` (compiled TypeScript)

Start the production server:

```bash
cd server
node dist/index.js
```

## Project Structure

```
viridian/
├── client/          # Vue 3 SPA (Vite + TypeScript)
│   └── src/
│       ├── components/   # Vue components by feature
│       ├── stores/       # Pinia state management
│       ├── composables/  # Reusable logic
│       ├── types/        # TypeScript definitions
│       └── router/       # Vue Router config
├── server/          # Express backend
│   └── src/
│       ├── routes/       # REST API endpoints
│       ├── services/     # Business logic
│       ├── ws/           # WebSocket handlers
│       └── db/           # SQLite database
└── docs/            # This documentation (VitePress)
```
