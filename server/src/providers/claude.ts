/**
 * Claude Provider Adapter — wraps the existing claude-sdk.ts without modifying it.
 *
 * This is the reference IProvider implementation.  It delegates to
 * findClaudeBinary() and claudeQuery() from claude-sdk.ts, mapping
 * ProviderQueryOptions → QueryOptions transparently (the shapes are
 * intentionally identical since SDKMessage was designed around Claude).
 */

import type {
  IProvider,
  ProviderInfo,
  ProviderModel,
  ProviderCapabilities,
  ProviderQueryOptions,
  ParsedSessionMessage,
} from './types.js';
import type { SDKMessage } from '../services/claude-sdk.js';
import { findClaudeBinary, claudeQuery } from '../services/claude-sdk.js';
import { registerProvider } from './registry.js';
import { join } from 'path';
import { existsSync } from 'fs';

// ─── Provider metadata ──────────────────────────────────────────────────

const info: ProviderInfo = {
  id: 'claude',
  name: 'Claude',
  icon: 'ClaudeLogo',
  description: 'Anthropic Claude Code — deep reasoning, tool use, and agentic coding',
  website: 'https://claude.ai',
  binaryName: 'claude',
  envVarForPath: 'CLAUDE_PATH',
  installCommand: 'npm install -g @anthropic-ai/claude-code',
};

const models: ProviderModel[] = [
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', description: 'Fast and capable — best balance of speed and quality', isDefault: true },
  { id: 'claude-opus-4-6', label: 'Claude Opus 4.6', description: 'Most powerful — deep reasoning and complex tasks' },
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', description: 'Fastest — quick tasks with lower cost' },
];

const capabilities: ProviderCapabilities = {
  supportsThinking: true,
  supportsToolUse: true,
  supportsPermissionModes: true,
  supportsImages: true,
  supportsResume: true,
  supportsStreaming: true,
  supportsControlRequests: true,
  supportsSubagents: true,
  supportsPlanMode: true,
  supportedPermissionModes: ['bypassPermissions', 'acceptEdits', 'plan', 'default'],
  customFeatures: ['thinking_modes', 'slash_commands', 'mcp'],
};

// ─── IProvider implementation ───────────────────────────────────────────

const claudeProvider: IProvider = {
  info,
  models,
  capabilities,

  isAvailable(): boolean {
    try {
      findClaudeBinary();
      return true;
    } catch {
      return false;
    }
  },

  findBinary(): string {
    return findClaudeBinary();
  },

  isConfigured() {
    // Claude stores auth in ~/.claude/ after running `claude` for the first time
    const home = process.env.HOME || '/home';
    if (existsSync(join(home, '.claude'))) return { configured: true };
    return {
      configured: false,
      reason: 'Claude credentials not found. Run `claude` in your terminal to authenticate.',
    };
  },

  async *query(options: ProviderQueryOptions): AsyncGenerator<SDKMessage, void, undefined> {
    // ProviderQueryOptions and QueryOptions are structurally identical —
    // Claude SDK was the original design, so we pass through directly.
    yield* claudeQuery(options);
  },

  buildControlResponse(requestId: string, approved: boolean, extra?: {
    updatedInput?: unknown;
    message?: string;
  }): string {
    if (approved) {
      return JSON.stringify({
        type: 'control_response',
        response: {
          subtype: 'success',
          request_id: requestId,
          response: {
            behavior: 'allow',
            updatedInput: extra?.updatedInput,
          },
        },
      });
    }
    return JSON.stringify({
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: requestId,
        response: {
          behavior: 'deny',
          message: extra?.message || 'User denied the tool request',
        },
      },
    });
  },

  getSessionDir(): string | null {
    const home = process.env.HOME || '/home';
    const dir = join(home, '.claude', 'projects');
    return existsSync(dir) ? dir : null;
  },
};

// Auto-register on import
registerProvider(claudeProvider);

export default claudeProvider;
