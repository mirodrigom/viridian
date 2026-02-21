# Settings

Viridian surfaces its configuration through several dialogs and inline selectors, all persisted to `localStorage` on the client side. Server-side settings (MCP servers, API keys, git identity) are saved through REST API calls.

## Accessing Settings

The top bar provides quick access to:

- **Settings** (gear icon) -- opens the main Settings dialog for appearance, editor, integrations, and git identity.
- **Tools Settings** (wrench icon) -- opens the tool-permission dialog for allowed/disallowed tools and the bypass-permissions toggle.
- **Dark mode** (sun/moon icon) -- single-click toggle, no dialog required.

The **chat input status bar** exposes three inline selectors that change per-session behavior without opening a dialog: model, permission mode, and thinking mode.

## Model Selection

Choose which Claude model powers the conversation. The selector appears in the status bar below the chat input.

| Model | Description |
|---|---|
| **Claude Sonnet 4.6** | Fast and capable -- best balance of speed and quality |
| **Claude Opus 4.6** | Most powerful -- deep reasoning and complex tasks |
| **Claude Haiku 4.5** | Fastest -- quick tasks with lower cost |

The default is `claude-opus-4-6`. Changing the model takes effect on the next message; the current session continues with the newly selected model.

**Design rationale.** Exposing model selection inline rather than in a dialog lets users switch mid-conversation when they realize a task needs more (or less) capability.

## Thinking Mode

Controls how much internal reasoning Claude performs before responding.

| Mode | Description |
|---|---|
| **Standard** | No extended thinking |
| **Think** | Light reasoning before responding |
| **Think Hard** | Deeper analysis and reasoning |
| **Think Harder** | Thorough multi-step reasoning |
| **Ultrathink** | Maximum depth reasoning |

The selector sits next to the model picker in the chat input status bar. Higher thinking levels increase latency but improve quality on complex tasks.

## Max Output Tokens

The settings store defaults `maxOutputTokens` to **16,384** tokens. This value is sent to the Claude CLI and caps the length of each response. You can change it programmatically through the store; the UI does not currently expose a direct slider for it.

`maxTokens` (the context window limit) defaults to **200,000** and is used for the context-usage progress bar.

## Permission Modes

Permission mode determines how Claude handles tool invocations (file writes, shell commands, etc.). It appears as an inline selector in the chat input status bar.

| Mode | Label | Behavior |
|---|---|---|
| `bypassPermissions` | **Full Auto** | Auto-approve all tools. Equivalent to the CLI flag `--dangerously-skip-permissions`. |
| `acceptEdits` | **Accept Edits** | Auto-approve file edits only; other tools still prompt. |
| `plan` | **Plan Mode** | Plan only, no execution. Claude describes what it would do without running any tools. |
| `default` | **Ask Every Time** | Prompt for each tool use. Safest option. |

The default is `bypassPermissions` (Full Auto). When the chat enters plan mode via a server-side signal, the UI overrides the displayed label to "Plan Mode" regardless of the stored setting.

**Design rationale.** The four modes map directly to the Claude CLI's permission flags, so users familiar with the CLI see the same mental model. Full Auto is the default because the web UI is typically used in controlled environments where the operator has already accepted the risk.

## Tool Permission Patterns

The **Tools Settings** dialog (wrench icon) provides fine-grained control over which tools Claude may invoke.

### Allowed Tools

Tools listed here are auto-approved without prompting, even when permission mode is "Ask Every Time." Add a tool by typing its pattern or clicking one of the **quick-add** buttons:

```
Bash(git log:*)    Bash(git diff:*)    Bash(git status:*)
Bash(npm:*)        Bash(npx:*)
Write   Read   Edit   Glob   Grep   MultiEdit   Task
TodoWrite   TodoRead   WebFetch   WebSearch
```

### Disallowed Tools

Tools listed here are **never** allowed, even in Full Auto mode. Quick-add presets:

```
Bash(rm -rf:*)    Bash(sudo:*)    Bash(curl|wget:*)
```

### Pattern Syntax

| Pattern | Meaning |
|---|---|
| `Read` | Allow or block an entire tool |
| `Bash(git:*)` | Bash only for commands starting with `git` |
| `Bash(npm test:*)` | Bash for `npm test` commands |

Patterns are stored in `allowedTools` and `disallowedTools` arrays in `localStorage` and sent to the server with each chat message.

## MCP Server Management

The **MCP Servers** dialog (accessible from Settings > Integrations > MCP Servers) lets you register Model Context Protocol servers that extend Claude's tool set.

### Server Types

