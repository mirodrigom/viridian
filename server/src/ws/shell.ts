import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import { verifyToken } from '../services/auth.js';
import { createTerminal, resizeTerminal, writeTerminal, destroyTerminal } from '../services/terminal.js';
import { getHomeDir } from '../utils/platform.js';
import { createLogger } from '../logger.js';

const log = createLogger('shell-ws');

export function setupShellWs(server: Server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    if (url.pathname !== '/ws/shell') return;

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

  wss.on('connection', async (ws: WebSocket, req) => {
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const cwd = url.searchParams.get('cwd') || getHomeDir();

    let session: Awaited<ReturnType<typeof createTerminal>>;
    try {
      session = await createTerminal(cwd);
    } catch (err) {
      log.error({ err, cwd }, 'Failed to create terminal session');
      safeSend(ws, { type: 'error', message: 'Failed to create terminal session' });
      ws.close();
      return;
    }
    if (!session) {
      safeSend(ws, { type: 'error', message: 'Terminal not available (node-pty not installed or shell not found)' });
      ws.close();
      return;
    }

    // Send terminal ID to client
    safeSend(ws, { type: 'terminal_ready', id: session.id });

    // Pipe PTY output to WebSocket
    session.pty.onData((data: string) => {
      safeSend(ws, { type: 'output', data });
    });

    session.pty.onExit(({ exitCode }) => {
      safeSend(ws, { type: 'exit', exitCode });
    });

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());

        if (msg.type === 'input' && typeof msg.data === 'string') {
          writeTerminal(session.id, msg.data);
        } else if (msg.type === 'resize' && typeof msg.cols === 'number' && typeof msg.rows === 'number') {
          resizeTerminal(session.id, msg.cols, msg.rows);
        }
      } catch {
        // Raw text input (fallback)
        writeTerminal(session.id, raw.toString());
      }
    });

    ws.on('close', () => {
      destroyTerminal(session.id);
    });
  });

  return wss;
}

function safeSend(ws: WebSocket, data: unknown) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}
