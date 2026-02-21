# Multi-Provider Adapter System

## Goal
Add a provider abstraction layer so users can switch between AI CLI backends (Claude, Gemini, Codex, Aider, Cline) per session, with a global default and graceful feature degradation.

---

## Phase 1: Provider Abstraction Layer (Server)

### 1.1 Define Core Interfaces

**New file: `server/src/providers/types.ts`**

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
// Reuse existing SDKMessage as the universal event format.
// Each provider adapter normalizes its native events → SDKMessage.

export interface ProviderQueryOptions {
  prompt: string;
  cwd: string;
  model?: string;
  permissionMode?: string;
  maxOutputTokens?: number;
  tools?: string[];
  allowedTools?: string[];
  disallowedTools?: string[];
  images?: { name: string; dataUrl: string }[];
  sessionId?: string;              // Provider-specific session ID for resume
  abortSignal?: AbortSignal;
  onStdinReady?: (write: (data: string) => void) => void;
  noTools?: boolean;
  disableSlashCommands?: boolean;
  systemPrompt?: string;
  appendSystemPrompt?: string;
  agents?: Record<string, {
    description: string;
    prompt: string;
    tools?: string[];
    disallowedTools?: string[];
    model?: string;
    permissionMode?: string;
    maxTurns?: number;
  }>;
}

// ─── Provider Interface ──────────────────────────────────────────────────
export interface IProvider {
  readonly info: ProviderInfo;
  readonly models: ProviderModel[];
  readonly capabilities: ProviderCapabilities;

  /** Check if the CLI binary is available. */
  isAvailable(): boolean;

  /** Find and return the binary path, or throw. */
  findBinary(): string;

  /** Execute a query — returns the same SDKMessage stream all consumers expect. */
  query(options: ProviderQueryOptions): AsyncGenerator<SDKMessage, void, undefined>;

  /** Build a control_response payload for stdin (for providers that support it). */
  buildControlResponse(requestId: string, approved: boolean, extra?: {
    updatedInput?: unknown;
    message?: string;
  }): string | null;  // null if provider doesn't support control responses

  /** Get the session directory where this provider stores history files. */
  getSessionDir(): string | null;   // e.g. ~/.claude/projects/, null if N/A

  /** Parse a session history file into normalized messages (for sidebar/load). */
  parseSessionFile?(filePath: string): Promise<ParsedSessionMessage[]>;
}

export interface ParsedSessionMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: number;
  toolUse?: { tool: string; input: Record<string, unknown> };
  thinking?: string;
}
```

### 1.2 Provider Registry

**New file: `server/src/providers/registry.ts`**

```typescript
// Singleton registry — providers register at import time.
// Exposes: getProvider(id), getAvailableProviders(), getDefaultProvider()
```

- `registerProvider(provider: IProvider)` — called by each adapter on module load
- `getProvider(id: ProviderId): IProvider` — throws if not registered
- `getAvailableProviders(): IProvider[]` — returns only providers whose binary is found
- `getDefaultProvider(): IProvider` — returns Claude (fallback if not available: first available)
- **REST endpoint**: `GET /api/providers` — returns `{ id, name, icon, models, capabilities, available }[]`

### 1.3 Claude Adapter (Refactor, not rewrite)

**New file: `server/src/providers/claude.ts`**

- **Implements `IProvider`** by wrapping the existing `claude-sdk.ts` functions
- `claude-sdk.ts` remains unchanged — it's the low-level spawn logic
- `claude.ts` (the adapter) delegates to `claudeQuery()` and maps to the interface
- `findBinary()` → delegates to existing `findClaudeBinary()`
- `query()` → delegates to existing `claudeQuery()`
- `buildControlResponse()` → extracts the JSON building logic from `claude.ts:respondToPermission()`
- `capabilities`: all true (supportsThinking, supportsToolUse, supportsControlRequests, etc.)
- Auto-registers in registry on import

### 1.4 Gemini Adapter

**New file: `server/src/providers/gemini.ts`**

- `findBinary()` → looks for `gemini` in PATH, or `GEMINI_PATH` env var
- `query()` → spawns `gemini -p "<prompt>" --output-format json` and normalizes output to SDKMessage
- Gemini JSON events → SDKMessage mapping:
  - Text output → `text_delta`
  - Tool calls → `tool_use` (if Gemini supports MCP tools)
  - Errors → `error`
  - Completion → `result`
- `capabilities`:
  - `supportsThinking: false` (no extended thinking protocol)
  - `supportsToolUse: true` (via MCP)
  - `supportsControlRequests: false` (no permission protocol — always auto-approve)
  - `supportsResume: false` (no --resume equivalent)
  - `supportsImages: true`
  - `supportsPlanMode: false`
  - `supportsSubagents: false`

### 1.5 Future Adapters (Phase 3+)

Documented interface but not implemented yet:
- `server/src/providers/codex.ts` — OpenAI Codex CLI
- `server/src/providers/aider.ts` — Aider
- `server/src/providers/cline.ts` — Cline CLI 2.0

---

## Phase 2: Session Layer Refactor (Server)

### 2.1 Make Session Manager Provider-Agnostic

**Modify: `server/src/services/claude.ts` → rename to `server/src/services/session-manager.ts`**

Keep the old filename as a re-export for backward compatibility during migration.

Key changes to `ClaudeSession` → `ProviderSession`:

```typescript
interface ProviderSession {
  id: string;
  providerId: ProviderId;           // NEW: which provider this session uses
  providerSessionId?: string;       // renamed from claudeSessionId
  process: ChildProcess | null;
  cwd: string;
  emitter: EventEmitter;
  abortController?: AbortController;
  usage: { inputTokens: number; outputTokens: number };
  isStreaming: boolean;
  accumulatedText: string;
  stdinWrite?: (data: string) => void;
  pendingQuestionBuffer: { event: string; data: unknown }[] | null;
  lastActivity: number;
  userPermissionMode?: string;
  streamGeneration: number;
}
```

Changes to `sendMessage()`:
```typescript
// Before:
const stream = claudeQuery({ ... });

