# Multi-Provider Adapter System

## Goal
Add a provider abstraction layer so users can switch between AI CLI backends (Claude, Gemini, Codex, Aider, Kiro, Qwen Code, OpenCode) per session, with a global default and graceful feature degradation.

---

## Implementation Status

| # | Task | Status |
|---|------|--------|
| 1 | `server/src/providers/types.ts` — Core interfaces | DONE |
| 2 | `server/src/providers/registry.ts` — Provider registry | DONE |
| 3 | `server/src/providers/claude.ts` — Claude adapter | DONE |
| 4 | `server/src/providers/gemini.ts` — Gemini adapter | DONE |
| 5 | `server/src/providers/codex.ts` — Codex adapter | DONE |
| 6 | `server/src/providers/registry.test.ts` — Registry unit tests (24/24) | DONE |
| 7 | `server/src/routes/providers.ts` — REST API (GET /api/providers, /:id, /:id/status) | DONE |
| 8 | `client/src/types/provider.ts` — Client-side types | DONE |
| 9 | `client/src/stores/provider.ts` — Provider Pinia store | DONE |
| 10 | `client/src/stores/provider.test.ts` — Provider store unit tests (22/22) | DONE |
| 11 | `client/src/components/icons/CodexLogo.vue` — Codex logo | DONE |
| 12 | `client/src/components/icons/GeminiLogo.vue` — Gemini logo | DONE |
| 13 | `client/src/components/icons/AiderLogo.vue` — Aider logo | DONE |
| 14 | `client/src/components/icons/ClineLogo.vue` — Cline logo | DONE |
| 15 | `client/src/components/settings/ProviderSelector.vue` — Provider grid UI | DONE |
| 16 | `client/src/composables/useProviderLogo.ts` — Logo composable | DONE |
| 17 | `client/src/stores/settings.ts` — Dynamic models from provider store | DONE |
| 18 | `client/src/composables/useClaudeStream.ts` — Sends provider field via WS | DONE |
| 19 | `client/src/components/chat/ChatInput.vue` — Dynamic models + provider logo | DONE |
| 20 | `client/src/components/chat/MessageBubble.vue` — Dynamic provider logo/name | DONE |
| 21 | `client/src/components/chat/MessageList.vue` — Dynamic empty state | DONE |
| 22 | `client/src/components/settings/SettingsDialog.vue` — ProviderSelector integrated | DONE |
| 23 | `client/src/components/layout/TopBar.vue` — Provider-aware | DONE |
| 24 | `server/src/services/claude.ts` — Provider-agnostic session manager | DONE |
| 25 | `server/src/ws/chat.ts` — Accepts `provider` field, dynamic validation | DONE |
| 26 | `server/src/db/database.ts` — Provider column migrations | DONE |
| 27 | `server/src/services/autopilot-agent-runner.ts` — Provider per agent | DONE |
| 28 | `server/src/services/autopilot-run-manager.ts` — Provider context | DONE |
| 29 | `server/src/ws/autopilot.ts` — Provider in WS events | DONE |
| 30 | `client/src/stores/autopilot.ts` — Provider fields | DONE |
| 31 | `client/src/composables/autopilot/useAutopilotWebSocket.ts` — Provider support | DONE |
| 32 | `client/src/components/autopilot/AutopilotConfigDialog.vue` — Provider per agent | DONE |
| 33 | `server/src/providers/aider.ts` — Aider adapter | DONE |
| 34 | `server/src/providers/kiro.ts` — Kiro adapter | DONE |
| 35 | `client/src/components/icons/KiroLogo.vue` — Kiro logo | DONE |
| 36 | `server/src/providers/qwen.ts` — Qwen Code adapter | DONE |
| 37 | `client/src/components/icons/QwenLogo.vue` — Qwen logo | DONE |
| 38 | `server/src/providers/opencode.ts` — OpenCode adapter | DONE |
| 39 | `client/src/components/icons/OpenCodeLogo.vue` — OpenCode logo | DONE |

---

## Phase 1: Provider Abstraction Layer (Server) — COMPLETE

### 1.1 Define Core Interfaces — DONE

**File: `server/src/providers/types.ts`**

