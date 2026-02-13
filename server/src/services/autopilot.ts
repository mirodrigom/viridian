/**
 * Autopilot Service — orchestrates dual-Claude autonomous collaboration.
 *
 * Agent A (Thinker) analyzes/reviews → Agent B (Doer) implements → auto-commit → loop.
 * Uses EventEmitter pattern (like graph-runner.ts) for real-time streaming to WebSocket.
 */

import { EventEmitter } from 'events';
import { v4 as uuid } from 'uuid';
import { claudeQuery, type SDKMessage } from './claude-sdk.js';
import { getProfile, type AutopilotProfile } from './autopilot-profiles.js';
import { createAutopilotBranch, autoCommit } from './autopilot-git.js';
import { getDb } from '../db/database.js';

// ─── Types ──────────────────────────────────────────────────────────────

export interface AutopilotRunConfig {
  configId?: string;
  userId: number;
  projectPath: string;
  cwd: string;
  goalPrompt: string;
  agentAProfileId: string;
  agentBProfileId: string;
  agentAModel?: string;
  agentBModel?: string;
  allowedPaths: string[];
  maxIterations: number;
  maxTokensPerSession?: number;
  scheduleEndTime?: number | null;  // unix timestamp when this time window closes
}

export interface AutopilotContext {
  runId: string;
  configId: string | null;
  cwd: string;
  emitter: EventEmitter;
  abortController: AbortController;

  // Agent state
  agentAProfile: AutopilotProfile;
  agentBProfile: AutopilotProfile;
  agentASessionId: string | null;  // Claude CLI session ID for --resume
  agentBSessionId: string | null;
  agentAModel: string;
  agentBModel: string;

  // Scope
  allowedPaths: string[];

  // Counters
  cycleCount: number;
  maxIterations: number;
  maxTokens: number;
  totalTokens: {
    agentA: { inputTokens: number; outputTokens: number };
    agentB: { inputTokens: number; outputTokens: number };
  };

  // Git
  branchName: string;
  commitCount: number;

  // Rate limit
  rateLimitedUntil: number | null;

  // Schedule
  scheduleEndTime: number | null;

  // Status
  status: 'running' | 'paused' | 'rate_limited' | 'completed' | 'failed' | 'aborted';
  pauseRequested: boolean;
}

// Track active runs
const activeRuns = new Map<string, AutopilotContext>();

// ─── Startup Cleanup ────────────────────────────────────────────────────

/** Mark any runs left in active states as failed (zombie cleanup after server restart). */
export function cleanupZombieRuns(): void {
  const db = getDb();
  const result = db.prepare(`
    UPDATE autopilot_runs
    SET status = 'failed',
        error = 'Server restarted — run was interrupted',
        completed_at = CURRENT_TIMESTAMP
    WHERE status IN ('running', 'paused', 'rate_limited')
  `).run();
  if (result.changes > 0) {
    console.log(`[Autopilot] Cleaned up ${result.changes} zombie run(s) from previous session`);
  }
}

// ─── Public API ─────────────────────────────────────────────────────────

