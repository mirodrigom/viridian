/**
 * Provider-agnostic session manager.
 *
 * Manages active sessions, routes queries through the provider registry,
 * handles permission auto-approval, and emits events to WebSocket clients.
 *
 * Kept as claude.ts for backward-compatible imports from chat.ts, sessions.ts, agent.ts.
 */

import { type ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { v4 as uuid } from 'uuid';
import type { SDKMessage } from './claude-sdk.js';
import type { ProviderId } from '../providers/types.js';
import { getProvider } from '../providers/registry.js';
import { upsertSessionProvider } from '../db/database.js';
import * as lf from './langfuse.js';

// Ensure providers are registered (side-effect imports)
import '../providers/claude.js';
import '../providers/gemini.js';

interface ProviderSession {
  id: string;
  providerId: ProviderId;
  /** Provider-specific session ID (e.g. Claude JSONL filename for --resume). */
  claudeSessionId?: string;
  process: ChildProcess | null;
  cwd: string;
  emitter: EventEmitter;
  abortController?: AbortController;
  usage: { inputTokens: number; outputTokens: number };
  isStreaming: boolean;
  /** Accumulated assistant text during current streaming response (for reconnecting clients). */
  accumulatedText: string;
  /** Write function for stdin bidirectional communication (permission responses). */
  stdinWrite?: (data: string) => void;
  /** Buffered events while waiting for user to respond to AskUserQuestion or ExitPlanMode. null = not buffering. */
  pendingQuestionBuffer: { event: string; data: unknown }[] | null;
  /** The most recent control_request forwarded to the client that is still awaiting a response.
   *  Stored so it can be re-sent when the WebSocket reconnects mid-approval. */
  pendingControlRequest: { requestId: string; toolName: string; toolInput: unknown; toolUseId: string } | null;
  /** Last activity timestamp for idle session cleanup. */
  lastActivity: number;
  /** User's requested permission mode (used for server-side auto-approval of control_requests). */
  userPermissionMode?: string;
  /** Monotonically increasing counter to identify the current stream generation.
   *  Used to prevent stale async generators from emitting events after a new stream has started. */
  streamGeneration: number;
}

// Keep the old type name exported for backward compat with any external consumers
export type { ProviderSession as ClaudeSession };

const activeSessions = new Map<string, ProviderSession>();

// Clean up idle non-streaming sessions every 5 minutes
const SESSION_IDLE_TIMEOUT = 30 * 60_000; // 30 minutes
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of activeSessions) {
    if (!session.isStreaming && now - session.lastActivity > SESSION_IDLE_TIMEOUT) {
      abortSession(id);
      activeSessions.delete(id);
    }
  }
}, 5 * 60_000).unref();

export function createSession(cwd: string, claudeSessionId?: string, providerId: ProviderId = 'claude'): ProviderSession {
  const session: ProviderSession = {
    id: uuid(),
    providerId,
    claudeSessionId,
    process: null,
    cwd,
    emitter: new EventEmitter(),
    usage: { inputTokens: 0, outputTokens: 0 },
    isStreaming: false,
    accumulatedText: '',
    pendingQuestionBuffer: null,
    pendingControlRequest: null,
    lastActivity: Date.now(),
    streamGeneration: 0,
  };
  activeSessions.set(session.id, session);
  return session;
}

export function getSession(id: string): ProviderSession | undefined {
  // First try direct lookup by server UUID
  const direct = activeSessions.get(id);
  if (direct) return direct;
  // Fall back to lookup by claudeSessionId (for clients that only know the provider session ID)
  for (const session of activeSessions.values()) {
    if (session.claudeSessionId === id) return session;
  }
  return undefined;
}

export interface SendMessageOptions {
  model?: string;
  permissionMode?: string;
  images?: { name: string; dataUrl: string }[];
  maxOutputTokens?: number;
  allowedTools?: string[];
  disallowedTools?: string[];
}

