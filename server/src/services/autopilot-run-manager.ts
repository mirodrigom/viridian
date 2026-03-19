/**
 * Autopilot Run Manager — run lifecycle management and orchestration.
 *
 * Handles run lifecycle (start, pause, resume, abort), database persistence, and active session management.
 */

import { EventEmitter } from 'events';
import { v4 as uuid } from 'uuid';
import { getProfile, type AutopilotProfile } from './autopilot-profiles.js';
import { createAutopilotBranch, pushAndCreatePR } from './autopilot-git.js';
import { db } from '../db/database.js';
import { safeJsonParse } from '../lib/safeJson.js';
import { executeCycle } from './autopilot-cycle-executor.js';
import { executeTestCycle } from './autopilot-test-verifier.js';
import {
  isOverTokenBudget,
  isOutsideScheduleWindow,
  isRateLimitError,
  parseRateLimitReset
} from './autopilot-validators.js';
import type { ProviderId } from '../providers/types.js';
import { createLogger } from '../logger.js';

const log = createLogger('autopilot-run-manager');

// ─── Types ──────────────────────────────────────────────────────────────────

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
  agentAProvider?: ProviderId;
  agentBProvider?: ProviderId;
  allowedPaths: string[];
  maxIterations: number;
  maxTokensPerSession?: number;
  scheduleEndTime?: number | null;  // unix timestamp when this time window closes
  runTestVerification?: boolean;    // run test verification cycle after regular cycles (default true)
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
  agentASessionId: string | null;  // CLI session ID for --resume
  agentBSessionId: string | null;
  agentAModel: string;
  agentBModel: string;
  agentAProvider: ProviderId;
  agentBProvider: ProviderId;

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

  // Test verification
  runTestVerification: boolean;

  // Status
  status: 'running' | 'paused' | 'rate_limited' | 'completed' | 'failed' | 'aborted';
  pauseRequested: boolean;
}

// ─── Active Runs Management ─────────────────────────────────────────────────

const activeRuns = new Map<string, AutopilotContext>();

// ─── Startup Cleanup ────────────────────────────────────────────────────────

