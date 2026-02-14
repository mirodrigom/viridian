# Chat Interface

The chat interface is the primary way to interact with Claude in Viridian. It provides a full-featured conversational experience with support for multimodal input, tool visualization, session management, and real-time streaming.

## Overview

The chat view is organized as a three-panel layout:

- **Left panel** -- Session sidebar for navigating and managing conversation history.
- **Center panel** -- The message list and input area where the conversation takes place.
- **Right panel** -- Contextual panels that appear dynamically: a Todo timeline when Claude creates tasks, or a Plan review panel when operating in Plan mode.

On mobile devices (viewport < 768px), the sidebar becomes a slide-out overlay accessible via a hamburger button, and the right panel stacks inline below the messages.

## Sending Messages

Type your message in the input area at the bottom of the chat and press **Enter** to send. Use **Shift+Enter** to insert a new line without sending.

### Text Messages

The textarea auto-resizes as you type (up to 120px height). Messages are sent to Claude along with any attached context (images, file mentions) in a single request.

### Image Attachments

You can attach up to **5 images** per message using any of these methods:

- Click the **image button** (camera icon) in the input toolbar.
- **Drag and drop** image files onto the input area. A visual "Drop images here" overlay appears during drag.
- **Paste** images directly from your clipboard (Ctrl+V / Cmd+V).

Attached images appear as thumbnails below the input. Hover over a thumbnail to reveal its remove button.

::: tip
Image attachments are converted to base64 data URLs client-side, so they work without any file upload server. Only image MIME types are accepted; other file types are silently ignored.
:::

### Rate Limiting

When the API rate limit is reached, the input area transitions to a red-tinted state with a live countdown showing when the limit resets. The textarea and send button are disabled until the cooldown expires.

## Thinking Modes

Thinking modes control how much internal reasoning Claude performs before responding. They map directly to the Claude CLI `--thinking` flag. Select a mode from the **Brain icon dropdown** in the status bar.

| Mode | Description |
|------|-------------|
| **Standard** | No extended thinking. Claude responds directly. Best for simple questions and fast interactions. |
| **Think** | Light reasoning before responding. Claude briefly considers the problem internally before answering. |
| **Think Hard** | Deeper analysis and reasoning. Claude spends more time on internal deliberation, useful for moderate complexity. |
| **Think Harder** | Thorough multi-step reasoning. Claude works through the problem methodically, suitable for complex tasks. |
| **Ultrathink** | Maximum depth reasoning. Claude uses the most extensive internal deliberation available, best for very challenging problems. |

::: info
Higher thinking modes consume more tokens and take longer, but produce more thorough and accurate responses for complex tasks. For quick questions, Standard mode is usually sufficient.
:::

When Claude uses extended thinking, a collapsible **"View thinking"** block appears above the response. Click it to expand and read Claude's internal reasoning process. During active thinking, an animated energy beam indicates that reasoning is in progress.

## Slash Commands

Type `/` to open the command palette. Commands execute locally and produce system messages in the chat -- they are not sent to Claude.

| Command | Description |
|---------|-------------|
| `/clear` | Clear the current conversation's message history. |
| `/model` | Cycle to the next available model (Sonnet 4.5 -> Opus 4.6 -> Haiku 4.5). |
| `/think` | Cycle to the next thinking mode (Standard -> Think -> Think Hard -> Think Harder -> Ultrathink). |
| `/permission` | Cycle the permission mode (Full Auto -> Accept Edits -> Plan Mode -> Ask Every Time). |
| `/status` | Display current session info: model, thinking mode, permission mode, message count, context usage, and cost. |
| `/cost` | Show detailed token usage: input tokens, output tokens, context percentage, and total cost. |
| `/help` | List all available slash commands with descriptions. |

Navigate the command menu with **Arrow Up/Down**, autocomplete with **Tab**, and execute with **Enter**. Press **Escape** to dismiss.

::: tip
Slash commands are especially useful when you want to quickly check or change settings without leaving the chat. The `/status` command gives a snapshot of everything at a glance.
:::

## File Mentions

Type `@` followed by a filename to search your project for files to attach as context. The autocomplete menu appears after typing at least one character after `@`.

- Results are fetched from the server with a 200ms debounce to avoid excessive API calls.
- Select a file with **Tab** or **Enter**, or click on it.
- Selected files appear as badges below the input area, each showing the filename with a remove button.
- When you send the message, mentioned files are prepended as `[Context files: @path/to/file]` so Claude knows which files to reference.

::: info Design rationale
File mentions use `@` syntax (similar to GitHub and Slack) because it is a familiar pattern for referencing resources. The debounced server search keeps the UI responsive even in large codebases.
:::

## Tool Visualization

When Claude uses tools during a response, each tool invocation is rendered as a dedicated card with a tool-specific visualization. The card shows a colored header with the tool name and icon, followed by the tool-specific content.

### Tool-Specific Renderers

| Tool | Visualization |
|------|---------------|
| **Bash** | Terminal-style output with the command shown prominently and stdout/stderr displayed in a scrollable code block. |
| **Edit / MultiEdit** | A diff view showing the file path and the changes made (old vs. new content). |
| **Read** | Displays the file path being read with a preview of the content. |
| **Write** | Shows the target file path and the content being written, rendered in a code block. |
| **Grep / Glob** | Shows the search pattern and matching results (file paths or content matches). |
| **TodoWrite** | Renders the task list as a visual checklist with status indicators (pending, in-progress, completed). |
| **AskUserQuestion** | Presents Claude's question in a special prompt format awaiting user input. |
| **Other tools** | Falls back to a generic JSON view of the tool input and output. |