// After:
const provider = getProvider(session.providerId);
const stream = provider.query({ ... });
```

Changes to `respondToPermission()`:
```typescript
// Before: hardcoded JSON structure for control_response
// After:
const provider = getProvider(session.providerId);
const response = provider.buildControlResponse(requestId, approved, { updatedInput });
if (response && session.stdinWrite) {
  session.stdinWrite(response);
}
```

Changes to `shouldAutoApprove()`:
```typescript
// If provider doesn't support control requests, always auto-approve
const provider = getProvider(session.providerId);
if (!provider.capabilities.supportsControlRequests) return true;
// ... rest of existing logic
```

### 2.2 Update WebSocket Handler

**Modify: `server/src/ws/chat.ts`**

- Remove hardcoded `VALID_MODELS` → fetch from provider registry dynamically
- Remove hardcoded `VALID_PERMISSION_MODES` → fetch from provider capabilities
- Accept `provider` field in `chat` message type:
  ```typescript
  { type: 'chat', prompt, provider: 'gemini', model: 'gemini-2.5-pro', ... }
  ```
- Pass `provider` to `createSession()`:
  ```typescript
  session = createSession(projectDir, claudeSessionId, provider || 'claude');
  ```
- Model validation becomes dynamic:
  ```typescript
  const providerInstance = getProvider(provider);
  const validModels = providerInstance.models.map(m => m.id);
  if (model && !validModels.includes(model)) { /* error */ }
  ```

### 2.3 Database Migration

**Modify: `server/src/db/database.ts`**

Add migration (SQLite ALTER TABLE):

```sql
-- Sessions table
ALTER TABLE sessions ADD COLUMN provider TEXT DEFAULT 'claude';

-- Autopilot runs
ALTER TABLE autopilot_runs ADD COLUMN agent_a_provider TEXT DEFAULT 'claude';
ALTER TABLE autopilot_runs ADD COLUMN agent_b_provider TEXT DEFAULT 'claude';
-- Rename columns (SQLite doesn't support RENAME COLUMN in older versions,
-- so we add new columns and keep old ones for backward compat)
ALTER TABLE autopilot_runs ADD COLUMN agent_a_provider_session_id TEXT;
ALTER TABLE autopilot_runs ADD COLUMN agent_b_provider_session_id TEXT;

-- Autopilot profiles
ALTER TABLE autopilot_profiles ADD COLUMN provider TEXT DEFAULT 'claude';

-- Autopilot configs
ALTER TABLE autopilot_configs ADD COLUMN agent_a_provider TEXT DEFAULT 'claude';
ALTER TABLE autopilot_configs ADD COLUMN agent_b_provider TEXT DEFAULT 'claude';

-- Graph runs
ALTER TABLE graph_runs ADD COLUMN provider TEXT DEFAULT 'claude';

-- Session cache
ALTER TABLE session_cache ADD COLUMN provider TEXT DEFAULT 'claude';
```

### 2.4 REST API for Providers

**New file: `server/src/routes/providers.ts`**

```
GET /api/providers
  → [{ id, name, icon, description, models, capabilities, available }]

