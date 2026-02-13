import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import { verifyToken } from '../services/auth.js';
import { createSession, getSession, sendMessage, abortSession, isSessionStreaming, getSessionAccumulatedText, type SendMessageOptions } from '../services/claude.js';

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

  /** Wire up a session's EventEmitter to forward events to the WebSocket client. */
  function wireEmitter(ws: WebSocket, emitter: import('events').EventEmitter) {
    emitter.removeAllListeners();

    emitter.on('stream_start', () => {
      safeSend(ws, { type: 'stream_start' });
    });

    emitter.on('stream_delta', (d: { text: string }) => {
      safeSend(ws, { type: 'stream_delta', text: d.text });
    });

    emitter.on('thinking_start', () => {
      safeSend(ws, { type: 'thinking_start' });
    });

    emitter.on('thinking_delta', (d: { text: string }) => {
      safeSend(ws, { type: 'thinking_delta', text: d.text });
    });

    emitter.on('thinking_end', () => {
      safeSend(ws, { type: 'thinking_end' });
    });

    emitter.on('tool_use', (d: { tool: string; input: unknown; requestId: string }) => {
      safeSend(ws, { type: 'tool_use', ...d });
    });

    emitter.on('tool_input_delta', (d: { requestId: string; tool: string; partialJson: string; accumulatedJson: string }) => {
      safeSend(ws, { type: 'tool_input_delta', ...d });
    });

    emitter.on('tool_input_complete', (d: { requestId: string; tool: string; input: unknown }) => {
      safeSend(ws, { type: 'tool_input_complete', ...d });
    });

    emitter.on('error', (d: { error: string }) => {
      safeSend(ws, { type: 'error', ...d });
    });

    emitter.on('stream_end', (d: { sessionId: string; claudeSessionId?: string; usage?: { input_tokens: number; output_tokens: number } }) => {
      safeSend(ws, { type: 'stream_end', ...d });
    });
  }

  // Keepalive: ping every 30s, terminate if no pong within 10s
  const PING_INTERVAL = 30_000;
  const PONG_TIMEOUT = 10_000;

  wss.on('connection', (ws: WebSocket) => {
    let currentSessionId: string | null = null;
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
    });

    ws.on('message', (raw) => {
      try {
        const data = JSON.parse(raw.toString());

        if (data.type === 'chat') {
          const { prompt, sessionId, claudeSessionId, cwd, model, permissionMode, images, maxOutputTokens, allowedTools, disallowedTools } = data;
          const projectDir = cwd || process.env.HOME || '/home';

          let session = sessionId ? getSession(sessionId) : null;
          if (!session) {
            session = createSession(projectDir, claudeSessionId || undefined);
          }
          currentSessionId = session.id;

          wireEmitter(ws, session.emitter);

          const msgOptions: SendMessageOptions = {};
          if (model) msgOptions.model = model;
          if (permissionMode) msgOptions.permissionMode = permissionMode;
          if (images && Array.isArray(images)) {
            msgOptions.images = images as { name: string; dataUrl: string }[];
          }
          if (maxOutputTokens && typeof maxOutputTokens === 'number') {
            msgOptions.maxOutputTokens = maxOutputTokens;
          }
          if (allowedTools && Array.isArray(allowedTools)) {
            msgOptions.allowedTools = allowedTools as string[];
          }
          if (disallowedTools && Array.isArray(disallowedTools)) {
            msgOptions.disallowedTools = disallowedTools as string[];
          }
          sendMessage(session.id, prompt, msgOptions);
        }

        if (data.type === 'check_session') {
          const { sessionId } = data;
          if (sessionId) {
            const session = getSession(sessionId);
            const streaming = session ? isSessionStreaming(sessionId) : false;
            const accumulatedText = streaming ? getSessionAccumulatedText(sessionId) : undefined;
            safeSend(ws, { type: 'session_status', sessionId, isStreaming: streaming, accumulatedText });
            // If still streaming, re-wire so remaining events reach this new WS
            if (session && streaming) {
              currentSessionId = sessionId;
              wireEmitter(ws, session.emitter);
            }
          }
        }

        if (data.type === 'abort' && currentSessionId) {
          abortSession(currentSessionId);
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
  }
}
