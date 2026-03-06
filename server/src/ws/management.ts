/**
 * Management WebSocket endpoint — streams service process output and status.
 */
import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import { verifyToken } from '../services/auth.js';
import { projectEmitter } from '../services/project-manager.js';
import { createLogger } from '../logger.js';

const log = createLogger('management-ws');

function safeSend(ws: WebSocket, data: unknown) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}

export function setupManagementWs(server: Server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    if (url.pathname !== '/ws/management') return;

    const token = url.searchParams.get('token');
    if (!token) { socket.destroy(); return; }

    let user: { id: number; username: string };
    try {
      user = verifyToken(token) as { id: number; username: string };
    } catch {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      (ws as unknown as Record<string, unknown>).__user = user;
      wss.emit('connection', ws, req);
    });
  });

  const PING_INTERVAL = 30_000;

  wss.on('connection', (ws: WebSocket) => {
    // Management WS broadcasts ALL service events (user already authenticated)
    let alive = true;
    const pingTimer = setInterval(() => {
      if (!alive) { ws.terminate(); return; }
      alive = false;
      ws.ping();
    }, PING_INTERVAL);

    ws.on('pong', () => { alive = true; });

    function onServiceStatus(data: Record<string, unknown>) {
      safeSend(ws, { type: 'service_status', ...data });
    }
    function onServiceOutput(data: Record<string, unknown>) {
      safeSend(ws, { type: 'service_output', ...data });
    }

    projectEmitter.on('service:status', onServiceStatus);
    projectEmitter.on('service:output', onServiceOutput);

    ws.on('close', () => {
      clearInterval(pingTimer);
      projectEmitter.off('service:status', onServiceStatus);
      projectEmitter.off('service:output', onServiceOutput);
    });
  });
}
