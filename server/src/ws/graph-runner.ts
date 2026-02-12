import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import { verifyToken } from '../services/auth.js';
import { runGraph, type RunContext } from '../services/graph-runner.js';

export function setupGraphRunnerWs(server: Server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    if (url.pathname !== '/ws/graph-runner') return;

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

  // Keepalive: ping every 30s, terminate if no pong within 10s
  const PING_INTERVAL = 30_000;

  wss.on('connection', (ws: WebSocket) => {
    let activeRun: RunContext | null = null;
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
      // Abort any active run when client disconnects
      if (activeRun) {
        activeRun.abortController.abort();
        activeRun = null;
      }
    });

    ws.on('message', (raw) => {
      try {
        const data = JSON.parse(raw.toString());

        if (data.type === 'run_graph') {
          const { graphData, prompt, cwd } = data;
          if (!graphData || !prompt || !cwd) {
            safeSend(ws, { type: 'error', error: 'Missing graphData, prompt, or cwd' });
            return;
          }

          // Abort any previous run
          if (activeRun) {
            activeRun.abortController.abort();
          }

          const ctx = runGraph(graphData, prompt, cwd);
          activeRun = ctx;

          // Wire all emitter events to WebSocket
          wireRunEvents(ws, ctx);
        }

        if (data.type === 'abort_run') {
          if (activeRun) {
            activeRun.abortController.abort();
            activeRun = null;
          }
        }
      } catch (err) {
        safeSend(ws, { type: 'error', error: 'Invalid message format' });
      }
    });
  });

  return wss;
}

function wireRunEvents(ws: WebSocket, ctx: RunContext) {
  const { emitter } = ctx;

  emitter.on('run_started', (d: { runId: string; rootNodeId: string }) => {
    safeSend(ws, { type: 'run_started', ...d });
  });

  emitter.on('node_started', (d: { nodeId: string; nodeLabel: string; nodeType: string; inputPrompt: string; parentNodeId: string | null }) => {
    safeSend(ws, { type: 'node_started', ...d });
  });

  emitter.on('node_delta', (d: { nodeId: string; text: string }) => {
    safeSend(ws, { type: 'node_delta', ...d });
  });

  emitter.on('node_thinking_start', (d: { nodeId: string }) => {
    safeSend(ws, { type: 'node_thinking_start', ...d });
  });

  emitter.on('node_thinking_delta', (d: { nodeId: string; text: string }) => {
    safeSend(ws, { type: 'node_thinking_delta', ...d });
  });

  emitter.on('node_thinking_end', (d: { nodeId: string }) => {
    safeSend(ws, { type: 'node_thinking_end', ...d });
  });

  emitter.on('node_tool_use', (d: { nodeId: string; tool: string; input: unknown; requestId: string }) => {
    safeSend(ws, { type: 'node_tool_use', ...d });
  });

  emitter.on('node_completed', (d: { nodeId: string; outputText: string; usage: { inputTokens: number; outputTokens: number } }) => {
    safeSend(ws, { type: 'node_completed', ...d });
  });

  emitter.on('node_failed', (d: { nodeId: string; error: string }) => {
    safeSend(ws, { type: 'node_failed', ...d });
  });

  emitter.on('node_error', (d: { nodeId: string; error: string }) => {
    safeSend(ws, { type: 'node_failed', ...d });
  });

  emitter.on('delegation', (d: { parentNodeId: string; childNodeId: string; childLabel: string; task: string }) => {
    safeSend(ws, { type: 'delegation', ...d });
  });

  emitter.on('result_return', (d: { parentNodeId: string; childNodeId: string; childLabel: string; result: string }) => {
    safeSend(ws, { type: 'result_return', ...d });
  });

  emitter.on('run_completed', (d: { runId: string; finalOutput: string }) => {
    safeSend(ws, { type: 'run_completed', ...d });
  });

  emitter.on('run_failed', (d: { runId: string; error: string }) => {
    safeSend(ws, { type: 'run_failed', ...d });
  });

  emitter.on('run_aborted', (d: { runId: string }) => {
    safeSend(ws, { type: 'run_aborted', ...d });
  });
}

function safeSend(ws: WebSocket, data: unknown) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}