/** Start an autopilot run. Returns the context immediately; run executes async. */
export function startAutopilotRun(config: AutopilotRunConfig): AutopilotContext {
  const agentAProfile = getProfile(config.agentAProfileId);
  const agentBProfile = getProfile(config.agentBProfileId);
  if (!agentAProfile) throw new Error(`Profile not found: ${config.agentAProfileId}`);
  if (!agentBProfile) throw new Error(`Profile not found: ${config.agentBProfileId}`);

  const ctx: AutopilotContext = {
    runId: uuid(),
    configId: config.configId || null,
    cwd: config.cwd,
    emitter: new EventEmitter(),
    abortController: new AbortController(),
    agentAProfile,
    agentBProfile,
    agentASessionId: null,
    agentBSessionId: null,
    agentAModel: config.agentAModel || agentAProfile.model || 'claude-sonnet-4-20250514',
    agentBModel: config.agentBModel || agentBProfile.model || 'claude-sonnet-4-20250514',
    allowedPaths: config.allowedPaths,
    cycleCount: 0,
    maxIterations: config.maxIterations,
    maxTokens: config.maxTokensPerSession || 500000,
    totalTokens: {
      agentA: { inputTokens: 0, outputTokens: 0 },
      agentB: { inputTokens: 0, outputTokens: 0 },
    },
    branchName: '',
    commitCount: 0,
    rateLimitedUntil: null,
    scheduleEndTime: config.scheduleEndTime || null,
    status: 'running',
    pauseRequested: false,
  };

  activeRuns.set(ctx.runId, ctx);

  // Persist run record
  const db = getDb();
  db.prepare(`
    INSERT INTO autopilot_runs (id, config_id, user_id, project_path, status, agent_a_profile_id, agent_b_profile_id, goal_prompt)
    VALUES (?, ?, ?, ?, 'running', ?, ?, ?)
  `).run(ctx.runId, ctx.configId, config.userId, config.projectPath, config.agentAProfileId, config.agentBProfileId, config.goalPrompt);

  // Start the async loop (fire and forget — events communicate progress)
  runLoop(ctx, config).catch((err) => {
    ctx.status = 'failed';
    ctx.emitter.emit('run_failed', { runId: ctx.runId, error: String(err) });
    updateRunStatus(ctx.runId, 'failed', String(err));
    activeRuns.delete(ctx.runId);
  });

  return ctx;
}

/** Get an active run context */
export function getActiveRun(runId: string): AutopilotContext | undefined {
  return activeRuns.get(runId);
}

/** Request pause (will finish current cycle then pause) */
export function pauseRun(runId: string): boolean {
  const ctx = activeRuns.get(runId);
  if (!ctx || ctx.status !== 'running') return false;
  ctx.pauseRequested = true;
  return true;
}

/** Resume a paused run */
export function resumeRun(runId: string, config: AutopilotRunConfig): boolean {
  const ctx = activeRuns.get(runId);
  if (!ctx || ctx.status !== 'paused') return false;
  ctx.pauseRequested = false;
  ctx.status = 'running';
  ctx.emitter.emit('run_resumed', { runId });
  updateRunStatus(runId, 'running');

  // Resume the loop
  runLoop(ctx, config).catch((err) => {
    ctx.status = 'failed';
    ctx.emitter.emit('run_failed', { runId, error: String(err) });
    updateRunStatus(runId, 'failed', String(err));
    activeRuns.delete(runId);
  });

  return true;
}

/** Abort run immediately */
export function abortRun(runId: string): boolean {
  const ctx = activeRuns.get(runId);
  if (!ctx) return false;
  ctx.status = 'aborted';
  ctx.abortController.abort();
  ctx.emitter.emit('run_aborted', { runId });
  updateRunStatus(runId, 'aborted');
  activeRuns.delete(runId);
  return true;
}

