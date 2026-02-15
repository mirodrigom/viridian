import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import { verifyToken } from '../services/auth.js';
import { runGraph, type RunContext } from '../services/graph-runner.js';
import { getDb } from '../db/database.js';

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

    let user: { id: number; username: string };
    try {
      user = verifyToken(token);
    } catch {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      (ws as any)._userId = user.id;
      wss.emit('connection', ws, req);
    });
  });

  // Keepalive: ping every 30s, terminate if no pong within 10s
  const PING_INTERVAL = 30_000;

  wss.on('connection', (ws: WebSocket) => {
    let activeRun: RunContext | null = null;
    let cleanupEvents: (() => void) | null = null;
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
      cleanupEvents?.();
      cleanupEvents = null;
      if (activeRun) {
        activeRun.abortController.abort();
        activeRun = null;
      }
    });

    ws.on('message', (raw) => {
      try {
        const data = JSON.parse(raw.toString());

        if (data.type === 'run_graph') {
          const { graphData, prompt, cwd, graphId } = data;
          if (!graphData || !prompt || !cwd) {
            safeSend(ws, { type: 'error', error: 'Missing graphData, prompt, or cwd' });
            return;
          }

          // Abort any previous run and clean up listeners
          if (activeRun) {
            activeRun.abortController.abort();
          }
          cleanupEvents?.();

          const ctx = runGraph(graphData, prompt, cwd);
          activeRun = ctx;

          // Wire all emitter events to WebSocket (returns cleanup fn)
          const cleanupWs = wireRunEvents(ws, ctx);

          // Persist run to database (returns cleanup fn)
          const userId = (ws as any)._userId as number;
          const cleanupDb = wireRunPersistence(ctx, graphId || null, userId, prompt, cwd);

          cleanupEvents = () => { cleanupWs(); cleanupDb(); };
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

// ─── Run Persistence ────────────────────────────────────────────────────

interface PersistedExecution {
  nodeId: string;
  nodeLabel: string;
  nodeType: string;
  status: string;
  inputPrompt: string;
  outputText: string;
  thinkingText: string;
  toolCalls: { tool: string; input: unknown; requestId: string; status: string }[];
  childExecutionIds: string[];
  parentExecutionId: string | null;
  startedAt: number | null;
  completedAt: number | null;
  error: string | null;
  usage: { inputTokens: number; outputTokens: number };
}

interface PersistedTimelineEntry {
  timestamp: number;
  type: string;
  nodeId: string;
  nodeLabel: string;
  detail: string;
  meta?: { parentNodeId?: string; childNodeId?: string };
}

function wireRunPersistence(
  ctx: RunContext,
  graphId: string | null,
  userId: number,
  prompt: string,
  projectPath: string,
): () => void {
  const { emitter, runId } = ctx;
  const db = getDb();
  const listeners: Array<{ event: string; handler: (...args: unknown[]) => void }> = [];

  function on(event: string, handler: (...args: unknown[]) => void) {
    emitter.on(event, handler);
    listeners.push({ event, handler });
  }

  const timeline: PersistedTimelineEntry[] = [];
  const executions: Record<string, PersistedExecution> = {};
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  // Insert initial row
  db.prepare(
    'INSERT INTO graph_runs (id, graph_id, user_id, project_path, prompt, status) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(runId, graphId, userId, projectPath, prompt, 'running');

  function addTimeline(type: string, nodeId: string, nodeLabel: string, detail: string, meta?: PersistedTimelineEntry['meta']) {
    timeline.push({ timestamp: Date.now(), type, nodeId, nodeLabel, detail, ...(meta ? { meta } : {}) });
  }

  function ensureExec(nodeId: string, nodeLabel: string, nodeType: string, parentNodeId: string | null): PersistedExecution {
    if (!executions[nodeId]) {
      executions[nodeId] = {
        nodeId, nodeLabel, nodeType,
        status: 'pending', inputPrompt: '', outputText: '', thinkingText: '',
        toolCalls: [], childExecutionIds: [], parentExecutionId: parentNodeId,
        startedAt: null, completedAt: null, error: null,
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    }
    return executions[nodeId]!;
  }

  on('node_started', (d: unknown) => {
    const e = d as { nodeId: string; nodeLabel: string; nodeType: string; inputPrompt: string; parentNodeId: string | null };
    const exec = ensureExec(e.nodeId, e.nodeLabel, e.nodeType, e.parentNodeId);
    exec.status = 'running';
    exec.inputPrompt = e.inputPrompt || exec.inputPrompt;
    exec.startedAt = Date.now();
    addTimeline('node_start', e.nodeId, e.nodeLabel, 'Started execution');
  });

  on('node_delegated', (d: unknown) => {
    const e = d as { nodeId: string; nodeLabel: string; nodeType: string; parentNodeId: string; inputPrompt: string };
    const exec = ensureExec(e.nodeId, e.nodeLabel, e.nodeType, e.parentNodeId);
    exec.status = 'delegated';
    exec.inputPrompt = e.inputPrompt;
    exec.startedAt = Date.now();
    const parent = executions[e.parentNodeId];
    if (parent && !parent.childExecutionIds.includes(e.nodeId)) {
      parent.childExecutionIds.push(e.nodeId);
    }
    addTimeline('node_delegated', e.nodeId, e.nodeLabel, 'Delegated');
  });

  on('node_delta', (d: unknown) => {
    const e = d as { nodeId: string; text: string };
    const exec = executions[e.nodeId];
    if (exec) exec.outputText += e.text;
  });

  on('node_thinking_delta', (d: unknown) => {
    const e = d as { nodeId: string; text: string };
    const exec = executions[e.nodeId];
    if (exec) exec.thinkingText += e.text;
  });

  on('node_tool_use', (d: unknown) => {
    const e = d as { nodeId: string; tool: string; input: unknown; requestId: string };
    const exec = executions[e.nodeId];
    if (exec) {
      exec.toolCalls.push({ tool: e.tool, input: e.input, requestId: e.requestId, status: 'running' });
    }
    addTimeline('tool_use', e.nodeId, exec?.nodeLabel ?? e.nodeId, `Tool: ${e.tool}`);
  });

  on('node_completed', (d: unknown) => {
    const e = d as { nodeId: string; outputText: string; usage: { inputTokens: number; outputTokens: number } };
    const exec = executions[e.nodeId];
    if (exec) {
      exec.status = 'completed';
      if (e.outputText) exec.outputText = e.outputText;
      exec.completedAt = Date.now();
      exec.usage = e.usage;
      for (const tc of exec.toolCalls) {
        if (tc.status === 'running') tc.status = 'completed';
      }
      totalInputTokens += e.usage.inputTokens;
      totalOutputTokens += e.usage.outputTokens;
    }
    addTimeline('node_complete', e.nodeId, exec?.nodeLabel ?? e.nodeId, 'Completed');
  });

  on('node_failed', (d: unknown) => {
    const e = d as { nodeId: string; error: string };
    const exec = executions[e.nodeId];
    if (exec) {
      exec.status = 'failed';
      exec.error = e.error;
      exec.completedAt = Date.now();
    }
    addTimeline('node_failed', e.nodeId, exec?.nodeLabel ?? e.nodeId, `Failed: ${e.error}`);
  });

  on('node_skipped', (d: unknown) => {
    const e = d as { nodeId: string; reason: string };
    const exec = executions[e.nodeId];
    if (exec) { exec.status = 'completed'; exec.completedAt = Date.now(); }
    addTimeline('node_skipped', e.nodeId, exec?.nodeLabel ?? e.nodeId, `Skipped: ${e.reason}`);
  });

  on('delegation', (d: unknown) => {
    const e = d as { parentNodeId: string; childNodeId: string; childLabel: string; task: string };
    addTimeline('delegation', e.parentNodeId, e.childLabel,
      `Delegated to ${e.childLabel}: ${e.task.slice(0, 100)}`,
      { parentNodeId: e.parentNodeId, childNodeId: e.childNodeId });
  });

  on('result_return', (d: unknown) => {
    const e = d as { parentNodeId: string; childNodeId: string; childLabel: string; result: string };
    addTimeline('result_return', e.childNodeId, e.childLabel,
      `Returned result (${e.result.length} chars)`,
      { parentNodeId: e.parentNodeId, childNodeId: e.childNodeId });
  });

  // Terminal events — persist final state
  const updateFinal = db.prepare(`
    UPDATE graph_runs
    SET status = ?, final_output = ?, error = ?,
        timeline = ?, executions = ?,
        total_input_tokens = ?, total_output_tokens = ?,
        completed_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);

  on('run_completed', (d: unknown) => {
    const e = d as { runId: string; finalOutput: string };
    updateFinal.run('completed', e.finalOutput, null,
      JSON.stringify(timeline), JSON.stringify(executions),
      totalInputTokens, totalOutputTokens, runId);
  });

  on('run_failed', (d: unknown) => {
    const e = d as { runId: string; error: string };
    updateFinal.run('failed', null, e.error,
      JSON.stringify(timeline), JSON.stringify(executions),
      totalInputTokens, totalOutputTokens, runId);
  });

  on('run_aborted', () => {
    updateFinal.run('aborted', null, null,
      JSON.stringify(timeline), JSON.stringify(executions),
      totalInputTokens, totalOutputTokens, runId);
  });

  return () => {
    for (const { event, handler } of listeners) {
      emitter.removeListener(event, handler);
    }
    listeners.length = 0;
  };
}

// ─── WS Event Forwarding ───────────────────────────────────────────────

function wireRunEvents(ws: WebSocket, ctx: RunContext): () => void {
  const { emitter } = ctx;
  const listeners: Array<{ event: string; handler: (...args: unknown[]) => void }> = [];

  function on(event: string, handler: (...args: unknown[]) => void) {
    emitter.on(event, handler);
    listeners.push({ event, handler });
  }

  on('run_started', (d: unknown) => { safeSend(ws, { type: 'run_started', ...(d as object) }); });
  on('node_started', (d: unknown) => { safeSend(ws, { type: 'node_started', ...(d as object) }); });
  on('node_delta', (d: unknown) => { safeSend(ws, { type: 'node_delta', ...(d as object) }); });
  on('node_thinking_start', (d: unknown) => { safeSend(ws, { type: 'node_thinking_start', ...(d as object) }); });
  on('node_thinking_delta', (d: unknown) => { safeSend(ws, { type: 'node_thinking_delta', ...(d as object) }); });
  on('node_thinking_end', (d: unknown) => { safeSend(ws, { type: 'node_thinking_end', ...(d as object) }); });
  on('node_tool_use', (d: unknown) => { safeSend(ws, { type: 'node_tool_use', ...(d as object) }); });
  on('node_completed', (d: unknown) => { safeSend(ws, { type: 'node_completed', ...(d as object) }); });
  on('node_failed', (d: unknown) => { safeSend(ws, { type: 'node_failed', ...(d as object) }); });
  on('node_error', (d: unknown) => { safeSend(ws, { type: 'node_failed', ...(d as object) }); });
  on('delegation', (d: unknown) => { safeSend(ws, { type: 'delegation', ...(d as object) }); });
  on('result_return', (d: unknown) => { safeSend(ws, { type: 'result_return', ...(d as object) }); });
  on('node_delegated', (d: unknown) => { safeSend(ws, { type: 'node_delegated', ...(d as object) }); });
  on('node_skipped', (d: unknown) => { safeSend(ws, { type: 'node_skipped', ...(d as object) }); });
  on('budget_warning', (d: unknown) => { safeSend(ws, { type: 'budget_warning', ...(d as object) }); });
  on('budget_exceeded', (d: unknown) => { safeSend(ws, { type: 'budget_exceeded', ...(d as object) }); });
  on('run_completed', (d: unknown) => { safeSend(ws, { type: 'run_completed', ...(d as object) }); });
  on('run_failed', (d: unknown) => { safeSend(ws, { type: 'run_failed', ...(d as object) }); });
  on('run_aborted', (d: unknown) => { safeSend(ws, { type: 'run_aborted', ...(d as object) }); });

  return () => {
    for (const { event, handler } of listeners) {
      emitter.removeListener(event, handler);
    }
    listeners.length = 0;
  };
}

function safeSend(ws: WebSocket, data: unknown) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}