export function sendMessage(sessionId: string, prompt: string, options?: SendMessageOptions) {
  const session = activeSessions.get(sessionId);
  if (!session) throw new Error('Session not found');

  const provider = getProvider(session.providerId);

  // Abort any previous stream still running on this session so its stale
  // async generator doesn't emit a stream_end that kills the new stream.
  if (session.abortController) {
    session.abortController.abort();
  }

  const abortController = new AbortController();
  session.abortController = abortController;
  session.isStreaming = true;
  session.lastActivity = Date.now();
  session.pendingQuestionBuffer = null;
  session.pendingControlRequest = null;

  // Bump the generation counter — stale generators check this before emitting.
  const generation = ++session.streamGeneration;

  session.accumulatedText = '';
  session.emitter.emit('stream_start');

  lf.startTrace({
    sessionId: session.id,
    claudeSessionId: session.claudeSessionId,
    providerId: session.providerId,
    prompt,
    model: options?.model,
  });

  // Store user's permission mode for server-side auto-approval of control_requests.
  // For providers that support control requests (like Claude), we pass 'default' to the CLI
  // so it sends control_request for every tool, and the server auto-approves based on user's mode.
  // For providers without control request support, permission mode is irrelevant (always auto).
  session.userPermissionMode = options?.permissionMode || 'bypassPermissions';

  // For providers that support control requests, force 'default' mode so every tool
  // sends a control_request. We handle auto-approval server-side.
  const effectivePermissionMode = provider.capabilities.supportsControlRequests
    ? 'default'
    : (options?.permissionMode || 'bypassPermissions');

  // Run the provider query in the background
  (async () => {
    try {
      const stream = provider.query({
        prompt,
        cwd: session.cwd,
        model: options?.model,
        permissionMode: effectivePermissionMode,
        maxOutputTokens: options?.maxOutputTokens,
        allowedTools: options?.allowedTools,
        disallowedTools: options?.disallowedTools,
        images: options?.images,
        sessionId: session.claudeSessionId,
        abortSignal: abortController.signal,
        onStdinReady: (write) => {
          session.stdinWrite = write;
        },
      });

      for await (const msg of stream) {
        // If a newer stream has started, stop processing this stale generator
        if (session.streamGeneration !== generation) return;
        emitSDKMessage(session, msg);
      }
      // Safety net: if the generator finished but isStreaming is still true,
      // it means buildEmitEvent never saw a 'result' message (or pendingQuestionBuffer
      // swallowed the stream_end). Force-emit stream_end so the client isn't left hanging.
      // Only if this is still the current generation — a newer sendMessage may have started.
      if (session.isStreaming && session.streamGeneration === generation) {
        console.warn(`[SessionManager] stream generator finished but session ${session.id} still marked as streaming — forcing stream_end`);
        session.isStreaming = false;
        session.lastActivity = Date.now();
        session.emitter.emit('stream_end', {
          sessionId: session.id,
          claudeSessionId: session.claudeSessionId,
          providerId: session.providerId,
          usage: { input_tokens: session.usage.inputTokens, output_tokens: session.usage.outputTokens },
        });
      }
    } catch (err) {
      // If a newer stream has started, silently discard errors from this stale generator
      if (session.streamGeneration !== generation) return;
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      session.isStreaming = false;
      session.lastActivity = Date.now();
      session.emitter.emit('error', { error: errorMsg });
      session.emitter.emit('stream_end', {
        sessionId: session.id,
        claudeSessionId: session.claudeSessionId,
        providerId: session.providerId,
        usage: { input_tokens: session.usage.inputTokens, output_tokens: session.usage.outputTokens },
      });
    }
  })();
}

/**
 * Convert an SDK message into an { event, data } pair for the EventEmitter.
 * Also applies side-effects on `session` (e.g. accumulating text, tracking usage).
 * Returns null for messages that are side-effect-only (system, message_start, message_delta).
 */