::: tip
Tool cards are collapsible by default. Each card uses a distinct icon to help you quickly scan through a long conversation and identify what actions Claude performed.
:::

## Interactive Tool Approval

When the permission mode is set to **"Ask Every Time"** (the default secure mode), Claude's tool invocations require explicit approval before execution.

Each pending tool shows:

- An **"Awaiting approval"** badge with a **55-second countdown timer**.
- **Allow** and **Deny** buttons at the bottom of the tool card.

If you click **Allow**, the tool executes and its result is sent back to Claude. If you click **Deny**, Claude receives a rejection and adjusts its approach. If the timer expires without action, the tool is automatically denied.

::: warning
In **Full Auto** mode (`bypassPermissions`), all tools are approved automatically without prompting. Use this mode only in trusted environments or for non-destructive tasks.
:::

## Voice Input

The microphone button (visible when the browser supports the Web Speech API) enables voice-to-text input.

### How to Use

1. Click the **microphone icon** to start recording. It turns red and pulses to indicate active recording.
2. Speak your message. The browser performs real-time speech recognition.
3. Click again to stop. The transcribed text is inserted into the input field.

### Enhancement Modes

Right-click the microphone button to select an enhancement mode that transforms the raw transcription:

| Mode | Behavior |
|------|----------|
| **Raw** | Inserts the transcription exactly as recognized, with no modifications. |
| **Clean** | Capitalizes the first letter of the transcription for basic formatting. |
| **Expand** | Wraps the transcription as `Please help me with: <your speech>`, turning it into a prompt. |
| **Code** | Wraps the transcription as `Write code to <your speech>`, framing it as a coding instruction. |

::: info
Voice input uses the browser's built-in `SpeechRecognition` API (or `webkitSpeechRecognition` on Chrome). It requires an internet connection on most browsers because recognition happens on remote servers. If microphone access is denied, a toast notification explains how to fix it.
:::

## Session Management

The session sidebar on the left provides full session lifecycle management.

### Browsing Sessions

- Sessions are listed for the current project, sorted by **last active time** by default.
- Click the **sort toggle** (Date/Name) to switch between chronological and alphabetical ordering.
- Use the **search box** at the top to filter sessions by title.
- Each session entry shows its title (first user message), relative timestamp ("2h ago"), and message count badge.
- The currently active session is highlighted with a primary-colored left border.

### Session Operations

- **New Session** -- Click the "New Session" button at the bottom of the sidebar. If a stream is active, it is aborted first.
- **Resume Session** -- Click any session to load its messages. The last 50 messages are fetched initially, with older messages loaded on demand as you scroll up.
- **Delete Session** -- Hover over a session to reveal the trash icon. A confirmation dialog prevents accidental deletion.
- **Refresh** -- Click the refresh button to re-fetch the session list from the server.

### Pagination

Sessions use progressive loading: only **5 sessions** are shown initially. A "Load more" button at the bottom loads 10 additional sessions at a time. This keeps the sidebar fast even with hundreds of sessions.

### Real-Time Updates

The sidebar maintains a WebSocket connection to `/ws/sessions` that listens for file system changes. When a session file is modified (e.g., by the Claude CLI running in a terminal), the sidebar automatically refreshes. If the modified session is the one currently being viewed, new messages are fetched and appended in real time.

::: info Design rationale
Sessions are identified by their JSONL filename, which doubles as the Claude CLI session ID. This means conversations started in the web UI can be resumed from the CLI (via `claude --resume`) and vice versa, providing seamless continuity across interfaces.
:::

## Chat Search

Press **Ctrl+F** (or **Cmd+F** on macOS) to open the in-chat search bar. It appears as an overlay at the top of the message list.

- Type a query to highlight all matching messages. Matches are shown with a yellow background tint.
- The **active result** (currently focused) gets a stronger highlight.
- Use the **up/down arrows** or press **Enter** to cycle through results. The view auto-scrolls to center each result.
- A counter shows your position (e.g., "3/12").
- Press **Escape** or click the X button to close search and clear highlights.

::: tip
Chat search works on all message types -- user messages, Claude responses, and system messages. It searches the raw text content, not rendered markdown.
:::

## Token Usage Display

The status bar below the model selectors shows a **context usage indicator** with a progress bar and percentage. Hover over it to see a detailed tooltip:

- **Input tokens** -- Total tokens sent to Claude across all messages.
- **Output tokens** -- Total tokens generated by Claude.
- **Context percentage** -- How much of the model's context window is in use.
- **Last response time** -- How long the most recent response took (in seconds).
- **Token rate** -- Tokens per minute throughput.
- **Total cost** -- Estimated cost in USD for the session.
- **Session duration** -- How long the session has been active (in minutes).

The progress bar changes color based on usage: **blue** under 50%, **yellow** between 50-80%, and **red** above 80%.

## Input Draft Persistence

Your unsent message text is automatically saved to `localStorage` as you type, keyed by session ID. This means:

- If you navigate away from a session and come back, your draft is restored.
- If you refresh the page, your in-progress message is not lost.
- Each session maintains its own independent draft.
- Drafts are cleaned up when a message is sent or a slash command is executed.

::: info Design rationale
Draft persistence uses `localStorage` rather than `sessionStorage` so that drafts survive browser tab closes. The save is triggered by a Vue `watch` on the input value, making it effectively instant with no explicit save button needed.
:::
