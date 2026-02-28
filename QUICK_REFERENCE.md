# Quick Reference: Kiro vs Claude in Viridian

## Models

### Kiro
- claude-sonnet-4-6 (via Bedrock)
- claude-opus-4-6 (via Bedrock)
- claude-haiku-4-5 (via Bedrock)
- Set via: `kiro-cli settings chat.defaultModel <model>`

### Claude
- claude-sonnet-4-6
- claude-opus-4-6
- claude-haiku-4-5-20251001
- Set via: Viridian UI model selector

## Thinking

### Kiro
- **Binary**: On or Off
- Enable: `kiro-cli settings chat.enableThinking true`
- No intensity levels
- **UI Should**: Hide thinking mode selector or show simple toggle

### Claude
- **5 Levels**: standard, think, think_hard, think_harder, ultrathink
- Set via: Viridian UI thinking mode selector
- **UI Should**: Show full dropdown with all options

## Plan Mode

### Kiro
- **Separate Agent**: `/plan` command or `Shift+Tab`
- Switches to planning agent (read-only)
- Not a permission mode
- **UI Should**: Show "Switch to Plan Agent" button

### Claude
- **Permission Mode**: "Plan Mode" in permission selector
- Prevents execution, planning only
- **UI Should**: Show in permission mode dropdown

## Context

### Kiro
- `/context` command
- Hooks system (automatic injection)
- Knowledge base (experimental)
- Context usage indicator setting
- **UI Should**: Show context percentage (already does)

### Claude
- Managed via CLI flags
- No built-in hooks system
- **UI Should**: Show context percentage (already does)

## Sessions

### Kiro
- **Location**: `~/.kiro/chat/`
- Per-directory storage
- **Fix**: Run `./fix-kiro-sessions.sh` to add to watcher

### Claude
- **Location**: `~/.claude/projects/`
- Per-project storage
- **Already working** in Viridian

## Permission Modes

### Kiro
- **Supported**: `bypassPermissions`, `default`
- Via CLI flags: `--trust-all-tools` or `--trust-tools <list>`
- **UI Should**: Only show these two options

### Claude
- **Supported**: All 4 modes
  - `bypassPermissions` (Full Auto)
  - `acceptEdits` (Accept Edits)
  - `plan` (Plan Mode)
  - `default` (Ask Every Time)
- **UI Should**: Show all options

## Images

### Kiro
- **Not Supported** via CLI flag
- Can read images via `read` tool
- **UI Should**: Hide image upload button

### Claude
- **Supported** via `--image` flag
- Direct image attachment
- **UI Should**: Show image upload button

## Subagents

### Kiro
- **Supported**: `delegate`, `use_subagent` tools
- **UI Should**: Show subagent features

### Claude
- **Supported**: Built-in subagent system
- **UI Should**: Show subagent features

## Quick UI Adaptation Checklist

```vue
<script setup>
import { useProviderStore } from '@/stores/provider';
const provider = useProviderStore();
</script>

<template>
  <!-- Thinking Mode: Only for Claude (multi-level) -->
  <ThinkingSelector v-if="provider.supportsThinking && provider.activeProviderId === 'claude'" />
  
  <!-- Plan Mode: Different for each -->
  <PlanModeButton v-if="provider.activeProviderId === 'kiro'" label="Switch to Plan Agent" />
  <PermissionMode v-else :modes="provider.activeCapabilities.supportedPermissionModes" />
  
  <!-- Images: Only for Claude -->
  <ImageUpload v-if="provider.supportsImages" />
  
  <!-- Sessions: Show provider icon -->
  <SessionItem :provider="session.provider" />
</template>
```

## Testing Commands

```bash
# Test Kiro
kiro-cli chat "Hello"
kiro-cli settings chat.enableThinking true
kiro-cli chat --trust-all-tools "Create a file"

# Test Claude
claude "Hello"
claude --thinking "Solve this problem"
claude --image screenshot.png "What's in this image?"

# Check sessions
ls ~/.kiro/chat/        # Kiro sessions
ls ~/.claude/projects/  # Claude sessions
```

## Common Issues

### "Kiro sessions not showing in sidebar"
**Fix**: Run `./fix-kiro-sessions.sh` and restart server

### "Thinking mode shows for Kiro but doesn't work"
**Fix**: Add `v-if="provider.supportsThinking"` to thinking mode UI

### "Plan mode doesn't work for Kiro"
**Reason**: Kiro uses `/plan` agent, not permission mode. Different UX needed.

### "Images don't work with Kiro"
**Expected**: Kiro doesn't support direct image upload via CLI

## Provider Capabilities Reference

```typescript
// Claude
{
  supportsThinking: true,          // Multi-level
  supportsToolUse: true,
  supportsPermissionModes: true,   // All 4 modes
  supportsImages: true,            // Direct upload
  supportsResume: true,
  supportsStreaming: true,
  supportsControlRequests: true,   // stdin protocol
  supportsSubagents: true,
  supportsPlanMode: true,          // As permission mode
  supportedPermissionModes: ['bypassPermissions', 'acceptEdits', 'plan', 'default'],
}

// Kiro
{
  supportsThinking: true,          // Binary on/off
  supportsToolUse: true,
  supportsPermissionModes: true,   // Only 2 modes
  supportsImages: false,           // No direct upload
  supportsResume: true,
  supportsStreaming: true,
  supportsControlRequests: false,  // CLI flags only
  supportsSubagents: true,
  supportsPlanMode: false,         // Separate agent instead
  supportedPermissionModes: ['bypassPermissions', 'default'],
  customFeatures: ['steering', 'custom_agents', 'knowledge_base', 'mcp', 'tangent_mode'],
}
```
