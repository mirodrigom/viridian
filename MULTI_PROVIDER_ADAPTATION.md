# Multi-Provider Adaptation for Viridian

## Summary

Viridian currently hardcodes Claude-specific features (thinking modes, permission modes, etc.) but has a provider system that supports multiple AI providers including Kiro CLI. This document outlines what needs to be adapted.

## Kiro CLI Capabilities (from documentation)

### Models
- Kiro uses AWS Bedrock models (Claude via Bedrock)
- Model selection via `kiro-cli settings chat.defaultModel`
- Available models: claude-sonnet-4-6, claude-opus-4-6, claude-haiku-4-5

### Modes & Features
1. **Plan Mode**: Built-in planning agent
   - Toggle: `/plan` command or `Shift+Tab`
   - Read-only mode for planning before execution
   - Different from Claude's "plan" permission mode

2. **Thinking**: Experimental feature
   - Enable: `kiro-cli settings chat.enableThinking true`
   - Single on/off toggle (not multiple levels like Claude)
   - No "think hard", "think harder", "ultrathink" modes

3. **Context Management**:
   - `/context` command for managing context files
   - Hooks system for automatic context injection
   - Knowledge base (experimental)
   - Context usage indicator setting

4. **Session Storage**:
   - Sessions stored in `~/.kiro/chat/` (per-directory)
   - Different from Claude's `~/.claude/` structure

### Response Format Differences
- Kiro outputs plain text in non-interactive mode
- No JSON output for chat
- Trust modes via CLI flags (`--trust-all-tools`, `--trust-tools`)
- No stdin-based control protocol

## Current Viridian Implementation

### Provider System (Already Exists)
- `client/src/stores/provider.ts` - Provider store with capabilities
- `client/src/types/provider.ts` - Provider types
- `server/src/providers/` - Provider adapters (claude, gemini, kiro, etc.)
- Each provider declares capabilities via `ProviderCapabilities` interface

### Hardcoded Claude Features
1. **Thinking Modes** (`client/src/stores/settings.ts`):
   ```typescript
   type ThinkingMode = 'standard' | 'think' | 'think_hard' | 'think_harder' | 'ultrathink';
   ```
   - Shown in UI for all providers
   - Kiro only has on/off thinking

2. **Permission Modes** (`client/src/stores/settings.ts`):
   ```typescript
   type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions';
   ```
   - "plan" mode is Claude-specific
   - Kiro has different trust model

3. **Session Detection** (`server/src/ws/sessions.ts`):
   - Looks for Claude sessions in `~/.claude/`
   - Doesn't detect Kiro sessions in `~/.kiro/chat/`

## Changes Needed

### 1. Provider Store - Add Capability Helpers ✅ (DONE)

File: `client/src/stores/provider.ts`

Added capability helper computed properties and exported them.

### 2. Fix Session Detection for Multiple Providers

**Problem**: `server/src/ws/sessions.ts` only watches `~/.claude/projects` directory.

**Solution**: Watch all provider session directories.

File: `server/src/ws/sessions.ts`

```typescript
import { getAllProviders } from '../providers/registry.js';

// Get all provider session directories
const providerDirs: string[] = [];
for (const provider of getAllProviders()) {
  const dir = provider.getSessionDir();
  if (dir && existsSync(dir)) {
    providerDirs.push(dir);
  }
}

// Watch all provider directories
const watchers = providerDirs.map(dir => {
  const watcher = watch(dir, {
    ignoreInitial: true,
    depth: 1,
    usePolling: false,
  });
  
  watcher.on('add', (path) => broadcast('session_added', { path, dir }));
  watcher.on('change', (path) => broadcast('session_changed', { path, dir }));
  watcher.on('unlink', (path) => broadcast('session_deleted', { path, dir }));
  
  return watcher;
});
```

**Alternative (Simpler)**: Add Kiro directory to existing watcher:

```typescript
const CLAUDE_DIR = join(getHomeDir(), '.claude', 'projects');
const KIRO_DIR = join(getHomeDir(), '.kiro', 'chat');

// Watch both directories
const dirs = [CLAUDE_DIR];
if (existsSync(KIRO_DIR)) {
  dirs.push(KIRO_DIR);
}

const watcher = watch(dirs, {
  ignoreInitial: true,
  depth: 1,
  usePolling: false,
});
```

### 3. Conditionally Show Thinking Mode UI

File: `client/src/components/chat/ChatInput.vue` (line ~873)

```vue
<!-- Thinking mode (only for providers that support it) -->
<Select v-if="providerStore.supportsThinking" :model-value="settings.thinkingMode" ...>
```

### 3. Adapt Permission Mode Options

File: `client/src/components/chat/ChatInput.vue`

```typescript
// Compute available permission modes based on provider
const availablePermissionModes = computed(() => {
  const supported = providerStore.activeCapabilities.supportedPermissionModes;
  return PERMISSION_OPTIONS.filter(p => supported.includes(p.value));
});
```

Then in template:
```vue
<SelectItem v-for="p in availablePermissionModes" :key="p.value" :value="p.value">
```

### 4. Fix Kiro Session Detection

File: `server/src/providers/kiro.ts` (line ~280)

Already has `getSessionDir()` method that returns `~/.kiro/chat`, but sessions WebSocket handler needs to use it.

File: `server/src/ws/sessions.ts`

Add provider-aware session detection:
```typescript
import { getProvider } from '../providers/registry.js';

// In setupSessionsWs, detect sessions from active provider
const provider = getProvider(activeProviderId);
const sessionDir = provider.getSessionDir();
```

### 5. Provider-Specific Response Handling

File: `client/src/composables/useClaudeStream.ts`

Add provider context to message formatting:
```typescript
// Check provider capabilities before showing thinking UI
if (providerStore.supportsThinking) {
  on('thinking_start', ...);
  on('thinking_delta', ...);
}
```

### 6. Update Kiro Provider Metadata

File: `server/src/providers/kiro.ts` (line ~60)

```typescript
const capabilities: ProviderCapabilities = {
  supportsThinking: true,          // Has experimental thinking tool
  supportsToolUse: true,
  supportsPermissionModes: true,   // --trust-all-tools vs --trust-tools
  supportsImages: false,           // No --image flag
  supportsResume: true,
  supportsStreaming: true,
  supportsControlRequests: false,  // Trust is flag-based, not stdin
  supportsSubagents: true,
  supportsPlanMode: false,         // Has /plan agent, not permission mode
  supportedPermissionModes: ['bypassPermissions', 'default'], // Only these two
  customFeatures: ['steering', 'custom_agents', 'knowledge_base', 'mcp', 'tangent_mode'],
};
```

### 7. Add Provider Indicator in UI

File: `client/src/components/chat/MessageBubble.vue`

Show which provider generated each message (already has provider field from stream_start event).

### 8. Session Sidebar - Multi-Provider Sessions

File: `client/src/components/chat/SessionSidebar.vue`

- Group sessions by provider
- Show provider icon next to each session
- Filter by provider

## Implementation Priority

1. ✅ **Provider capability helpers** (DONE) - Foundation for everything else
2. **Conditional UI elements** - Hide unsupported features
3. **Kiro session detection** - Fix sidebar not showing Kiro sessions
4. **Permission mode filtering** - Show only supported modes
5. **Provider-specific response handling** - Handle format differences
6. **Session grouping** - Better multi-provider UX

## Testing Checklist

- [ ] Switch between Claude and Kiro providers
- [ ] Verify thinking mode UI only shows for Claude
- [ ] Verify permission modes adapt to provider
- [ ] Verify Kiro sessions appear in sidebar
- [ ] Verify messages show correct provider icon
- [ ] Verify session resume works for both providers
- [ ] Test with provider that doesn't support images
- [ ] Test with provider that doesn't support subagents

## Notes

- Kiro's "plan mode" (`/plan` command) is different from Claude's "plan" permission mode
- Kiro thinking is binary (on/off), not multi-level like Claude
- Response format differences are already handled by provider adapters
- Session storage location varies by provider (use `getSessionDir()`)