/** Mark any runs left in active states as failed (zombie cleanup after server restart). */
export async function cleanupZombieRuns(): Promise<void> {
  const count = await db('autopilot_runs')
    .whereIn('status', ['running', 'paused', 'rate_limited'])
    .update({
      status: 'failed',
      error: 'Server restarted — run was interrupted',
      completed_at: db.fn.now(),
    });
  if (count > 0) {
    log.info({ count }, 'Cleaned up zombie run(s) from previous session');
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

/** Start an autopilot run. Returns the context immediately; run executes async. */
export async function startAutopilotRun(config: AutopilotRunConfig): Promise<AutopilotContext> {
  const agentAProfile = await getProfile(config.agentAProfileId);
  const agentBProfile = await getProfile(config.agentBProfileId);
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
    agentAModel: config.agentAModel || agentAProfile.model || 'claude-sonnet-4-6',
    agentBModel: config.agentBModel || agentBProfile.model || 'claude-sonnet-4-6',
    agentAProvider: config.agentAProvider || 'claude',
    agentBProvider: config.agentBProvider || 'claude',
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
    runTestVerification: config.runTestVerification !== false,
    status: 'running',
    pauseRequested: false,
  };

  activeRuns.set(ctx.runId, ctx);

  // Persist run record
  await db('autopilot_runs').insert({
    id: ctx.runId,
    config_id: ctx.configId,
    user_id: config.userId,
    project_path: config.projectPath,
    status: 'running',
    agent_a_profile_id: config.agentAProfileId,
    agent_b_profile_id: config.agentBProfileId,
    goal_prompt: config.goalPrompt,
    agent_a_provider: ctx.agentAProvider,
    agent_b_provider: ctx.agentBProvider,
  });

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
export async function resumeFailedRun(runId: string, userId: number): Promise<AutopilotContext> {
  if (activeRuns.has(runId)) throw new Error('Run is already active');

  interface RunRow {
    id: string; config_id: string | null; user_id: number;
    project_path: string; status: string; branch_name: string | null;
    commit_count: number; cycle_count: number;
    agent_a_input_tokens: number; agent_a_output_tokens: number;
    agent_b_input_tokens: number; agent_b_output_tokens: number;
    agent_a_claude_session_id: string | null; agent_b_claude_session_id: string | null;
    agent_a_profile_id: string | null; agent_b_profile_id: string | null;
    agent_a_provider: string | null; agent_b_provider: string | null;
    goal_prompt: string;
  }

  const row = await db('autopilot_runs').where({ id: runId, user_id: userId }).first() as RunRow | undefined;

  if (!row) throw new Error('Run not found');
  if (!['failed', 'aborted'].includes(row.status)) {
    throw new Error(`Cannot resume run with status "${row.status}"`);
  }

  const agentAProfile = await getProfile(row.agent_a_profile_id || '');
  const agentBProfile = await getProfile(row.agent_b_profile_id || '');
  if (!agentAProfile || !agentBProfile) throw new Error('Agent profile not found');

  // Determine models and providers from config if available, else profile, else default
  let agentAModel = agentAProfile.model || 'claude-sonnet-4-6';
  let agentBModel = agentBProfile.model || 'claude-sonnet-4-6';
  let agentAProvider: ProviderId = (row.agent_a_provider as ProviderId) || 'claude';
  let agentBProvider: ProviderId = (row.agent_b_provider as ProviderId) || 'claude';
  let maxIterations = 50;
  let maxTokens = 500000;
  let allowedPaths: string[] = [];
  let runTestVerification = true;

  if (row.config_id) {
    const cfg = await db('autopilot_configs').where({ id: row.config_id }).first() as Record<string, unknown> | undefined;
    if (cfg) {
      agentAModel = (cfg.agent_a_model as string) || agentAModel;
      agentBModel = (cfg.agent_b_model as string) || agentBModel;
      if (cfg.agent_a_provider) agentAProvider = cfg.agent_a_provider as ProviderId;
      if (cfg.agent_b_provider) agentBProvider = cfg.agent_b_provider as ProviderId;
      maxIterations = (cfg.max_iterations as number) || maxIterations;
      maxTokens = (cfg.max_tokens_per_session as number) || maxTokens;
      allowedPaths = safeJsonParse<string[]>(cfg.allowed_paths as string, []);
      if (cfg.run_test_verification !== undefined) {
        runTestVerification = (cfg.run_test_verification as number) === 1;
      }
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
    agentAProvider,
    agentBProvider,
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
    runTestVerification,
    status: 'running',
    pauseRequested: false,
  };

  activeRuns.set(runId, ctx);

  // Update DB status
  await db('autopilot_runs').where({ id: runId }).update({ status: 'running', error: null, completed_at: null });

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
    runTestVerification,
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

// ─── Core Loop ──────────────────────────────────────────────────────────────

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
      log.info({ cwd: ctx.cwd }, 'Creating branch');
      ctx.branchName = await createAutopilotBranch(ctx.cwd);
      await db('autopilot_runs').where({ id: runId }).update({ branch_name: ctx.branchName });
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
      await db('autopilot_cycles').where({ id: cycleId }).update({
        status: 'failed',
        completed_at: db.fn.now(),
      });

      emitter.emit('cycle_completed', {
        runId,
        cycleNumber,
        summary: `Cycle failed: ${errorMsg}`,
      });
    }

    ctx.cycleCount++;
  }

  // Run test verification cycle if enabled and run completed normally
  if (
    ctx.runTestVerification &&
    ctx.status === 'running' &&
    !ctx.abortController.signal.aborted &&
    !isOverTokenBudget(ctx)
  ) {
    try {
      await executeTestCycle(ctx, config);
      ctx.cycleCount++;
    } catch (err) {
      // Test verification failure should not fail the entire run
      log.warn({ err }, 'Test verification failed');
    }
  }

  // Determine final status and exit reason
  const scheduleTimeout = isOutsideScheduleWindow(ctx);
  const tokenBudgetExceeded = isOverTokenBudget(ctx);

  if (ctx.abortController.signal.aborted) {
    ctx.status = 'aborted';
  } else if (ctx.status === 'running') {
    ctx.status = 'completed';
  }

  if (ctx.status === 'completed') {
    const reason = scheduleTimeout
      ? 'schedule_timeout'
      : tokenBudgetExceeded
        ? 'token_budget'
        : ctx.cycleCount >= ctx.maxIterations
          ? 'max_iterations'
          : 'normal';
    const reasonLabel = scheduleTimeout
      ? ' (schedule time limit reached)'
      : tokenBudgetExceeded
        ? ' (token budget exceeded)'
        : ctx.cycleCount >= ctx.maxIterations
          ? ' (max iterations reached)'
          : '';
    const summary = `Completed ${ctx.cycleCount} cycles with ${ctx.commitCount} commits${reasonLabel}`;
    emitter.emit('run_completed', {
      runId,
      totalCycles: ctx.cycleCount,
      totalCommits: ctx.commitCount,
      summary,
      reason,
    });
    updateRunStatus(runId, scheduleTimeout ? 'schedule_timeout' : 'completed');

    // Push branch and create PR (best-effort, non-blocking for run status)
    if (ctx.commitCount > 0 && ctx.branchName) {
      pushAndCreatePR(ctx.cwd, ctx.branchName, summary, ctx.cycleCount, ctx.commitCount)
        .then((result) => {
          if (result) {
            emitter.emit('pr_created', { runId, prUrl: result.prUrl });
          }
        })
        .catch((err) => { log.warn({ err }, 'PR creation failed'); });
    }
  }

  activeRuns.delete(runId);
}

// ─── Helper Functions ──────────────────────────────────────────────────────

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
  let updateData: Record<string, unknown>;
  if (error) {
    updateData = { status, error, completed_at: db.fn.now() };
  } else if (status === 'completed' || status === 'aborted') {
    updateData = { status, completed_at: db.fn.now() };
  } else if (status === 'paused') {
    updateData = { status, paused_at: db.fn.now() };
  } else {
    updateData = { status };
  }
  db('autopilot_runs').where({ id: runId }).update(updateData).catch(() => { /* ignore */ });
}