```typescript
// ─── Provider Identity ──────────────────────────────────────────────────
export type ProviderId = 'claude' | 'gemini' | 'codex' | 'aider' | 'cline';

export interface ProviderInfo {
  id: ProviderId;
  name: string;                    // "Claude", "Gemini", "Codex CLI", etc.
  icon: string;                    // SVG path or component name for the logo
  description: string;
  website: string;
  binaryName: string;              // "claude", "gemini", "codex", "aider", "cline"
  envVarForPath?: string;          // "CLAUDE_PATH", "GEMINI_PATH", etc.
}

// ─── Model & Capabilities ────────────────────────────────────────────────
export interface ProviderModel {
  id: string;                      // e.g. "claude-opus-4-6", "gemini-2.5-pro"
  label: string;                   // "Claude Opus 4.6", "Gemini 2.5 Pro"
  description: string;
  isDefault?: boolean;
}

export interface ProviderCapabilities {
  supportsThinking: boolean;       // Extended thinking / chain-of-thought
  supportsToolUse: boolean;        // File edits, bash, etc.
  supportsPermissionModes: boolean;// bypassPermissions, acceptEdits, plan, default
  supportsImages: boolean;         // Image input
  supportsResume: boolean;         // Session resume (--resume)
  supportsStreaming: boolean;      // Real-time streaming output
  supportsControlRequests: boolean;// Bidirectional stdin permission protocol
  supportsSubagents: boolean;      // Sub-agent / Task delegation
  supportsPlanMode: boolean;       // EnterPlanMode / ExitPlanMode
  supportedPermissionModes: string[];  // Which modes this provider supports
  customFeatures: string[];        // Provider-specific features (e.g., "steering" for Kiro)
}

// ─── Query Interface ─────────────────────────────────────────────────────
export interface ProviderQueryOptions { ... }

// ─── Provider Interface ──────────────────────────────────────────────────
export interface IProvider { ... }
export interface ParsedSessionMessage { ... }
export interface ProviderInfoDTO { ... }
```

### 1.2 Provider Registry — DONE

**File: `server/src/providers/registry.ts`**

- `registerProvider(provider: IProvider)` — called by each adapter on module load
- `getProvider(id: ProviderId): IProvider` — throws if not registered
- `getAvailableProviders(): IProvider[]` — returns only providers whose binary is found
- `getDefaultProvider(): IProvider` — returns Claude (fallback if not available: first available)
- `getProviderDTOs(): ProviderInfoDTO[]` — serializes for REST API

### 1.3 Claude Adapter — DONE

**File: `server/src/providers/claude.ts`**

- Wraps `claude-sdk.ts` (`findClaudeBinary()`, `claudeQuery()`)
- All capabilities = true
- Models: claude-sonnet-4-6 (default), claude-opus-4-6, claude-haiku-4-5
- Auto-registers on import

### 1.4 Gemini Adapter — DONE

**File: `server/src/providers/gemini.ts`**

- Spawns `gemini -p "prompt" --output-format json`
- Normalizes 5 JSON output patterns to SDKMessage
- Capabilities: no thinking, no control requests, no resume, no subagents
- Models: gemini-2.5-pro (default), gemini-2.5-flash, gemini-2.0-flash
- Auto-registers on import

### 1.5 Codex Adapter — DONE

**File: `server/src/providers/codex.ts`**

- Spawns `codex exec --json [permission-flags] [--model X] [resume SESSION_ID] "prompt"`
- JSONL event normalization:
  - `thread.started` → `system` (captures `thread_id` as sessionId for resume)
  - `item.completed` + `agent_message` → `text_delta`
  - `item.completed` + `reasoning` → `thinking_start/delta/end`
  - `item.completed` + `command_execution` → `tool_use` (Bash)
  - `item.completed` + `file_change` → `tool_use` (Edit)
  - `item.completed` + `mcp_tool_call` → `tool_use`
  - `item.completed` + `web_search` → `tool_use` (WebSearch)
  - `turn.completed` → `message_start/delta` (token usage)
  - `turn.failed` / `error` → `error`
- Permission mapping: `bypassPermissions` → `--full-auto`, `default` → `--ask-for-approval on-request`
- Capabilities: resume=yes, images=yes, permissionModes=yes, controlRequests=no, thinking=no, subagents=no, planMode=no
- Models: gpt-5.3-codex (default), gpt-5.3-codex-spark, gpt-5.2-codex, gpt-5.2, gpt-5.1-codex, gpt-5
- Auto-registers on import

### 1.6 Aider Adapter — DONE

**File: `server/src/providers/aider.ts`**

