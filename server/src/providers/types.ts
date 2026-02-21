/**
 * Multi-Provider Adapter — Core type definitions.
 *
 * Every AI CLI backend (Claude, Gemini, Codex, Aider, Cline) implements
 * the IProvider interface.  Its query() method returns the same
 * AsyncGenerator<SDKMessage> that the rest of the codebase already consumes,
 * so callers (session manager, autopilot, graph runner) are provider-agnostic.
 */

import type { SDKMessage } from '../services/claude-sdk.js';

// Re-export so consumers only need to import from providers/types
export type { SDKMessage };

// ─── Provider Identity ──────────────────────────────────────────────────

export type ProviderId = 'claude' | 'gemini' | 'codex' | 'aider' | 'cline' | 'kiro' | 'qwen' | 'opencode';

export interface ProviderInfo {
  id: ProviderId;
  name: string;              // Human-readable: "Claude", "Gemini", etc.
  icon: string;              // Component name for client-side logo
  description: string;
  website: string;
  binaryName: string;        // CLI binary: "claude", "gemini", etc.
  envVarForPath?: string;    // Optional env var to override binary path
  installCommand: string;    // Shell command to install the CLI
}

// ─── Models ─────────────────────────────────────────────────────────────

export interface ProviderModel {
  id: string;                // e.g. "claude-opus-4-6", "gemini-2.5-pro"
  label: string;             // Display name
  description: string;
  isDefault?: boolean;
}

// ─── Capabilities ───────────────────────────────────────────────────────

export interface ProviderCapabilities {
  supportsThinking: boolean;
  supportsToolUse: boolean;
  supportsPermissionModes: boolean;
  supportsImages: boolean;
  supportsResume: boolean;
  supportsStreaming: boolean;
  supportsControlRequests: boolean;
  supportsSubagents: boolean;
  supportsPlanMode: boolean;
  supportedPermissionModes: string[];
  customFeatures: string[];
}

// ─── Query Options ──────────────────────────────────────────────────────

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
  sessionId?: string;
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

// ─── Session History ────────────────────────────────────────────────────

export interface ParsedSessionMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: number;
  toolUse?: { tool: string; input: Record<string, unknown> };
  thinking?: string;
}

// ─── Provider Interface ─────────────────────────────────────────────────

export interface IProvider {
  readonly info: ProviderInfo;
  readonly models: ProviderModel[];
  readonly capabilities: ProviderCapabilities;

  /** Check if the CLI binary is installed and reachable. */
  isAvailable(): boolean;

  /** Find and return the binary path, or throw if not found. */
  findBinary(): string;

  /** Execute a query — returns the universal SDKMessage stream. */
  query(options: ProviderQueryOptions): AsyncGenerator<SDKMessage, void, undefined>;

  /**
   * Build a control_response payload string to send via stdin.
   * Returns null if the provider doesn't support control responses.
   */
  buildControlResponse(requestId: string, approved: boolean, extra?: {
    updatedInput?: unknown;
    message?: string;
  }): string | null;

  /** Directory where this provider stores session history, or null. */
  getSessionDir(): string | null;

  /** Parse a provider-specific session file into normalized messages. */
  parseSessionFile?(filePath: string): Promise<ParsedSessionMessage[]>;
}

// ─── Serializable provider info (for REST API / client) ─────────────────

export interface ProviderInfoDTO {
  id: ProviderId;
  name: string;
  icon: string;
  description: string;
  website: string;
  models: ProviderModel[];
  capabilities: ProviderCapabilities;
  available: boolean;
  installCommand: string;
}