/** Resume a failed/aborted run from where it left off. Reconstructs context from DB. */
export function resumeFailedRun(runId: string, userId: number): AutopilotContext {
  if (activeRuns.has(runId)) throw new Error('Run is already active');

  const db = getDb();

  interface RunRow {
    id: string; config_id: string | null; user_id: number;
    project_path: string; status: string; branch_name: string | null;
    commit_count: number; cycle_count: number;
    agent_a_input_tokens: number; agent_a_output_tokens: number;
    agent_b_input_tokens: number; agent_b_output_tokens: number;
    agent_a_claude_session_id: string | null; agent_b_claude_session_id: string | null;
    agent_a_profile_id: string | null; agent_b_profile_id: string | null;
    goal_prompt: string;
  }

  const row = db.prepare(
    'SELECT * FROM autopilot_runs WHERE id = ? AND user_id = ?',
  ).get(runId, userId) as RunRow | undefined;

  if (!row) throw new Error('Run not found');
  if (!['failed', 'aborted'].includes(row.status)) {
    throw new Error(`Cannot resume run with status "${row.status}"`);
  }

  const agentAProfile = getProfile(row.agent_a_profile_id || '');
  const agentBProfile = getProfile(row.agent_b_profile_id || '');
  if (!agentAProfile || !agentBProfile) throw new Error('Agent profile not found');

  // Determine models from config if available, else profile, else default
  let agentAModel = agentAProfile.model || 'claude-sonnet-4-20250514';
  let agentBModel = agentBProfile.model || 'claude-sonnet-4-20250514';
  let maxIterations = 50;
  let maxTokens = 500000;
  let allowedPaths: string[] = [];

  if (row.config_id) {
    const cfg = db.prepare('SELECT * FROM autopilot_configs WHERE id = ?')
      .get(row.config_id) as Record<string, unknown> | undefined;
    if (cfg) {
      agentAModel = (cfg.agent_a_model as string) || agentAModel;
      agentBModel = (cfg.agent_b_model as string) || agentBModel;
      maxIterations = (cfg.max_iterations as number) || maxIterations;
      maxTokens = (cfg.max_tokens_per_session as number) || maxTokens;
      allowedPaths = JSON.parse((cfg.allowed_paths as string) || '[]');
    }
  }

  const ctx: AutopilotContext = {
    runId,
    configId: row.config_id,
    cwd: row.project_path,
    emitter: new EventEmitter(),
    abortController: new AbortController(),
    agentAProfile,
    agentBProfile,
    agentASessionId: row.agent_a_claude_session_id,
    agentBSessionId: row.agent_b_claude_session_id,
    agentAModel,
    agentBModel,
    allowedPaths,
    cycleCount: row.cycle_count || 0,
    maxIterations,
    maxTokens,
    totalTokens: {
      agentA: { inputTokens: row.agent_a_input_tokens, outputTokens: row.agent_a_output_tokens },
      agentB: { inputTokens: row.agent_b_input_tokens, outputTokens: row.agent_b_output_tokens },
    },
    branchName: row.branch_name || '',
    commitCount: row.commit_count || 0,
    rateLimitedUntil: null,
    scheduleEndTime: null,
    status: 'running',
    pauseRequested: false,
  };

  activeRuns.set(runId, ctx);

  // Update DB status
  db.prepare(
    'UPDATE autopilot_runs SET status = ?, error = NULL, completed_at = NULL WHERE id = ?',
  ).run('running', runId);

  // Build config for the loop
  const config: AutopilotRunConfig = {
    userId,
    projectPath: row.project_path,
    cwd: row.project_path,
    goalPrompt: row.goal_prompt || '',
    agentAProfileId: agentAProfile.id,
    agentBProfileId: agentBProfile.id,
    agentAModel,
    agentBModel,
    allowedPaths,
    maxIterations,
    maxTokensPerSession: maxTokens,
  };

  // Start the loop (fire and forget)
  runLoop(ctx, config).catch((err) => {
    ctx.status = 'failed';
    ctx.emitter.emit('run_failed', { runId, error: String(err) });
    updateRunStatus(runId, 'failed', String(err));
    activeRuns.delete(runId);
  });

  return ctx;
}

// ─── Core Loop ──────────────────────────────────────────────────────────