- Spawns `aider --message "prompt" --yes-always --no-auto-commits --no-pretty --no-suggest-shell-commands`
- Plain text output (no JSON mode) — streams stdout as `text_delta` events
- Post-process: extracts SEARCH/REPLACE edit blocks from full output → `tool_use` (Edit)
- Session resume via `--restore-chat-history` + `--chat-history-file`
- Capabilities: resume=yes, streaming=yes, toolUse=yes, images=no, controlRequests=no, thinking=no, subagents=no, planMode=no
- Models: claude-sonnet-4-6 (default), claude-opus-4-6, gpt-5.3, gpt-5.2, gemini-2.5-pro, deepseek-r1
- Auto-registers on import

### 1.8 Kiro Adapter — DONE

**File: `server/src/providers/kiro.ts`**

- Spawns `kiro-cli chat --no-interactive [--trust-all-tools | --trust-tools ...] "prompt"`
- Plain text output (no JSON mode) — streams stdout as `text_delta` events
- Session resume via `--resume` flag
- Permission mapping: `bypassPermissions` → `--trust-all-tools`, `default` → `--trust-tools read,glob,grep,...`
- Capabilities: resume=yes, streaming=yes, toolUse=yes, thinking=yes, subagents=yes, images=no, controlRequests=no, planMode=no
- Models: claude-sonnet-4-6 (default), claude-opus-4-6, claude-haiku-4-5 (all via Bedrock)
- Custom features: steering, custom_agents, knowledge_base, mcp, tangent_mode
- Auto-registers on import

### 1.9 Qwen Code Adapter — DONE

**File: `server/src/providers/qwen.ts`**

- Spawns `qwen -p "prompt" --output-format stream-json [--model X] [--continue]`
- Stream-JSON output — normalizes Gemini-style events (based on Gemini CLI codebase)
- Session resume via `--continue` flag
- Capabilities: resume=yes, streaming=yes, toolUse=yes, subagents=yes, images=no, controlRequests=no, thinking=no, planMode=no
- Models: qwen3-coder-plus (default), qwen3.5-plus, qwen3-coder
- Custom features: skills, subagents, 256k_context, multi_model
- Auto-registers on import

### 1.10 OpenCode Adapter — DONE

**File: `server/src/providers/opencode.ts`**

- Spawns `opencode run --format json [--model provider/model] [--session ID] "prompt"`
- Newline-delimited JSON events with structured types:
  - `message.part.updated` + `text` → `text_delta`
  - `message.part.updated` + `thinking` → `thinking_start/delta/end`
  - `message.part.updated` + `tool-invocation` → `tool_use`
  - `message.completed` → `message_start/delta` (token usage)
  - `session.created` / `session.resumed` → `system` (sessionId)
- Session resume via `--session <id>` or `--continue`
- Model format: `provider/model` (e.g., `anthropic/claude-sonnet-4-6`)
- Capabilities: resume=yes, streaming=yes, toolUse=yes, thinking=yes, permissionModes=yes, images=no, subagents=no, planMode=no
- Custom features: multi_provider, lsp_integration, server_mode, session_sharing
- Auto-registers on import

### 1.11 Unit Tests — DONE

- `server/src/providers/registry.test.ts` — 24 tests covering register, getProvider, getAllProviders, getAvailableProviders, getDefaultProvider, getProviderDTOs
- `client/src/stores/provider.test.ts` — 22 tests covering defaults, activeProviderId, activeProvider, activeModels, defaultModel, availableProviders, fetchProviders, setDefaultProvider, isValidModel

---

## Phase 2: Session Layer Refactor (Server) — COMPLETE

### 2.1 Provider-Agnostic Session Manager — DONE

**Modified: `server/src/services/claude.ts`**

- `createSession()` accepts `providerId` parameter
- `sendMessage()` uses `provider.query()` instead of hardcoded `claudeQuery()`
- `respondToPermission()` uses `provider.buildControlResponse()`
- `shouldAutoApprove()` checks `provider.capabilities.supportsControlRequests`

### 2.2 WebSocket Handler — DONE

**Modified: `server/src/ws/chat.ts`**

- Accepts `provider` field in chat messages
- Dynamic model validation from provider registry
- Passes provider to `createSession()`

### 2.3 Database Migration — DONE

**Modified: `server/src/db/database.ts`**

- `sessions.provider` column
- `autopilot_runs.agent_a_provider`, `agent_b_provider` columns
- `autopilot_profiles.provider` column
- `autopilot_configs.agent_a_provider`, `agent_b_provider` columns

