import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import { verifyToken } from '../services/auth.js';
import { createSession, getSession, sendMessage, abortSession, type SendMessageOptions } from '../services/claude.js';

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

  wss.on('connection', (ws: WebSocket) => {
    let currentSessionId: string | null = null;

    ws.on('message', (raw) => {
      try {
        const data = JSON.parse(raw.toString());

        if (data.type === 'chat') {
          const { prompt, sessionId, cwd, model, permissionMode } = data;
          const projectDir = cwd || process.env.HOME || '/home';

          let session = sessionId ? getSession(sessionId) : null;
          if (!session) {
            session = createSession(projectDir);
          }
          currentSessionId = session.id;

          // Wire up events to WebSocket
          const emitter = session.emitter;
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

          emitter.on('stream_end', (d: { sessionId: string; claudeSessionId?: string }) => {
            safeSend(ws, { type: 'stream_end', ...d });
          });

          const msgOptions: SendMessageOptions = {};
          if (model) msgOptions.model = model;
          if (permissionMode) msgOptions.permissionMode = permissionMode;
          sendMessage(session.id, prompt, msgOptions);
        }

        if (data.type === 'abort' && currentSessionId) {
          abortSession(currentSessionId);
        }
      } catch (err) {
        safeSend(ws, { type: 'error', error: 'Invalid message format' });
      }
    });

    ws.on('close', () => {
      // Don't destroy session on disconnect so it can be resumed
    });
  });

  return wss;
}

function safeSend(ws: WebSocket, data: unknown) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}