async function runLoop(ctx: AutopilotContext, config: AutopilotRunConfig): Promise<void> {
  const { emitter, runId } = ctx;

  // Verify cwd exists and is a git repo
  const { existsSync } = await import('fs');
  const { join } = await import('path');
  if (!existsSync(ctx.cwd)) {
    throw new Error(`Directory does not exist: ${ctx.cwd}`);
  }
  if (!existsSync(join(ctx.cwd, '.git'))) {
    throw new Error(`Not a git repository: ${ctx.cwd}`);
  }

  // Create git branch on first run (not on resume)
  if (!ctx.branchName) {
    try {
      console.log(`[Autopilot] Creating branch in: ${ctx.cwd}`);
      ctx.branchName = await createAutopilotBranch(ctx.cwd);
      const db = getDb();
      db.prepare('UPDATE autopilot_runs SET branch_name = ? WHERE id = ?').run(ctx.branchName, runId);
    } catch (err) {
      throw new Error(`Failed to create autopilot branch in ${ctx.cwd}: ${err}`);
    }
  }

  emitter.emit('run_started', {
    runId,
    configId: ctx.configId,
    branchName: ctx.branchName,
    agentAProfile: ctx.agentAProfile,
    agentBProfile: ctx.agentBProfile,
  });

  while (
    ctx.status === 'running' &&
    !ctx.abortController.signal.aborted &&
    ctx.cycleCount < ctx.maxIterations &&
    !isOverTokenBudget(ctx) &&
    !isOutsideScheduleWindow(ctx)
  ) {
    // Check pause request
    if (ctx.pauseRequested) {
      ctx.status = 'paused';
      emitter.emit('run_paused', { runId, reason: 'User requested pause' });
      updateRunStatus(runId, 'paused');
      return; // Exit loop — resumeRun() will re-enter
    }

    const cycleNumber = ctx.cycleCount;
    const cycleId = uuid();

    try {
      await executeCycle(ctx, config, cycleNumber, cycleId);
    } catch (err) {
      const errorMsg = String(err);

      // Check for rate limit
      if (isRateLimitError(errorMsg)) {
        const resetTime = parseRateLimitReset(errorMsg);
        ctx.rateLimitedUntil = resetTime;
        ctx.status = 'rate_limited';
        emitter.emit('rate_limited', { runId, until: resetTime });
        updateRunStatus(runId, 'rate_limited');

        // Wait for rate limit to clear
        const waitMs = Math.max(0, resetTime - Date.now()) + 5000; // +5s buffer
        await sleep(waitMs, ctx.abortController.signal);

        if (ctx.abortController.signal.aborted) break;

        ctx.rateLimitedUntil = null;
        ctx.status = 'running';
        emitter.emit('rate_limit_cleared', { runId });
        updateRunStatus(runId, 'running');
        continue; // Retry the cycle
      }

      // Non-rate-limit error: mark cycle as failed, continue to next cycle
      const db = getDb();
      db.prepare(`
        UPDATE autopilot_cycles SET status = 'failed', completed_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(cycleId);

      emitter.emit('cycle_completed', {
        runId,
        cycleNumber,
        summary: `Cycle failed: ${errorMsg}`,
      });
    }

    ctx.cycleCount++;
  }

  // Determine final status
  if (ctx.abortController.signal.aborted) {
    ctx.status = 'aborted';
  } else if (ctx.status === 'running') {
    ctx.status = 'completed';
  }

  if (ctx.status === 'completed') {
    emitter.emit('run_completed', {
      runId,
      totalCycles: ctx.cycleCount,
      totalCommits: ctx.commitCount,
      summary: `Completed ${ctx.cycleCount} cycles with ${ctx.commitCount} commits`,
    });
    updateRunStatus(runId, 'completed');
  }

  activeRuns.delete(runId);
}

// ─── Single Cycle Execution ─────────────────────────────────────────────

async function executeCycle(
  ctx: AutopilotContext,
  config: AutopilotRunConfig,
  cycleNumber: number,
  cycleId: string,
): Promise<void> {
  const { emitter, runId } = ctx;
  const db = getDb();

  // Insert cycle record
  db.prepare(`
    INSERT INTO autopilot_cycles (id, run_id, cycle_number, status)
    VALUES (?, ?, ?, 'agent_a_running')
  `).run(cycleId, runId, cycleNumber);

  // ── Phase 1: Agent A ──────────────────────────────────────────────────

  const agentAPrompt = buildAgentAPrompt(ctx, config, cycleNumber);

  emitter.emit('cycle_started', { runId, cycleNumber, phase: 'agent_a' });

  const agentAResult = await runAgent(ctx, 'a', agentAPrompt, cycleNumber);

  emitter.emit('agent_a_complete', {
    runId,
    cycleNumber,
    response: agentAResult.response,
    tokens: agentAResult.tokens,
  });

  // Update DB
  db.prepare(`
    UPDATE autopilot_cycles
    SET agent_a_prompt = ?, agent_a_response = ?,
        agent_a_tokens_in = ?, agent_a_tokens_out = ?,
        status = 'agent_b_running'
    WHERE id = ?
  `).run(
    agentAPrompt,
    agentAResult.response,
    agentAResult.tokens.inputTokens,
    agentAResult.tokens.outputTokens,
    cycleId,
  );

  // Check if Agent A signals completion
  if (agentAResult.response.includes('AUTOPILOT_COMPLETE')) {
    db.prepare(`
      UPDATE autopilot_cycles SET status = 'completed', completed_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(cycleId);
    emitter.emit('cycle_completed', { runId, cycleNumber, summary: 'Agent A signaled completion' });
    ctx.status = 'completed'; // Will break the loop
    return;
  }

  // ── Phase 2: Agent B ──────────────────────────────────────────────────

  const agentBPrompt = buildAgentBPrompt(ctx, agentAResult.response);

  emitter.emit('cycle_phase_change', { runId, cycleNumber, phase: 'agent_b' });

  const agentBResult = await runAgent(ctx, 'b', agentBPrompt, cycleNumber);

  emitter.emit('agent_b_complete', {
    runId,
    cycleNumber,
    response: agentBResult.response,
    tokens: agentBResult.tokens,
  });

  // ── Phase 3: Auto-commit ──────────────────────────────────────────────

  const commitMsg = `autopilot: cycle ${cycleNumber + 1} — ${summarize(agentAResult.response, 60)}`;
  const commitResult = await autoCommit(ctx.cwd, ctx.allowedPaths, commitMsg);

  if (commitResult) {
    ctx.commitCount++;
    emitter.emit('commit_made', {
      runId,
      cycleNumber,
      hash: commitResult.hash,
      message: commitResult.message,
      filesChanged: commitResult.filesChanged,
    });

    db.prepare(`
      UPDATE autopilot_cycles
      SET agent_b_prompt = ?, agent_b_response = ?,
          agent_b_tokens_in = ?, agent_b_tokens_out = ?,
          commit_hash = ?, commit_message = ?, files_changed = ?,
          status = 'committed', completed_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      agentBPrompt,
      agentBResult.response,
      agentBResult.tokens.inputTokens,
      agentBResult.tokens.outputTokens,
      commitResult.hash,
      commitResult.message,
      JSON.stringify(commitResult.filesChanged),
      cycleId,
    );

    // Update run counters
    db.prepare(`
      UPDATE autopilot_runs
      SET commit_count = ?, cycle_count = ?,
          agent_a_input_tokens = ?, agent_a_output_tokens = ?,
          agent_b_input_tokens = ?, agent_b_output_tokens = ?
      WHERE id = ?
    `).run(
      ctx.commitCount,
      ctx.cycleCount + 1,
      ctx.totalTokens.agentA.inputTokens,
      ctx.totalTokens.agentA.outputTokens,
      ctx.totalTokens.agentB.inputTokens,
      ctx.totalTokens.agentB.outputTokens,
      runId,
    );
  } else {
    // No files changed — still mark cycle as completed
    db.prepare(`
      UPDATE autopilot_cycles
      SET agent_b_prompt = ?, agent_b_response = ?,
          agent_b_tokens_in = ?, agent_b_tokens_out = ?,
          status = 'completed', completed_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      agentBPrompt,
      agentBResult.response,
      agentBResult.tokens.inputTokens,
      agentBResult.tokens.outputTokens,
      cycleId,
    );
  }

  emitter.emit('cycle_completed', {
    runId,
    cycleNumber,
    summary: commitResult
      ? `Committed ${commitResult.filesChanged.length} files: ${commitResult.message}`
      : 'Cycle completed (no file changes)',
  });
}

// ─── Agent Execution ────────────────────────────────────────────────────

interface AgentResult {
  response: string;
  tokens: { inputTokens: number; outputTokens: number };
}

async function runAgent(
  ctx: AutopilotContext,
  agent: 'a' | 'b',
  prompt: string,
  cycleNumber: number,
): Promise<AgentResult> {
  const profile = agent === 'a' ? ctx.agentAProfile : ctx.agentBProfile;
  const model = agent === 'a' ? ctx.agentAModel : ctx.agentBModel;
  const sessionId = agent === 'a' ? ctx.agentASessionId : ctx.agentBSessionId;

  const scopeInstructions = ctx.allowedPaths.length > 0
    ? `\n\n## SCOPE RESTRICTION\nYou may ONLY read and modify files within these paths:\n${ctx.allowedPaths.map(p => `- ${p}`).join('\n')}\nDo NOT access files outside this scope.`
    : '';

  const appendPrompt = `${scopeInstructions}\n\nYou are working autonomously as part of an autopilot system. Be concise and action-oriented.`;

  let response = '';
  let inputTokens = 0;
  let outputTokens = 0;

  const deltaEvent = agent === 'a' ? 'agent_a_delta' : 'agent_b_delta';
  const thinkStartEvent = agent === 'a' ? 'agent_a_thinking_start' : 'agent_b_thinking_start';
  const thinkDeltaEvent = agent === 'a' ? 'agent_a_thinking_delta' : 'agent_b_thinking_delta';
  const thinkEndEvent = agent === 'a' ? 'agent_a_thinking_end' : 'agent_b_thinking_end';
  const toolUseEvent = agent === 'a' ? 'agent_a_tool_use' : 'agent_b_tool_use';

  for await (const msg of claudeQuery({
    prompt,
    cwd: ctx.cwd,
    model,
    systemPrompt: profile.systemPrompt,
    appendSystemPrompt: appendPrompt,
    allowedTools: profile.allowedTools.length > 0 ? profile.allowedTools : undefined,
    disallowedTools: profile.disallowedTools.length > 0 ? profile.disallowedTools : undefined,
    sessionId: sessionId || undefined,
    abortSignal: ctx.abortController.signal,
    permissionMode: 'bypassPermissions',
  })) {
    switch (msg.type) {
      case 'text_delta':
        if (!msg.parentToolUseId) {
          response += msg.text;
          ctx.emitter.emit(deltaEvent, {
            runId: ctx.runId,
            cycleNumber,
            text: msg.text,
          });
        }
        break;

      case 'thinking_start':
        if (!msg.parentToolUseId) {
          ctx.emitter.emit(thinkStartEvent, { runId: ctx.runId, cycleNumber });
        }
        break;

      case 'thinking_delta':
        if (!msg.parentToolUseId) {
          ctx.emitter.emit(thinkDeltaEvent, {
            runId: ctx.runId,
            cycleNumber,
            text: msg.text,
          });
        }
        break;

      case 'thinking_end':
        if (!msg.parentToolUseId) {
          ctx.emitter.emit(thinkEndEvent, { runId: ctx.runId, cycleNumber });
        }
        break;

      case 'tool_use':
        if (!msg.parentToolUseId) {
          ctx.emitter.emit(toolUseEvent, {
            runId: ctx.runId,
            cycleNumber,
            tool: msg.tool,
            input: msg.input,
            requestId: msg.requestId,
          });
        }
        break;

      case 'message_start':
        if (msg.inputTokens) inputTokens = msg.inputTokens;
        if (msg.cacheCreationInputTokens) inputTokens += msg.cacheCreationInputTokens;
        if (msg.cacheReadInputTokens) inputTokens += msg.cacheReadInputTokens;
        break;

      case 'message_delta':
        if (msg.outputTokens) outputTokens = msg.outputTokens;
        break;

      case 'result':
        // Capture session ID for --resume
        if (msg.sessionId) {
          if (agent === 'a') {
            ctx.agentASessionId = msg.sessionId;
            const db = getDb();
            db.prepare('UPDATE autopilot_runs SET agent_a_claude_session_id = ? WHERE id = ?')
              .run(msg.sessionId, ctx.runId);
          } else {
            ctx.agentBSessionId = msg.sessionId;
            const db = getDb();
            db.prepare('UPDATE autopilot_runs SET agent_b_claude_session_id = ? WHERE id = ?')
              .run(msg.sessionId, ctx.runId);
          }
        }
        break;

      case 'error':
        throw new Error(msg.error);
    }
  }

  // Accumulate tokens
  if (agent === 'a') {
    ctx.totalTokens.agentA.inputTokens += inputTokens;
    ctx.totalTokens.agentA.outputTokens += outputTokens;
  } else {
    ctx.totalTokens.agentB.inputTokens += inputTokens;
    ctx.totalTokens.agentB.outputTokens += outputTokens;
  }

  return { response, tokens: { inputTokens, outputTokens } };
}

// ─── Prompt Builders ────────────────────────────────────────────────────

function buildAgentAPrompt(
  ctx: AutopilotContext,
  config: AutopilotRunConfig,
  cycleNumber: number,
): string {
  if (cycleNumber === 0) {
    return `## Goal\n${config.goalPrompt}\n\n## Instructions\nAnalyze the project and suggest the first improvement to achieve this goal. Focus on ONE specific, actionable suggestion.`;
  }

  // Get last cycle's Agent B response from DB
  const db = getDb();
  const lastCycle = db.prepare(`
    SELECT agent_b_response, commit_message, files_changed
    FROM autopilot_cycles
    WHERE run_id = ? AND cycle_number = ?
    ORDER BY cycle_number DESC LIMIT 1
  `).get(ctx.runId, cycleNumber - 1) as {
    agent_b_response: string;
    commit_message: string | null;
    files_changed: string | null;
  } | undefined;

  const context = lastCycle
    ? `## Previous Cycle Results\n${lastCycle.commit_message ? `Commit: ${lastCycle.commit_message}` : 'No commit made'}\n${lastCycle.files_changed ? `Files changed: ${lastCycle.files_changed}` : ''}\n\nExecutor's response:\n${lastCycle.agent_b_response?.slice(0, 2000) || 'No response'}`
    : '';

  return `## Goal\n${config.goalPrompt}\n\n${context}\n\n## Instructions\nReview the changes made in the previous cycle. Then suggest the NEXT improvement to continue achieving the goal. Focus on ONE specific, actionable suggestion.\n\nIf you believe the goal has been sufficiently achieved, respond with: "AUTOPILOT_COMPLETE: No more improvements needed."`;
}

function buildAgentBPrompt(ctx: AutopilotContext, agentAResponse: string): string {
  return `## Task from Analyst\n${agentAResponse}\n\n## Instructions\nImplement the suggested change. Be thorough but focused. After making changes, provide a brief summary of what was modified and why.`;
}

// ─── Helpers ────────────────────────────────────────────────────────────

function isOverTokenBudget(ctx: AutopilotContext): boolean {
  const total =
    ctx.totalTokens.agentA.inputTokens + ctx.totalTokens.agentA.outputTokens +
    ctx.totalTokens.agentB.inputTokens + ctx.totalTokens.agentB.outputTokens;
  return total >= ctx.maxTokens;
}

function isOutsideScheduleWindow(ctx: AutopilotContext): boolean {
  if (!ctx.scheduleEndTime) return false;
  return Date.now() > ctx.scheduleEndTime;
}

function isRateLimitError(error: string): boolean {
  return /rate.?limit|overloaded|too many requests|429/i.test(error);
}

function parseRateLimitReset(error: string): number {
  // Try to extract reset time from error message
  const match = error.match(/resets?\s+(\w+\s+\d{1,2},?\s+\d{1,2}(?::\d{2})?\s*(?:am|pm))/i);
  if (match) {
    try {
      const resetDate = new Date(match[1]!);
      if (!isNaN(resetDate.getTime())) return resetDate.getTime();
    } catch { /* fallback */ }
  }
  // Default: wait 5 minutes
  return Date.now() + 5 * 60 * 1000;
}

function summarize(text: string, maxLen: number): string {
  const firstLine = text.split('\n').find(l => l.trim().length > 0) || text;
  const clean = firstLine.replace(/^#+\s*/, '').trim();
  return clean.length > maxLen ? clean.slice(0, maxLen - 3) + '...' : clean;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    if (signal) {
      const onAbort = () => {
        clearTimeout(timer);
        reject(new Error('Aborted'));
      };
      if (signal.aborted) { onAbort(); return; }
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

function updateRunStatus(runId: string, status: string, error?: string): void {
  const db = getDb();
  if (error) {
    db.prepare('UPDATE autopilot_runs SET status = ?, error = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(status, error, runId);
  } else if (status === 'completed' || status === 'aborted') {
    db.prepare('UPDATE autopilot_runs SET status = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(status, runId);
  } else if (status === 'paused') {
    db.prepare('UPDATE autopilot_runs SET status = ?, paused_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(status, runId);
  } else {
    db.prepare('UPDATE autopilot_runs SET status = ? WHERE id = ?').run(status, runId);
  }
}
