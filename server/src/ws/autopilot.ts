/**
 * Autopilot WebSocket endpoint — streams dual-agent events to clients.
 * Pattern follows ws/graph-runner.ts.
 */

import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import { verifyToken } from '../services/auth.js';
import { createLogger } from '../logger.js';

const log = createLogger('autopilot-ws');
import {
  startAutopilotRun,
  getActiveRun,
  pauseRun,
  resumeRun,
  abortRun,
  resumeFailedRun,
  type AutopilotContext,
  type AutopilotRunConfig,
} from '../services/autopilot.js';
import { getProfile } from '../services/autopilot-profiles.js';
import { db } from '../db/database.js';
import { safeJsonParse } from '../lib/safeJson.js';

export function setupAutopilotWs(server: Server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    if (url.pathname !== '/ws/autopilot') return;

    const token = url.searchParams.get('token');
    if (!token) {
      socket.destroy();
      return;
    }

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

  // Keepalive
  const PING_INTERVAL = 30_000;

  wss.on('connection', (ws: WebSocket) => {
    const user = (ws as unknown as Record<string, unknown>).__user as { id: number; username: string };
    let activeCtx: AutopilotContext | null = null;
    let cleanupListeners: (() => void) | null = null;
    let alive = true;

    const pingTimer = setInterval(() => {
      if (!alive) { ws.terminate(); return; }
      alive = false;
      ws.ping();
    }, PING_INTERVAL);

    ws.on('pong', () => { alive = true; });

    ws.on('close', () => {
      clearInterval(pingTimer);
      // Clean up emitter listeners for this WS to prevent memory leaks
      if (cleanupListeners) { cleanupListeners(); cleanupListeners = null; }
      // NOTE: we do NOT abort on disconnect — autopilot should keep running in background
    });

    ws.on('message', (raw) => {
      try {
        const data = JSON.parse(raw.toString());
        handleMessage(ws, user, data);
      } catch {
        safeSend(ws, { type: 'error', error: 'Invalid message format' });
      }
    });

    function handleMessage(
      ws: WebSocket,
      user: { id: number; username: string },
      data: Record<string, unknown>,
    ) {
      switch (data.type) {
        case 'start_adhoc': {
          const {
            goalPrompt, agentAProfileId, agentBProfileId,
            agentAModel, agentBModel,
            agentAProvider, agentBProvider,
            cwd, allowedPaths, maxIterations, runTestVerification,
          } = data as Record<string, unknown>;

          if (!goalPrompt || !agentAProfileId || !agentBProfileId || !cwd) {
            safeSend(ws, { type: 'error', error: `Missing required fields: goalPrompt=${!!goalPrompt}, agentA=${!!agentAProfileId}, agentB=${!!agentBProfileId}, cwd=${!!cwd}` });
            return;
          }

          log.info({ cwd, goal: (goalPrompt as string).slice(0, 60) }, 'Starting adhoc run');

          const config: AutopilotRunConfig = {
            userId: user.id,
            projectPath: cwd as string,
            cwd: cwd as string,
            goalPrompt: goalPrompt as string,
            agentAProfileId: agentAProfileId as string,
            agentBProfileId: agentBProfileId as string,
            agentAModel: (agentAModel as string) || undefined,
            agentBModel: (agentBModel as string) || undefined,
            agentAProvider: (agentAProvider as AutopilotRunConfig['agentAProvider']) || undefined,
            agentBProvider: (agentBProvider as AutopilotRunConfig['agentBProvider']) || undefined,
            allowedPaths: (allowedPaths as string[]) || [],
            maxIterations: (maxIterations as number) || 50,
            runTestVerification: runTestVerification !== false,
          };

          startAutopilotRun(config).then((ctx) => {
            activeCtx = ctx;
            if (cleanupListeners) cleanupListeners();
            cleanupListeners = wireAutopilotEvents(ws, ctx);
          }).catch((err: unknown) => {
            safeSend(ws, { type: 'error', error: String(err) });
          });
          break;
        }

        case 'start_run': {
          const { configId, cwd } = data as Record<string, unknown>;
          if (!configId || !cwd) {
            safeSend(ws, { type: 'error', error: 'Missing configId or cwd' });
            return;
          }

          // Load config from DB
          db('autopilot_configs')
            .where({ id: configId, user_id: user.id })
            .first()
            .then((row: Record<string, unknown> | undefined) => {
              if (!row) {
                safeSend(ws, { type: 'error', error: 'Config not found' });
                return;
              }

              const config: AutopilotRunConfig = {
                configId: row.id as string,
                userId: user.id,
                projectPath: row.project_path as string,
                cwd: cwd as string,
                goalPrompt: row.goal_prompt as string,
                agentAProfileId: row.agent_a_profile as string,
                agentBProfileId: row.agent_b_profile as string,
                agentAModel: row.agent_a_model as string,
                agentBModel: row.agent_b_model as string,
                agentAProvider: (row.agent_a_provider as AutopilotRunConfig['agentAProvider']) || undefined,
                agentBProvider: (row.agent_b_provider as AutopilotRunConfig['agentBProvider']) || undefined,
                allowedPaths: safeJsonParse<string[]>(row.allowed_paths as string, []),
                maxIterations: row.max_iterations as number,
                maxTokensPerSession: row.max_tokens_per_session as number,
                runTestVerification: (row.run_test_verification as number) !== 0,
              };

              startAutopilotRun(config).then((ctx) => {
                activeCtx = ctx;
                if (cleanupListeners) cleanupListeners();
                cleanupListeners = wireAutopilotEvents(ws, ctx);
              }).catch((err: unknown) => {
                safeSend(ws, { type: 'error', error: String(err) });
              });
            })
            .catch((err: unknown) => {
              safeSend(ws, { type: 'error', error: String(err) });
            });
          break;
        }

        case 'pause_run': {
          const runId = data.runId as string;
          if (!runId) { safeSend(ws, { type: 'error', error: 'Missing runId' }); return; }
          pauseRun(runId);
          break;
        }

        case 'resume_run': {
          const runId = data.runId as string;
          if (!runId) { safeSend(ws, { type: 'error', error: 'Missing runId' }); return; }

          // Need to rebuild config for resumeRun
          const ctx = getActiveRun(runId);
          if (!ctx) { safeSend(ws, { type: 'error', error: 'Run not found or not paused' }); return; }

          // Load original config
          db('autopilot_runs').where({ id: runId }).first()
            .then(async (runRow: Record<string, unknown> | undefined) => {
              let goalPrompt = '';
              if (runRow?.config_id) {
                const cfgRow = await db('autopilot_configs')
                  .where({ id: runRow.config_id })
                  .select('goal_prompt')
                  .first() as { goal_prompt: string } | undefined;
                goalPrompt = cfgRow?.goal_prompt || '';
              }

              const resumeConfig: AutopilotRunConfig = {
                userId: user.id,
                projectPath: (runRow?.project_path as string) || ctx.cwd,
                cwd: ctx.cwd,
                goalPrompt,
                agentAProfileId: ctx.agentAProfile.id,
                agentBProfileId: ctx.agentBProfile.id,
                allowedPaths: ctx.allowedPaths,
                maxIterations: ctx.maxIterations,
              };

              resumeRun(runId, resumeConfig);
              if (cleanupListeners) cleanupListeners();
              cleanupListeners = wireAutopilotEvents(ws, ctx);
            })
            .catch((err: unknown) => {
              safeSend(ws, { type: 'error', error: String(err) });
            });
          break;
        }

        case 'abort_run': {
          const runId = data.runId as string;
          if (!runId) { safeSend(ws, { type: 'error', error: 'Missing runId' }); return; }
          abortRun(runId);
          break;
        }

        case 'resume_failed_run': {
          const runId = data.runId as string;
          if (!runId) { safeSend(ws, { type: 'error', error: 'Missing runId' }); return; }

          resumeFailedRun(runId, user.id).then((ctx) => {
            activeCtx = ctx;
            if (cleanupListeners) cleanupListeners();
            cleanupListeners = wireAutopilotEvents(ws, ctx);
          }).catch((err: unknown) => {
            safeSend(ws, { type: 'error', error: String(err) });
          });
          break;
        }

        case 'get_run_state': {
          const runId = data.runId as string;
          const ctx = getActiveRun(runId);
          if (ctx) {
            if (cleanupListeners) cleanupListeners();
            cleanupListeners = wireAutopilotEvents(ws, ctx);
            safeSend(ws, {
              type: 'run_state',
              run: {
                runId: ctx.runId,
                status: ctx.status,
                branchName: ctx.branchName,
                cycleCount: ctx.cycleCount,
                commitCount: ctx.commitCount,
                totalTokens: ctx.totalTokens,
                rateLimitedUntil: ctx.rateLimitedUntil,
              },
            });
          } else {
            safeSend(ws, { type: 'error', error: 'Run not found' });
          }
          break;
        }
      }
    }
  });

  return wss;
}

