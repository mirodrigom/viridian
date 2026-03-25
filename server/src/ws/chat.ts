import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import fs from 'fs';
import type { Server } from 'http';
import { verifyToken } from '../services/auth.js';
import { getHomeDir } from '../utils/platform.js';
import { createSession, getSession, sendMessage, abortSession, respondToPermission, isSessionStreaming, getSessionAccumulatedText, type SendMessageOptions } from '../services/claude.js';
import type { ProviderId } from '../providers/types.js';
import { getProvider, getAllProviders } from '../providers/registry.js';
import { createLogger } from '../logger.js';

const log = createLogger('chat-ws');

/** Validate and normalize a cwd path — must be absolute, no traversal, and must exist. */
function validateCwd(cwd: unknown): string | null {
  if (typeof cwd !== 'string' || !cwd) return null;
  const normalized = path.resolve(cwd);
  if (!path.isAbsolute(normalized)) return null;
  // Verify directory exists — spawn() throws ENOENT if cwd doesn't exist
  try { if (!fs.statSync(normalized).isDirectory()) return null; } catch { return null; }
  return normalized;
}

export function setupChatWs(server: Server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    if (url.pathname !== '/ws/chat') return;

    const token = url.searchParams.get('token');
    if (!token) {
      socket.destroy();
      return;
    }

    try {
      verifyToken(token);
    } catch {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  /** Wire up a session's EventEmitter to forward events to the WebSocket client.
   *  Returns a cleanup function to remove only this WS's listeners. */
  function wireEmitter(ws: WebSocket, emitter: import('events').EventEmitter, sessionId: string, providerId: string): () => void {
    const listeners: Array<{ event: string; handler: (...args: unknown[]) => void }> = [];

    function addHandler(event: string, handler: (...args: unknown[]) => void) {
      emitter.on(event, handler);
      listeners.push({ event, handler });
    }

    addHandler('stream_start', () => {
      // Include provider so the client can label the message bubble correctly
      // even if the user switched providers in settings after sending the message.
      safeSend(ws, { type: 'stream_start', sessionId, provider: providerId });
    });

    addHandler('stream_delta', (d: unknown) => {
      safeSend(ws, { type: 'stream_delta', text: (d as { text: string }).text, sessionId });
    });

    addHandler('thinking_start', () => {
      safeSend(ws, { type: 'thinking_start', sessionId });
    });

    addHandler('thinking_delta', (d: unknown) => {
      safeSend(ws, { type: 'thinking_delta', text: (d as { text: string }).text, sessionId });
    });

    addHandler('thinking_end', () => {
      safeSend(ws, { type: 'thinking_end', sessionId });
    });

    addHandler('tool_use', (d: unknown) => {
      safeSend(ws, { type: 'tool_use', ...(d as Record<string, unknown>), sessionId });
    });

    addHandler('tool_input_delta', (d: unknown) => {
      safeSend(ws, { type: 'tool_input_delta', ...(d as Record<string, unknown>), sessionId });
    });

    addHandler('tool_input_complete', (d: unknown) => {
      safeSend(ws, { type: 'tool_input_complete', ...(d as Record<string, unknown>), sessionId });
    });

    addHandler('control_request', (d: unknown) => {
      safeSend(ws, { type: 'control_request', ...(d as Record<string, unknown>), sessionId });
    });

    addHandler('tool_approved', (d: unknown) => {
      safeSend(ws, { type: 'tool_approved', ...(d as Record<string, unknown>), sessionId });
    });

    addHandler('error', (d: unknown) => {
      safeSend(ws, { type: 'error', ...(d as Record<string, unknown>), sessionId });
    });

    addHandler('stream_end', (d: unknown) => {
      safeSend(ws, { type: 'stream_end', ...(d as Record<string, unknown>), sessionId });
    });

    // Return cleanup function — removes only this WS's listeners
    return () => {
      for (const { event, handler } of listeners) {
        emitter.removeListener(event, handler);
      }
      listeners.length = 0;
    };
  }

  // Keepalive: ping every 30s, terminate if no pong within 10s
  const PING_INTERVAL = 30_000;
  const PONG_TIMEOUT = 10_000;

  wss.on('connection', (ws: WebSocket) => {
    // Track multiple concurrent sessions: sessionId -> cleanup function
    const sessionCleanups = new Map<string, () => void>();
    let alive = true;

    const pingTimer = setInterval(() => {
      if (!alive) {
        ws.terminate();
        return;
      }
      alive = false;
      ws.ping();
    }, PING_INTERVAL);

    ws.on('pong', () => { alive = true; });

    ws.on('close', () => {
      clearInterval(pingTimer);
      for (const cleanup of sessionCleanups.values()) cleanup();
      sessionCleanups.clear();
    });

    ws.on('message', async (raw) => {
      try {
        const data = JSON.parse(raw.toString());

        if (data.type === 'chat') {
          const { prompt, sessionId, claudeSessionId, cwd, model, permissionMode, images, maxOutputTokens, allowedTools, disallowedTools, provider: requestedProvider, personaPrompt } = data;

          if (typeof prompt !== 'string' || !prompt.trim()) {
            safeSend(ws, { type: 'error', error: 'Missing or invalid prompt' });
            return;
          }

          // Resolve provider — validate requested provider, default to 'claude'
          let providerId: ProviderId = 'claude';
          if (typeof requestedProvider === 'string') {
            try {
              getProvider(requestedProvider as ProviderId);
              providerId = requestedProvider as ProviderId;
            } catch {
              safeSend(ws, { type: 'error', error: `Unknown provider: ${requestedProvider}` });
              return;
            }
          }

          const providerInstance = getProvider(providerId);

          // Fail fast with a clear message if the provider isn't configured.
          // We wrap in stream_start/stream_end so the client renders it in a message bubble.
          try {
            const configStatus = await Promise.resolve(providerInstance.isConfigured());
            if (!configStatus.configured) {
              const errMsg = configStatus.reason || `${providerInstance.info.name} is not configured. Open Settings → Providers to set it up.`;
              safeSend(ws, { type: 'stream_start', sessionId: null });
              safeSend(ws, { type: 'error', error: errMsg });
              safeSend(ws, { type: 'stream_end', sessionId: null, claudeSessionId: null });
              return;
            }
          } catch { /* isConfigured() not critical — proceed */ }

          // Always use the validated cwd from client (Viridian's active project)
          // Fall back to home dir only if cwd is invalid/missing
          const projectDir = validateCwd(cwd) || getHomeDir();

          let session = sessionId ? getSession(sessionId) : null;
          // If the session exists but the client switched to a different provider,
          // create a new session (can't switch providers mid-conversation)
          if (session && session.providerId !== providerId) {
            session = null;
          }
          if (!session) {
            session = createSession(projectDir, claudeSessionId || undefined, providerId);
          }

          // Wire emitter for this session (replace if already wired, e.g. new message in same session)
          const existingCleanup = sessionCleanups.get(session.id);
          if (existingCleanup) existingCleanup();
          sessionCleanups.set(session.id, wireEmitter(ws, session.emitter, session.id, session.providerId));

          // Validate model against the provider's available models
          const validModels = providerInstance.models.map(m => m.id);
          const validPermissionModes = providerInstance.capabilities.supportedPermissionModes;

          const msgOptions: SendMessageOptions = {};
          if (typeof model === 'string' && validModels.includes(model)) {
            msgOptions.model = model;
          }
          if (typeof permissionMode === 'string' && validPermissionModes.includes(permissionMode)) {
            msgOptions.permissionMode = permissionMode;
          }
          if (images && Array.isArray(images)) {
            msgOptions.images = images.filter(
              (img: unknown): img is { name: string; dataUrl: string } =>
                typeof img === 'object' && img !== null &&
                typeof (img as Record<string, unknown>).name === 'string' &&
                typeof (img as Record<string, unknown>).dataUrl === 'string',
            );
          }
          if (typeof maxOutputTokens === 'number' && maxOutputTokens > 0 && maxOutputTokens <= 128000) {
            msgOptions.maxOutputTokens = maxOutputTokens;
          }
          if (allowedTools && Array.isArray(allowedTools)) {
            msgOptions.allowedTools = allowedTools.filter((t: unknown): t is string => typeof t === 'string');
          }
          if (disallowedTools && Array.isArray(disallowedTools)) {
            msgOptions.disallowedTools = disallowedTools.filter((t: unknown): t is string => typeof t === 'string');
          }
          // Prepend persona system prompt if provided
          let effectivePrompt = prompt;
          if (typeof personaPrompt === 'string' && personaPrompt.trim()) {
            effectivePrompt = `[System Persona Instructions]\n${personaPrompt.trim()}\n[End Persona Instructions]\n\n${prompt}`;
          }
          sendMessage(session.id, effectivePrompt, msgOptions);
        }

        if (data.type === 'check_session') {
          const { sessionId } = data;
          if (sessionId) {
            const session = getSession(sessionId);
            const streaming = session?.isStreaming ?? false;
            const accumulatedText = streaming ? (session?.accumulatedText ?? '') : undefined;
            // Reply with the client's sessionId so it can match the response,
            // plus the server's internal UUID so the client can match subsequent events
            safeSend(ws, { type: 'session_status', sessionId, serverSessionId: session?.id, claudeSessionId: session?.claudeSessionId, isStreaming: streaming, accumulatedText });
            // If still streaming, re-wire so remaining events reach this new WS
            if (session && streaming) {
              const existingCleanup = sessionCleanups.get(session.id);
              if (existingCleanup) existingCleanup();
              sessionCleanups.set(session.id, wireEmitter(ws, session.emitter, session.id, session.providerId));
              // Re-deliver any control_request that was pending when the WS disconnected.
              // Without this, the client won't have the controlRequestId and can't respond correctly.
              if (session.pendingControlRequest && session.pendingQuestionBuffer !== null) {
                safeSend(ws, { type: 'control_request', ...session.pendingControlRequest, sessionId: session.id });
              }
            }
          }
        }

        if (data.type === 'clear_session') {
          // Client ended a specific session — detach only that session's emitter.
          // If no sessionId specified, clear all (backward compat).
          const targetId = data.sessionId as string | undefined;
          if (targetId) {
            const cleanup = sessionCleanups.get(targetId);
            if (cleanup) { cleanup(); sessionCleanups.delete(targetId); }
          } else {
            for (const cleanup of sessionCleanups.values()) cleanup();
            sessionCleanups.clear();
          }
        }

        if (data.type === 'tool_response') {
          // Use sessionId sent by the client to find the correct session
          const targetSessionId = data.sessionId ? getSession(data.sessionId)?.id : null;
          if (!targetSessionId) {
            log.warn({ clientSessionId: data.sessionId }, 'Received tool_response but no valid session found');
            safeSend(ws, { type: 'error', error: 'Session disconnected. Please try answering again or reload the page.' });
          } else {
            const { requestId, approved, answers, questions } = data;
            respondToPermission(targetSessionId, requestId, approved, answers, questions);
          }
        }

        if (data.type === 'abort') {
          // Use sessionId sent by the client to abort the correct session
          const targetId = data.sessionId ? getSession(data.sessionId)?.id : null;
          if (targetId) {
            abortSession(targetId);
          }
        }
      } catch (err) {
        safeSend(ws, { type: 'error', error: 'Invalid message format' });
      }
    });

    // Session is NOT destroyed on disconnect so it can be resumed via check_session
  });

  return wss;
}

function safeSend(ws: WebSocket, data: unknown) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  } else {
    const d = data as { type?: string; sessionId?: string };
    // Log ALL dropped messages (not just stream_end) to help diagnose missing content
    log.warn({ type: d.type, wsState: ws.readyState, sessionId: d.sessionId }, 'Dropped event — WebSocket not open');
  }
}