function buildEmitEvent(session: ProviderSession, msg: SDKMessage): { event: string; data: unknown } | null {
  switch (msg.type) {
    case 'text_delta':
      session.accumulatedText += msg.text;
      lf.recordTextDelta(session.id, msg.text);
      return { event: 'stream_delta', data: { text: msg.text } };
    case 'thinking_start':
      return { event: 'thinking_start', data: {} };
    case 'thinking_delta':
      return { event: 'thinking_delta', data: { text: msg.text } };
    case 'thinking_end':
      return { event: 'thinking_end', data: {} };
    case 'tool_use': {
      lf.recordToolUse(session.id, msg.requestId, msg.tool, msg.input, msg.parentToolUseId);
      return { event: 'tool_use', data: { tool: msg.tool, input: msg.input, requestId: msg.requestId } };
    }
    case 'tool_input_delta':
      return { event: 'tool_input_delta', data: { requestId: msg.requestId, tool: msg.tool, partialJson: msg.partialJson, accumulatedJson: msg.accumulatedJson } };
    case 'tool_input_complete':
      if (msg.requestId) lf.updateToolInput(session.id, msg.requestId, msg.input);
      return { event: 'tool_input_complete', data: { requestId: msg.requestId, tool: msg.tool, input: msg.input } };
    case 'error':
      lf.recordError(session.id, msg.error);
      return { event: 'error', data: { error: msg.error } };
    case 'system':
      if (msg.sessionId) session.claudeSessionId = msg.sessionId;
      return null;
    case 'message_start': {
      const input = msg.inputTokens || 0;
      const cacheCreation = msg.cacheCreationInputTokens || 0;
      const cacheRead = msg.cacheReadInputTokens || 0;
      session.usage.inputTokens = input + cacheCreation + cacheRead;
      return null;
    }
    case 'message_delta':
      if (msg.outputTokens) session.usage.outputTokens = msg.outputTokens;
      return null;
    case 'control_request':
      return { event: 'control_request', data: { requestId: msg.requestId, toolName: msg.toolName, toolInput: msg.toolInput, toolUseId: msg.toolUseId } };
    case 'result':
      if (msg.sessionId) session.claudeSessionId = msg.sessionId;
      session.process = null;
      session.isStreaming = false;
      session.lastActivity = Date.now();
      session.stdinWrite = undefined;
      lf.endTrace(session.id, session.usage);
      // Persist provider → session mapping so historical messages show the correct logo
      if (session.claudeSessionId) {
        const projectDir = session.cwd.replace(/\//g, '-');
        upsertSessionProvider(projectDir, session.claudeSessionId, session.providerId);
      }
      return {
        event: 'stream_end',
        data: {
          sessionId: session.id,
          claudeSessionId: session.claudeSessionId,
          providerId: session.providerId,
          exitCode: msg.exitCode,
          usage: { input_tokens: session.usage.inputTokens, output_tokens: session.usage.outputTokens },
        },
      };
    case 'subagent_result':
      lf.recordToolResult(session.id, msg.toolUseId, msg.content);
      return null;
    default:
      return null;
  }
}

const FILE_TOOLS = ['Read', 'Write', 'Edit', 'NotebookEdit', 'MultiEdit', 'Glob', 'Grep', 'TodoWrite', 'WebFetch', 'WebSearch'];
const READ_ONLY_TOOLS = ['Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'TodoWrite'];

/**
 * Check whether a tool should be auto-approved server-side based on the user's permission mode.
 * Returns true if the tool should be auto-approved (send control_response immediately),
 * false if it needs user approval (forward control_request to client).
 *
 * For providers that don't support control requests, this always returns true
 * (they never send control_request events, so this is just a safety fallback).
 */
function shouldAutoApprove(session: ProviderSession, toolName: string): boolean {
  // If the provider doesn't support control requests, always auto-approve
  const provider = getProvider(session.providerId);
  if (!provider.capabilities.supportsControlRequests) return true;

  // AskUserQuestion always requires user interaction regardless of permission mode
  if (toolName === 'AskUserQuestion') return false;

  const mode = session.userPermissionMode || 'default';
  if (mode === 'bypassPermissions') return true;
  if (toolName === 'ExitPlanMode') return false;
  if (mode === 'acceptEdits' && FILE_TOOLS.includes(toolName)) return true;
  if (mode === 'plan' && READ_ONLY_TOOLS.includes(toolName)) return true;
  return false;
}

/** Send an auto-approval control_response via the provider's protocol and notify the client. */
function autoApproveControlRequest(session: ProviderSession, requestId: string, toolUseId?: string) {
  if (!session.stdinWrite) return;

  const provider = getProvider(session.providerId);
  const response = provider.buildControlResponse(requestId, true);
  if (response) {
    session.stdinWrite(response);
  }

  // Notify client so it can update the tool status from 'pending' to 'approved'
  if (toolUseId) {
    session.emitter.emit('tool_approved', { toolUseId });
  }
}

/** Map SDK messages → EventEmitter events, with buffering while awaiting tool approval. */
function emitSDKMessage(session: ProviderSession, msg: SDKMessage) {
  // When buffering (waiting for user to Allow/Deny a tool), queue events instead of emitting.
  // Allow through: control_request (so client shows Allow/Deny buttons) and tool_input events
  // for the pending tool itself (so input streams to the client).
  if (session.pendingQuestionBuffer !== null) {
    if (msg.type === 'result') {
      // NEVER buffer stream_end — flush the buffer first, then emit stream_end
      const buffered = session.pendingQuestionBuffer;
      session.pendingQuestionBuffer = null;
      for (const evt of buffered) {
        session.emitter.emit(evt.event, evt.data);
      }
      // Fall through to emit the result/stream_end normally
    } else if (msg.type === 'control_request') {
      // Auto-approve server-side if the user's permission mode allows it.
      // Otherwise pass through to the client for user approval.
      if (shouldAutoApprove(session, msg.toolName)) {
        autoApproveControlRequest(session, msg.requestId, msg.toolUseId);
        // Don't start a second buffer layer or emit to client — just approve and continue
        return;
      }
      // Falls through to emit control_request to client
    } else if (msg.type === 'tool_input_delta' || msg.type === 'tool_input_complete') {
      // These pass through to the client
    } else {
      const evt = buildEmitEvent(session, msg);
      if (evt) session.pendingQuestionBuffer.push(evt);
      return;
    }
  }

  const evt = buildEmitEvent(session, msg);
  if (!evt) return;

  // Handle control_request: auto-approve server-side or start buffering for user approval.
  // Since we always pass --permission-mode default to the CLI, it sends control_request
  // for every tool. We auto-approve based on the user's selected permission mode.
  if (msg.type === 'control_request') {
    if (shouldAutoApprove(session, msg.toolName)) {
      autoApproveControlRequest(session, msg.requestId, msg.toolUseId);
      return; // Don't emit to client or start buffering
    }
    // Tool needs user approval — start buffering subsequent events
    if (session.pendingQuestionBuffer === null) {
      session.pendingQuestionBuffer = [];
    }
  }

  // Start buffering as soon as we see AskUserQuestion or ExitPlanMode tool_use
  // since text can stream between tool_use and control_request.
  // AskUserQuestion always buffers (requires user interaction regardless of mode).
  // ExitPlanMode only buffers when not in bypassPermissions mode.
  if (msg.type === 'tool_use') {
    if (msg.tool === 'AskUserQuestion' ||
        (msg.tool === 'ExitPlanMode' && session.userPermissionMode !== 'bypassPermissions')) {
      session.pendingQuestionBuffer = [];
    }
  }

  // Track the pending control_request so it can be re-sent when the WS reconnects
  // (e.g. the client disconnected between tool_input_complete and control_request)
  if (evt.event === 'control_request') {
    session.pendingControlRequest = evt.data as { requestId: string; toolName: string; toolInput: unknown; toolUseId: string };
  }

  session.emitter.emit(evt.event, evt.data);
}

export function respondToPermission(
  sessionId: string,
  requestId: string,
  approved: boolean,
  answers?: Record<string, string>,
  questions?: unknown[],
) {
  const session = activeSessions.get(sessionId);
  if (!session) return;

  // Send control_response via the provider's protocol
  if (session.stdinWrite) {
    const provider = getProvider(session.providerId);
    const updatedInput = answers ? { questions: questions || [], answers } : undefined;
    const response = provider.buildControlResponse(requestId, approved, {
      updatedInput: approved ? updatedInput : undefined,
      message: approved ? undefined : 'User denied the tool request',
    });
    if (response) {
      session.stdinWrite(response);
    }
  }

  // Flush buffered events (held back while waiting for tool approval)
  session.pendingControlRequest = null;
  if (session.pendingQuestionBuffer) {
    const buffered = session.pendingQuestionBuffer;
    session.pendingQuestionBuffer = null;
    for (const evt of buffered) {
      session.emitter.emit(evt.event, evt.data);
    }
  }
}

export function abortSession(sessionId: string) {
  const session = activeSessions.get(sessionId);
  if (!session) return;
  const wasStreaming = session.isStreaming;
  const generation = session.streamGeneration;
  session.pendingQuestionBuffer = null;
  session.pendingControlRequest = null;
  if (session.abortController) {
    session.abortController.abort();
    session.abortController = undefined;
  }
  if (session.process) {
    session.process.kill('SIGTERM');
    const proc = session.process;
    setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch { /* already dead */ }
      if (session.isStreaming && session.streamGeneration === generation) {
        session.isStreaming = false;
        session.process = null;
        session.stdinWrite = undefined;
        session.lastActivity = Date.now();
        session.emitter.emit('stream_end', {
          sessionId: session.id,
          claudeSessionId: session.claudeSessionId,
          providerId: session.providerId,
          usage: { input_tokens: session.usage.inputTokens, output_tokens: session.usage.outputTokens },
        });
      }
    }, 3000);
  } else if (wasStreaming) {
    session.isStreaming = false;
    session.lastActivity = Date.now();
    session.emitter.emit('stream_end', {
      sessionId: session.id,
      claudeSessionId: session.claudeSessionId,
      providerId: session.providerId,
      usage: { input_tokens: session.usage.inputTokens, output_tokens: session.usage.outputTokens },
    });
  }
}

export function isSessionStreaming(sessionId: string): boolean {
  const session = getSession(sessionId);
  return session?.isStreaming ?? false;
}

export function getSessionAccumulatedText(sessionId: string): string {
  const session = getSession(sessionId);
  return session?.accumulatedText ?? '';
}

/** Returns the set of provider session IDs that are currently streaming. */
export function getStreamingClaudeSessionIds(): Set<string> {
  const ids = new Set<string>();
  for (const session of activeSessions.values()) {
    if (session.isStreaming && session.claudeSessionId) {
      ids.add(session.claudeSessionId);
    }
  }
  return ids;
}

export function removeSession(sessionId: string) {
  abortSession(sessionId);
  activeSessions.delete(sessionId);
}