// ─── Event Wiring ───────────────────────────────────────────────────────

/** Wire autopilot emitter events to a WebSocket. Returns a cleanup function to remove listeners. */
function wireAutopilotEvents(ws: WebSocket, ctx: AutopilotContext): () => void {
  const { emitter } = ctx;

  const events = [
    'run_started',
    'cycle_started',
    'cycle_phase_change',
    'agent_a_delta',
    'agent_a_thinking_start',
    'agent_a_thinking_delta',
    'agent_a_thinking_end',
    'agent_a_tool_use',
    'agent_a_complete',
    'agent_b_delta',
    'agent_b_thinking_start',
    'agent_b_thinking_delta',
    'agent_b_thinking_end',
    'agent_b_tool_use',
    'agent_b_complete',
    'commit_made',
    'cycle_completed',
    'rate_limited',
    'rate_limit_cleared',
    'run_paused',
    'run_resumed',
    'run_completed',
    'run_failed',
    'run_aborted',
    'pr_created',
  ];

  // Store references so we can remove them later
  const listeners: Array<{ event: string; handler: (...args: unknown[]) => void }> = [];

  for (const event of events) {
    const handler = (data: unknown) => {
      safeSend(ws, { type: event, ...(data as Record<string, unknown>) });
    };
    emitter.on(event, handler);
    listeners.push({ event, handler });
  }

  // Return cleanup function
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