### 2.4 REST API — DONE

**File: `server/src/routes/providers.ts`**

- `GET /api/providers` — List all providers with availability
- `GET /api/providers/:id` — Single provider details
- `GET /api/providers/:id/status` — Binary availability check

---

## Phase 3: Client-Side Provider Support — COMPLETE

### 3.1 Provider Store — DONE
### 3.2 Settings Store Updates — DONE
### 3.3 Chat Store & Stream Updates — DONE
### 3.4 UI Component Updates — DONE

- ProviderSelector.vue — grid with logos, availability dots
- MessageBubble.vue — dynamic provider logo/name
- ChatInput.vue — dynamic model selector from provider
- MessageList.vue — dynamic empty state
- SettingsDialog.vue — integrated ProviderSelector
- TopBar.vue — provider-aware
- Logo components: GeminiLogo, CodexLogo, AiderLogo, ClineLogo

### 3.5 Autopilot Provider Support — DONE

- AutopilotConfigDialog.vue — provider per agent
- autopilot-agent-runner.ts — uses provider.query()
- autopilot-run-manager.ts — provider context
- autopilot.ts store & WS — provider fields

---

## Phase 4: Graceful Degradation — DONE (built into capabilities system)

### Feature Availability Matrix

| Feature               | Claude | Gemini | Codex | Aider | Kiro  | Qwen  | OpenCode |
|-----------------------|--------|--------|-------|-------|-------|-------|----------|
| Text streaming        | Yes    | Yes    | Yes   | Yes   | Yes   | Yes   | Yes      |
| Extended thinking     | Yes    | No     | No    | No    | Yes‡  | No    | Yes      |
| Tool use (file ops)   | Yes    | MCP    | Yes   | Yes   | Yes   | Yes   | Yes      |
| Permission modes      | 4      | 1*     | 2     | 1*    | 2     | 1*    | 2        |
| Session resume        | Yes    | No     | Yes   | Yes†  | Yes   | Yes   | Yes      |
| Control requests      | Yes    | No     | No    | No    | No    | No    | No       |
| Image input           | Yes    | Yes    | Yes   | No    | No    | No    | No       |
| Sub-agents            | Yes    | No     | No    | No    | Yes   | Yes   | No       |
| Plan mode             | Yes    | No     | No    | No    | No    | No    | No       |

*\* = always runs in bypass/auto mode*
*† = via chat history file, not native session ID*
*‡ = experimental thinking tool, not native protocol*

---

## Remaining Work

### Graph Runner
- Provider per graph node (currently hardcoded to Claude)

---

## File Structure

```
server/src/
├── providers/
│   ├── types.ts           # IProvider, ProviderCapabilities, etc.
│   ├── registry.ts        # Provider registry singleton
│   ├── registry.test.ts   # 24 unit tests
│   ├── claude.ts          # Claude adapter (wraps claude-sdk.ts)
│   ├── gemini.ts          # Gemini adapter
│   ├── codex.ts           # Codex adapter
│   ├── aider.ts           # Aider adapter
│   ├── kiro.ts            # Kiro adapter (AWS Bedrock)
│   ├── qwen.ts            # Qwen Code adapter (Alibaba)
│   └── opencode.ts        # OpenCode adapter (multi-provider)
├── services/
│   ├── claude-sdk.ts      # UNCHANGED — low-level Claude CLI spawn
│   └── claude.ts          # Provider-agnostic session manager
├── routes/
│   └── providers.ts       # GET /api/providers endpoints
└── ws/
    └── chat.ts            # Dynamic model/provider validation

client/src/
├── stores/
│   ├── provider.ts        # Provider state management
│   ├── provider.test.ts   # 22 unit tests
│   └── settings.ts        # Dynamic model options from provider
├── composables/
│   ├── useClaudeStream.ts # Sends provider field via WS
│   └── useProviderLogo.ts # Logo component resolver
├── components/
│   ├── icons/
│   │   ├── GeminiLogo.vue
│   │   ├── CodexLogo.vue
│   │   ├── AiderLogo.vue
│   │   ├── ClineLogo.vue
│   │   ├── KiroLogo.vue
│   │   ├── QwenLogo.vue
│   │   └── OpenCodeLogo.vue
│   └── settings/
│       └── ProviderSelector.vue  # Provider switching UI
└── types/
    └── provider.ts        # Client-side provider types
```
