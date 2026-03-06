/**
 * Projects WebSocket endpoint — streams process status and output to clients.
 */

import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import { verifyToken } from '../services/auth.js';
import { projectEmitter } from '../services/project-manager.js';
import { createLogger } from '../logger.js';

const log = createLogger('projects-ws');

function safeSend(ws: WebSocket, data: unknown) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

export function setupProjectsWs(server: Server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    if (url.pathname !== '/ws/projects') return;

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
    const subscribedProjects = new Set<string>();
    let alive = true;

    const pingTimer = setInterval(() => {
      if (!alive) { ws.terminate(); return; }
      alive = false;
      ws.ping();
    }, PING_INTERVAL);

    ws.on('pong', () => { alive = true; });

    function onServiceStatus(data: Record<string, unknown>) {
      if (subscribedProjects.has(data.projectId as string)) {
        safeSend(ws, { type: 'service_status', ...data });
      }
    }

    function onServiceOutput(data: Record<string, unknown>) {
      if (subscribedProjects.has(data.projectId as string)) {
        safeSend(ws, { type: 'service_output', ...data });
      }
    }

    function onAgentStatus(data: Record<string, unknown>) {
      if (subscribedProjects.has(data.projectId as string)) {
        safeSend(ws, { type: 'agent_status', ...data });
      }
    }

    projectEmitter.on('service:status', onServiceStatus);
    projectEmitter.on('service:output', onServiceOutput);
    projectEmitter.on('agent:status', onAgentStatus);

    ws.on('close', () => {
      clearInterval(pingTimer);
      projectEmitter.off('service:status', onServiceStatus);
      projectEmitter.off('service:output', onServiceOutput);
      projectEmitter.off('agent:status', onAgentStatus);
    });

    ws.on('message', (raw) => {
      try {
        const data = JSON.parse(raw.toString()) as { type: string; projectId?: string };
        if (data.type === 'subscribe' && data.projectId) {
          subscribedProjects.add(data.projectId);
        } else if (data.type === 'unsubscribe' && data.projectId) {
          subscribedProjects.delete(data.projectId);
        }
      } catch { /* ignore malformed messages */ }
    });
  });
}
