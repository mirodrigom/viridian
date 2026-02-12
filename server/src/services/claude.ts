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
}

const activeSessions = new Map<string, ClaudeSession>();

export function createSession(cwd: string): ClaudeSession {
  const session: ClaudeSession = {
    id: uuid(),
    process: null,
    cwd,
    emitter: new EventEmitter(),
    usage: { inputTokens: 0, outputTokens: 0 },
    isStreaming: false,
    accumulatedText: '',
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
      const stream = claudeQuery({
        prompt,
        cwd: session.cwd,
        model: options?.model,
        permissionMode: options?.permissionMode,
        maxOutputTokens: options?.maxOutputTokens,
        allowedTools: options?.allowedTools,
        disallowedTools: options?.disallowedTools,
        images: options?.images,
        sessionId: session.claudeSessionId,
        abortSignal: abortController.signal,
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

/** Map SDK messages → EventEmitter events (preserving existing event names for WS/SSE consumers) */
function emitSDKMessage(session: ClaudeSession, msg: SDKMessage) {
  switch (msg.type) {
    case 'text_delta':
      session.accumulatedText += msg.text;
      session.emitter.emit('stream_delta', { text: msg.text });
      break;
    case 'thinking_start':
      session.emitter.emit('thinking_start', {});
      break;
    case 'thinking_delta':
      session.emitter.emit('thinking_delta', { text: msg.text });
      break;
    case 'thinking_end':
      session.emitter.emit('thinking_end', {});
      break;
    case 'tool_use':
      session.emitter.emit('tool_use', {
        tool: msg.tool,
        input: msg.input,
        requestId: msg.requestId,
      });
      break;
    case 'tool_input_delta':
      session.emitter.emit('tool_input_delta', {
        requestId: msg.requestId,
        tool: msg.tool,
        partialJson: msg.partialJson,
        accumulatedJson: msg.accumulatedJson,
      });
      break;
    case 'tool_input_complete':
      session.emitter.emit('tool_input_complete', {
        requestId: msg.requestId,
        tool: msg.tool,
        input: msg.input,
      });
      break;
    case 'error':
      session.emitter.emit('error', { error: msg.error });
      break;
    case 'system':
      if (msg.sessionId) session.claudeSessionId = msg.sessionId;
      break;
    case 'message_start':
      if (msg.inputTokens) session.usage.inputTokens = msg.inputTokens;
      break;
    case 'message_delta':
      if (msg.outputTokens) session.usage.outputTokens = msg.outputTokens;
      break;
    case 'result':
      if (msg.sessionId) session.claudeSessionId = msg.sessionId;
      session.process = null;
      session.isStreaming = false;
      session.emitter.emit('stream_end', {
        sessionId: session.id,
        claudeSessionId: session.claudeSessionId,
        exitCode: msg.exitCode,
        usage: {
          input_tokens: session.usage.inputTokens,
          output_tokens: session.usage.outputTokens,
        },
      });
      break;
  }
}

export function abortSession(sessionId: string) {
  const session = activeSessions.get(sessionId);
  if (session?.abortController) {
    session.abortController.abort();
    session.abortController = undefined;
  }
  if (session?.process) {
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

export function removeSession(sessionId: string) {
  abortSession(sessionId);
  activeSessions.delete(sessionId);
}
