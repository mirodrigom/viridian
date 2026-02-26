import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import { watch } from 'chokidar';
import { join } from 'path';
import { verifyToken } from '../services/auth.js';
import { getHomeDir } from '../utils/platform.js';

const CLAUDE_DIR = join(getHomeDir(), '.claude', 'projects');

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

  // Keepalive: ping every 30s
  const PING_INTERVAL = 30_000;

  wss.on('connection', (ws: WebSocket) => {
    clients.add(ws);
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
      clients.delete(ws);
    });
  });

  // Watch for JSONL file changes in Claude projects dir
  // Use directory watch with depth:1 (projectDir/session.jsonl) + polling for reliability
  const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  const watcher = watch(CLAUDE_DIR, {
    ignoreInitial: true,
    depth: 1,
    usePolling: true,
    interval: 2000,
    binaryInterval: 2000,
    awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 300 },
  });

  watcher.on('ready', () => {
    const watched = watcher.getWatched();
    const dirs = Object.keys(watched);
    const fileCount = dirs.reduce((sum, d) => sum + watched[d]!.length, 0);
    console.log(`[sessions-ws] Watcher ready — ${dirs.length} dirs, ${fileCount} files`);
  });

  watcher.on('error', (err: unknown) => {
    console.error(`[sessions-ws] Watcher error:`, err);
  });

  function isJsonlFile(filePath: string): boolean {
    return filePath.endsWith('.jsonl') && !filePath.includes('agent-');
  }

  function broadcastFileChange(filePath: string, eventType: 'change' | 'add' | 'unlink') {
    if (!isJsonlFile(filePath)) return;

    // Extract projectDir and sessionId from the path
    const relative = filePath.replace(CLAUDE_DIR + '/', '');
    const parts = relative.split('/');
    const changedFile = parts.length === 2
      ? { projectDir: parts[0], sessionId: parts[1]!.replace('.jsonl', ''), eventType }
      : undefined;

    console.log(`[sessions-ws] File ${eventType}: ${relative} → broadcast to ${clients.size} clients`, changedFile ? `(project=${changedFile.projectDir}, session=${changedFile.sessionId})` : '(no match)');

    const msg = JSON.stringify({
      type: 'sessions_updated',
      timestamp: Date.now(),
      changedFile,
    });
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    }
  }

  watcher.on('add', (filePath: string) => {
    if (!isJsonlFile(filePath)) return;
    if (debounceTimers.has(filePath)) clearTimeout(debounceTimers.get(filePath)!);
    debounceTimers.set(filePath, setTimeout(() => {
      debounceTimers.delete(filePath);
      broadcastFileChange(filePath, 'add');
    }, 1000));
  });

  watcher.on('change', (filePath: string) => {
    if (!isJsonlFile(filePath)) return;
    if (debounceTimers.has(filePath)) clearTimeout(debounceTimers.get(filePath)!);
    debounceTimers.set(filePath, setTimeout(() => {
      debounceTimers.delete(filePath);
      broadcastFileChange(filePath, 'change');
    }, 500));
  });

  watcher.on('unlink', (filePath: string) => {
    if (!isJsonlFile(filePath)) return;
    if (debounceTimers.has(filePath)) clearTimeout(debounceTimers.get(filePath)!);
    debounceTimers.set(filePath, setTimeout(() => {
      debounceTimers.delete(filePath);
      broadcastFileChange(filePath, 'unlink');
    }, 500));
  });

  console.log(`[sessions-ws] Watching ${CLAUDE_DIR} for JSONL changes`);

  return {
    wss,
    close() {
      for (const timer of debounceTimers.values()) {
        clearTimeout(timer);
      }
      debounceTimers.clear();
      watcher.close();
    },
  };
}
