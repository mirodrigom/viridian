/**
 * Multi-Provider types — mirrors server/src/providers/types.ts ProviderInfoDTO.
 * These are the types the client receives from GET /api/providers.
 */

export type ProviderId = 'claude' | 'gemini' | 'codex' | 'aider' | 'cline' | 'kiro' | 'qwen' | 'opencode';

export interface ProviderModel {
  id: string;
  label: string;
  description: string;
  isDefault?: boolean;
}

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
  /** False when the CLI ignores --model and uses its own default. UI disables the selector. */
  supportsModelSelection?: boolean;
  supportedPermissionModes: string[];
  customFeatures: string[];
}

export interface ProviderInfo {
  id: ProviderId;
  name: string;
  icon: string;
  description: string;
  website: string;
  models: ProviderModel[];
  capabilities: ProviderCapabilities;
  available: boolean;
  configured: boolean;
  installCommand: string;
}