GET /api/providers/:id
  → { id, name, icon, description, models, capabilities, available }

GET /api/providers/:id/status
  → { available, binaryPath?, version?, error? }
```

---

## Phase 3: Client-Side Provider Support

### 3.1 Provider Store

**New file: `client/src/stores/provider.ts`** (Pinia store)

```typescript
// State:
//   providers: ProviderInfo[]         — fetched from GET /api/providers on init
//   defaultProvider: ProviderId       — persisted to localStorage
//   sessionProvider: ProviderId|null  — per-session override (null = use default)
//
// Getters:
//   activeProvider: computed           — sessionProvider || defaultProvider
//   activeModels: computed             — models for activeProvider
//   activeCapabilities: computed       — capabilities for activeProvider
//   availableProviders: computed       — only providers with available=true
//
// Actions:
//   fetchProviders()                   — GET /api/providers
//   setDefaultProvider(id)             — saves to localStorage, shows toast warning
//   setSessionProvider(id)             — sets for current session only
```

### 3.2 Settings Store Updates

**Modify: `client/src/stores/settings.ts`**

- Remove hardcoded `ClaudeModel` type → dynamic from provider store
- Remove hardcoded `MODEL_OPTIONS` → computed from `providerStore.activeModels`
- Keep `PERMISSION_OPTIONS` but filter by `providerStore.activeCapabilities.supportedPermissionModes`
- Keep `THINKING_OPTIONS` but conditionally hide if `!capabilities.supportsThinking`
- Add `defaultProvider: ProviderId` to saved settings
- Type `model` as `string` instead of `ClaudeModel` union

### 3.3 Chat Store & Stream Updates

**Modify: `client/src/stores/chat.ts`**

- Rename `claudeSessionId` → `providerSessionId` (keep alias for backward compat)
- Add `provider: ProviderId` field

**Modify: `client/src/composables/useClaudeStream.ts` → rename to `useProviderStream.ts`**

- Keep old file as re-export
- `sendMessage()` includes `provider` and `model` from provider store:
  ```typescript
  const payload = {
    type: 'chat',
    provider: providerStore.activeProvider,
    model: settings.model,
    ...
  };
  ```
- Conditional handling for provider-specific events (e.g., skip thinking events if provider doesn't support it)

### 3.4 UI Component Updates

**Modify: `client/src/components/chat/MessageBubble.vue`**

- Replace hardcoded `ClaudeLogo` + "Claude" text with dynamic provider info:
  ```vue
  <component :is="providerLogo" />  <!-- dynamic component based on provider -->
  <p>{{ providerName }}</p>
  ```
- Use provider store for logo/name

**Modify: `client/src/components/chat/ChatInput.vue`**

- Model selector reads from `providerStore.activeModels` instead of hardcoded `MODEL_OPTIONS`
- Add provider selector (compact dropdown/icon next to model selector)
- Placeholder text: `'Ask ${providerStore.activeProviderName} to help with your code...'`
- Hide thinking mode selector when `!capabilities.supportsThinking`

**Modify: `client/src/components/chat/MessageList.vue`**

- Dynamic logo in empty state based on active provider
- Dynamic welcome text

**New file: `client/src/components/settings/ProviderSelector.vue`**

- Grid of available providers with logos
- Current default highlighted
- Click to change default → toast: "Default provider changed to X. This applies to new sessions only."
- Show availability status (green dot if binary found, red if missing)
- Link to installation instructions for unavailable providers

**Modify: `client/src/components/settings/SettingsDialog.vue`**

- Add "Provider" section at the top with `ProviderSelector`
- Model selector becomes dynamic based on selected provider

**New file: `client/src/components/icons/` — Provider logos**

- `GeminiLogo.vue`
- `CodexLogo.vue`
- `AiderLogo.vue`
- `ClineLogo.vue`
- (ClaudeLogo.vue already exists)

### 3.5 Autopilot Provider Support

**Modify: `client/src/components/autopilot/AutopilotConfigDialog.vue`**

- Add provider selector per agent (Agent A provider, Agent B provider)
- Model dropdown filters based on selected provider
- Warning if mixing providers: "Agents use different providers — responses may vary in format"

**Modify: `server/src/services/autopilot-agent-runner.ts`**

- Accept provider from config:
  ```typescript
  const providerId = agent === 'a' ? ctx.agentAProvider : ctx.agentBProvider;
  const provider = getProvider(providerId);
  for await (const msg of provider.query({ ... })) { ... }
  ```

---

## Phase 4: Graceful Degradation

### Feature Availability Matrix

| Feature               | Claude | Gemini | Codex | Aider | Cline |
|-----------------------|--------|--------|-------|-------|-------|
| Text streaming        | Yes    | Yes    | Yes   | Yes   | Yes   |
| Extended thinking     | Yes    | No     | No    | No    | No    |
| Tool use (file ops)   | Yes    | MCP    | Yes   | Yes   | Yes   |
| Permission modes      | 4      | 1*     | 1*    | 0*    | 1*    |
| Session resume        | Yes    | No     | TBD   | No    | TBD   |
| Control requests      | Yes    | No     | No    | No    | No    |
| Image input           | Yes    | Yes    | Yes   | No    | Yes   |
| Sub-agents            | Yes    | No     | No    | No    | No    |
| Plan mode             | Yes    | No     | No    | No    | No    |

*\* = always runs in bypass/auto mode*

### UI Degradation Rules

1. **Thinking toggle**: Hidden when `!supportsThinking`
2. **Permission mode selector**: Hidden when `!supportsPermissionModes`, default to bypass
3. **Plan mode**: Tool events for EnterPlanMode/ExitPlanMode silently ignored
4. **Control requests**: If provider doesn't support them, all tools auto-approve
5. **Session resume**: If `!supportsResume`, every chat starts fresh (no --resume)
6. **Sub-agent bubbles**: If no sub-agents, never show nested tool views
7. **Image attach**: Hidden when `!supportsImages`
8. **Tool sidebar**: Shows whatever tools the provider reports, no hardcoded list

---

## File Structure Summary

```
server/src/
├── providers/
│   ├── types.ts           # IProvider, ProviderCapabilities, etc.
│   ├── registry.ts        # Provider registry singleton
│   ├── claude.ts          # Claude adapter (wraps claude-sdk.ts)
│   ├── gemini.ts          # Gemini adapter
│   ├── codex.ts           # Codex adapter (stub)
│   ├── aider.ts           # Aider adapter (stub)
│   └── cline.ts           # Cline adapter (stub)
├── services/
│   ├── claude-sdk.ts      # UNCHANGED — low-level Claude CLI spawn
│   ├── claude.ts          # Re-export from session-manager.ts (backward compat)
│   └── session-manager.ts # Refactored provider-agnostic session manager
├── routes/
│   └── providers.ts       # GET /api/providers endpoints
└── ws/
    └── chat.ts            # Updated: dynamic model/provider validation

