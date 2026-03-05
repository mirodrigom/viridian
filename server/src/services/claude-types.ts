/**
 * Claude Code SDK — Type definitions for all SDK messages and query options.
 */

// ─── Message types emitted by the SDK ───────────────────────────────────────

export interface SDKTextDelta {
  type: 'text_delta';
  text: string;
  parentToolUseId?: string | null;
}

export interface SDKThinkingStart {
  type: 'thinking_start';
  parentToolUseId?: string | null;
}

export interface SDKThinkingDelta {
  type: 'thinking_delta';
  text: string;
  parentToolUseId?: string | null;
}

export interface SDKThinkingEnd {
  type: 'thinking_end';
  parentToolUseId?: string | null;
}

export interface SDKToolUse {
  type: 'tool_use';
  tool: string;
  requestId: string;
  input: Record<string, unknown>;
  parentToolUseId?: string | null;
}

export interface SDKToolInputDelta {
  type: 'tool_input_delta';
  requestId: string | null;
  tool: string | null;
  partialJson: string;
  accumulatedJson: string;
  parentToolUseId?: string | null;
}

export interface SDKToolInputComplete {
  type: 'tool_input_complete';
  requestId: string | null;
  tool: string | null;
  input: Record<string, unknown>;
  parentToolUseId?: string | null;
}

export interface SDKError {
  type: 'error';
  error: string;
}

export interface SDKSystem {
  type: 'system';
  sessionId?: string;
}

export interface SDKResult {
  type: 'result';
  sessionId?: string;
  exitCode: number | null;
}

export interface SDKMessageDelta {
  type: 'message_delta';
  outputTokens?: number;
  parentToolUseId?: string | null;
}

export interface SDKMessageStart {
  type: 'message_start';
  inputTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  parentToolUseId?: string | null;
}

export interface SDKSubagentResult {
  type: 'subagent_result';
  toolUseId: string;
  status: string;
  content: string;
  agentId?: string;
}

export interface SDKControlRequest {
  type: 'control_request';
  requestId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  toolUseId?: string;
}

export type SDKMessage =
  | SDKTextDelta
  | SDKThinkingStart
  | SDKThinkingDelta
  | SDKThinkingEnd
  | SDKToolUse
  | SDKToolInputDelta
  | SDKToolInputComplete
  | SDKError
  | SDKSystem
  | SDKResult
  | SDKMessageDelta
  | SDKMessageStart
  | SDKSubagentResult
  | SDKControlRequest;

// ─── Query options ──────────────────────────────────────────────────────────

export interface QueryOptions {
  prompt: string;
  cwd: string;
  model?: string;
  permissionMode?: string;
  maxOutputTokens?: number;
  tools?: string[];              // Restrict available tools (--tools "Task,TodoWrite")
  allowedTools?: string[];
  disallowedTools?: string[];
  images?: { name: string; dataUrl: string }[];
  sessionId?: string;            // Claude session ID for resuming
  abortSignal?: AbortSignal;     // Abort controller signal
  onStdinReady?: (write: (data: string) => void) => void; // Callback to receive stdin writer for bidirectional communication
  noTools?: boolean;             // Disable all tools (--tools "")
  disableSlashCommands?: boolean; // Disable built-in skills (--disable-slash-commands)
  systemPrompt?: string;         // Injected system prompt (--system-prompt)
  appendSystemPrompt?: string;   // Appended system prompt (--append-system-prompt)
  agents?: Record<string, {      // Custom sub-agents (--agents)
    description: string;
    prompt: string;
    tools?: string[];
    disallowedTools?: string[];
    model?: string;
    permissionMode?: string;
    maxTurns?: number;
  }>;
}

// ─── Internal block tracking ────────────────────────────────────────────────

export interface BlockState {
  currentBlockType: string | null;
  currentToolInputJson: string;
  currentToolId: string | null;
  currentToolName: string | null;
  claudeSessionId?: string;
  currentParentToolUseId: string | null; // tracks which agent (parent/sub) owns current events
  emittedToolUseIds: Set<string>; // deduplicate tool_use events (--include-partial-messages can re-emit)
  hasEmittedText: boolean; // track whether any text was emitted (for empty-response error detection)
}