| Type | Transport | Required fields |
|---|---|---|
| **stdio** | Local process via stdin/stdout | `command`, optional `args` and `env` |
| **SSE** | Server-Sent Events over HTTP | `url`, optional `headers` |
| **HTTP** | Streamable HTTP | `url`, optional `headers` |

### Adding a Server

1. Click **Add Server**.
2. Enter a unique **Name** (e.g., `my-mcp-server`).
3. Select the **Type** (stdio, SSE, or HTTP).
4. For **stdio**: enter the command (e.g., `npx`), space-separated arguments (e.g., `-y @modelcontextprotocol/server-filesystem /home`), and optional environment variables as key-value pairs.
5. For **SSE** or **HTTP**: enter the URL and optional headers as key-value pairs.
6. Click **Add Server**.

Servers are persisted server-side via `POST /api/mcp/servers`. Existing servers can be expanded to inspect their configuration and deleted with the trash icon.

**Design rationale.** Environment variables and headers are exposed as dynamic key-value pair lists (with a "+" button to add more rows) so users never have to hand-edit JSON.

## API Keys

The **API Keys** dialog (Settings > Integrations > API Keys) creates bearer tokens for headless/programmatic access to the Viridian API.

### Key Format

All generated keys use the `ck_` prefix (e.g., `ck_a1b2c3d4...`), making them easy to identify and rotate.

### Creating a Key

1. Enter a descriptive name (e.g., "CI/CD").
2. Click **Create**.
3. **Copy the key immediately** -- it is shown only once. The dialog displays a green banner with a copy button.

### Revoking a Key

Click the trash icon next to any active key. Revoked keys are marked with a "Revoked" badge and remain visible for audit purposes.

The key list shows each key's prefix (`ck_...`), creation date, and last-used date.

**Design rationale.** The one-time-display pattern follows industry best practice -- the full key is never stored in plaintext on the server after creation, only a hashed version and the short prefix for identification.

## Editor Settings

The main Settings dialog contains an **Editor** section that controls the built-in code editor (powered by CodeMirror).

| Setting | Options | Default |
|---|---|---|
| **Font Size** | 11, 12, 13, 14, 16, 18 px | 13 px |
| **Tab Size** | 2, 4, 8 spaces | 2 |
| **Word Wrap** | on / off | off |
| **Line Numbers** | on / off | on |
| **Minimap** | on / off | on |

There is also a separate **Editor Font Size** under the Appearance section at the top of the dialog, which controls the chat/general UI font size (also defaulting to 13 px).

All editor settings are saved to `localStorage` and take effect immediately.

## Dark Mode

Dark mode is toggled via the sun/moon button in the top bar. It adds or removes the `dark` class on the `<html>` element, which activates Tailwind CSS dark-variant styles throughout the application.

The default is **dark mode on**. The preference persists in `localStorage`.

**Design rationale.** A single-click toggle in the top bar was chosen over burying dark mode inside the settings dialog because theme switching is a frequent action, especially when moving between environments with different ambient lighting.

## Language Selection (i18n)

The application supports three locales:

| Code | Language | Native label |
|---|---|---|
| `en` | English | English |
| `zh` | Chinese | 中文 |
| `ko` | Korean | 한국어 |

Locale is stored in `localStorage` under the key `locale` and defaults to `en`. The `setLocale()` function updates the active vue-i18n locale and sets `document.documentElement.lang` for accessibility. English is the fallback locale -- any missing translation keys fall back to English strings.

::: info
The locale infrastructure is in place (`client/src/i18n/index.ts` with `LOCALE_OPTIONS` and per-locale message files), but a visible language selector is not yet wired into the Settings dialog. To change the language today, set `localStorage.locale` to `en`, `zh`, or `ko` and reload.
:::

## Git User Configuration

The **Git Identity** section at the bottom of the Settings dialog lets you set the `user.name` and `user.email` that Git uses for commits in the current project.

- The fields are populated from the server on dialog open via `GET /api/git/user-config?cwd=<project>`.
- Saving writes the values back via `PUT /api/git/user-config`.
- The section is disabled until a project is opened ("Open a project to configure git identity").

**Design rationale.** Git identity is scoped to the project directory rather than being a global setting, because users may contribute to multiple repositories under different names and emails.

## Persistence Summary

| Setting category | Storage location |
|---|---|
| Model, permission mode, thinking mode, editor prefs, dark mode, tool lists | `localStorage` (client) |
| Locale | `localStorage` key `locale` (client) |
| MCP servers | Server-side via REST API |
| API keys | Server-side SQLite database |
| Git identity | Server-side `git config` in the project directory |
