import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import { watch } from 'chokidar';
import { join } from 'path';
import { verifyToken } from '../services/auth.js';

const CLAUDE_DIR = join(process.env.HOME || '/home', '.claude', 'projects');

export function setupSessionsWs(server: Server) {
  const wss = new WebSocketServer({ noServer: true });
  const clients = new Set<WebSocket>();

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    if (url.pathname !== '/ws/sessions') return;

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
      wss.emit('connection', ws);
    });
  });

  wss.on('connection', (ws: WebSocket) => {
    clients.add(ws);
    ws.on('close', () => clients.delete(ws));
  });

  // Watch for JSONL file changes in Claude projects dir
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const watcher = watch(join(CLAUDE_DIR, '**/*.jsonl'), {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
  });

  function broadcast() {
    const msg = JSON.stringify({ type: 'sessions_updated', timestamp: Date.now() });
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    }
  }

  watcher.on('add', () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(broadcast, 1000);
  });

  watcher.on('change', () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(broadcast, 1000);
  });

  watcher.on('unlink', () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(broadcast, 500);
  });

  console.log(`[sessions-ws] Watching ${CLAUDE_DIR} for JSONL changes`);

  return wss;
}
