/**
 * Traces WebSocket endpoint — pushes real-time trace events to clients.
 * Emits 'trace:started' and 'trace:ended' so the client can refresh immediately
 * instead of relying on polling.
 */
import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import { verifyToken } from '../services/auth.js';
import { traceEmitter } from '../services/langfuse.js';

function safeSend(ws: WebSocket, data: unknown) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}

export function setupTracesWs(server: Server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    if (url.pathname !== '/ws/traces') return;

    const token = url.searchParams.get('token');
    if (!token) { socket.destroy(); return; }

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

  const PING_INTERVAL = 30_000;

  wss.on('connection', (ws: WebSocket) => {
    let alive = true;
    const pingTimer = setInterval(() => {
      if (!alive) { ws.terminate(); return; }
      alive = false;
      ws.ping();
    }, PING_INTERVAL);

    ws.on('pong', () => { alive = true; });

    function onTraceStarted(data: Record<string, unknown>) {
      safeSend(ws, { type: 'trace:started', ...data });
    }
    function onTraceEnded(data: Record<string, unknown>) {
      safeSend(ws, { type: 'trace:ended', ...data });
    }

    traceEmitter.on('trace:started', onTraceStarted);
    traceEmitter.on('trace:ended', onTraceEnded);

    ws.on('close', () => {
      clearInterval(pingTimer);
      traceEmitter.off('trace:started', onTraceStarted);
      traceEmitter.off('trace:ended', onTraceEnded);
    });
  });
}