client/src/
├── stores/
│   ├── provider.ts        # NEW: provider state management
│   └── settings.ts        # Updated: dynamic model options
├── composables/
│   ├── useProviderStream.ts  # Renamed from useClaudeStream.ts
│   └── useClaudeStream.ts    # Re-export (backward compat)
├── components/
│   ├── icons/
│   │   ├── GeminiLogo.vue
│   │   ├── CodexLogo.vue
│   │   └── ...
│   └── settings/
│       └── ProviderSelector.vue  # Provider switching UI
└── types/
    └── provider.ts        # Client-side provider types (mirrors server types)
```

---

## Implementation Order

1. **`server/src/providers/types.ts`** — Define all interfaces
2. **`server/src/providers/registry.ts`** — Provider registry
3. **`server/src/providers/claude.ts`** — Claude adapter (wraps existing code)
4. **`server/src/services/session-manager.ts`** — Refactor from claude.ts
5. **`server/src/ws/chat.ts`** — Accept `provider` field, dynamic validation
6. **`server/src/routes/providers.ts`** — REST API
7. **`server/src/db/database.ts`** — Migration
8. **`client/src/types/provider.ts`** — Client types
9. **`client/src/stores/provider.ts`** — Provider store
10. **`client/src/stores/settings.ts`** — Remove hardcoded models
11. **`client/src/composables/useProviderStream.ts`** — Rename + provider field
12. **`client/src/components/settings/ProviderSelector.vue`** — UI
13. **UI updates** — MessageBubble, ChatInput, MessageList, etc.
14. **`server/src/providers/gemini.ts`** — Gemini adapter
15. **Autopilot updates** — agent-runner + config dialog
16. **Graph runner updates** — provider per node

---

## Default Provider UX

- Settings dialog has a prominent "Default Provider" section (top of dialog)
- Changing default shows toast: "Default provider set to Gemini. New sessions will use Gemini."
- Active sessions keep their current provider (no mid-session switching)
- Per-session override via provider icon in ChatInput (next to model selector)
- URL doesn't encode provider (it's session metadata, not routing)
