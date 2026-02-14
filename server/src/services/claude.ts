import { type ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { v4 as uuid } from 'uuid';
import { claudeQuery, type SDKMessage } from './claude-sdk.js';

interface ClaudeSession {
  id: string;
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
  /** Buffered events while waiting for user to answer AskUserQuestion. null = not buffering. */
  pendingQuestionBuffer: { event: string; data: unknown }[] | null;
}

const activeSessions = new Map<string, ClaudeSession>();

export function createSession(cwd: string, claudeSessionId?: string): ClaudeSession {
  const session: ClaudeSession = {
    id: uuid(),
    claudeSessionId,
    process: null,
    cwd,
    emitter: new EventEmitter(),
    usage: { inputTokens: 0, outputTokens: 0 },
    isStreaming: false,
    accumulatedText: '',
    pendingQuestionBuffer: null,
  };
  activeSessions.set(session.id, session);
  return session;
}

export function getSession(id: string): ClaudeSession | undefined {
  return activeSessions.get(id);
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

  const abortController = new AbortController();
  session.abortController = abortController;
  session.isStreaming = true;

  session.accumulatedText = '';
  session.emitter.emit('stream_start');

  // Run the SDK generator in the background
  (async () => {
    try {
      const permMode = options?.permissionMode || 'bypassPermissions';
      const stream = claudeQuery({
        prompt,
        cwd: session.cwd,
        model: options?.model,
        permissionMode: permMode,
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
        emitSDKMessage(session, msg);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      session.isStreaming = false;
      session.emitter.emit('error', { error: errorMsg });
      session.emitter.emit('stream_end', { sessionId: session.id });
    }
  })();
}

/**
 * Convert an SDK message into an { event, data } pair for the EventEmitter.
 * Also applies side-effects on `session` (e.g. accumulating text, tracking usage).
 * Returns null for messages that are side-effect-only (system, message_start, message_delta).
 */
function buildEmitEvent(session: ClaudeSession, msg: SDKMessage): { event: string; data: unknown } | null {
  switch (msg.type) {
    case 'text_delta':
      session.accumulatedText += msg.text;
      return { event: 'stream_delta', data: { text: msg.text } };
    case 'thinking_start':
      return { event: 'thinking_start', data: {} };
    case 'thinking_delta':
      return { event: 'thinking_delta', data: { text: msg.text } };
    case 'thinking_end':
      return { event: 'thinking_end', data: {} };
    case 'tool_use':
      return { event: 'tool_use', data: { tool: msg.tool, input: msg.input, requestId: msg.requestId } };
    case 'tool_input_delta':
      return { event: 'tool_input_delta', data: { requestId: msg.requestId, tool: msg.tool, partialJson: msg.partialJson, accumulatedJson: msg.accumulatedJson } };
    case 'tool_input_complete':
      return { event: 'tool_input_complete', data: { requestId: msg.requestId, tool: msg.tool, input: msg.input } };
    case 'error':
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
      session.stdinWrite = undefined;
      return { event: 'stream_end', data: { sessionId: session.id, claudeSessionId: session.claudeSessionId, exitCode: msg.exitCode, usage: { input_tokens: session.usage.inputTokens, output_tokens: session.usage.outputTokens } } };
    default:
      return null;
  }
}

/** Map SDK messages → EventEmitter events, with buffering for AskUserQuestion. */
function emitSDKMessage(session: ClaudeSession, msg: SDKMessage) {
  // When buffering (waiting for AskUserQuestion answer), queue events instead of emitting.
  // control_request itself is still emitted so the client shows the question modal.
  if (session.pendingQuestionBuffer !== null && msg.type !== 'control_request') {
    const evt = buildEmitEvent(session, msg);
    if (evt) session.pendingQuestionBuffer.push(evt);
    return;
  }

  const evt = buildEmitEvent(session, msg);
  if (!evt) return;

  // Start buffering after AskUserQuestion control_request
  if (msg.type === 'control_request' && msg.toolName === 'AskUserQuestion') {
    session.pendingQuestionBuffer = [];
  }

  session.emitter.emit(evt.event, evt.data);
}

export function respondToPermission(sessionId: string, requestId: string, approved: boolean) {
  const session = activeSessions.get(sessionId);
  if (!session) return;

  // Send control_response to CLI if stdin is still open
  if (session.stdinWrite) {
    const response = approved
      ? {
          type: 'control_response',
          response: { subtype: 'success', request_id: requestId, response: { behavior: 'allow' } },
        }
      : {
          type: 'control_response',
          response: { subtype: 'success', request_id: requestId, response: { behavior: 'deny', message: 'User denied the tool request' } },
        };

    session.stdinWrite(JSON.stringify(response));
  }

  // Flush buffered events (from AskUserQuestion pause)
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
  session.pendingQuestionBuffer = null;
  if (session.abortController) {
    session.abortController.abort();
    session.abortController = undefined;
  }
  if (session.process) {
    session.process.kill('SIGTERM');
    session.process = null;
  }
}

export function isSessionStreaming(sessionId: string): boolean {
  const session = activeSessions.get(sessionId);
  return session?.isStreaming ?? false;
}

export function getSessionAccumulatedText(sessionId: string): string {
  const session = activeSessions.get(sessionId);
  return session?.accumulatedText ?? '';
}

/** Returns the set of claudeSessionIds (= JSONL filenames) that are currently streaming. */
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
