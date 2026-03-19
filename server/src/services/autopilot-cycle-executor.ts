/**
 * Autopilot Cycle Executor — core cycle logic for Agent A → Agent B → auto-commit.
 *
 * Shared between normal and test cycles, handles git integration.
 */

import { v4 as uuid } from 'uuid';
import { db } from '../db/database.js';
import { autoCommit } from './autopilot-git.js';
import { type AutopilotRunConfig, type AutopilotContext } from './autopilot-run-manager.js';
import { buildAgentAPrompt, buildAgentBPrompt, summarize } from './autopilot-prompt-builder.js';
import { runAgent } from './autopilot-agent-runner.js';

// ─── Single Cycle Execution ───────────────────────────────────────────────

export async function executeCycle(
  ctx: AutopilotContext,
  config: AutopilotRunConfig,
  cycleNumber: number,
  cycleId: string,
): Promise<void> {
  const { emitter, runId } = ctx;

  // Insert cycle record
  await db('autopilot_cycles').insert({
    id: cycleId,
    run_id: runId,
    cycle_number: cycleNumber,
    status: 'agent_a_running',
  });

  // ── Phase 1: Agent A ──────────────────────────────────────────────────

  const agentAPrompt = await buildAgentAPrompt(ctx, config, cycleNumber);

  emitter.emit('cycle_started', { runId, cycleNumber, phase: 'agent_a' });

  const agentAResult = await runAgent(ctx, 'a', agentAPrompt, cycleNumber);

  emitter.emit('agent_a_complete', {
    runId,
    cycleNumber,
    response: agentAResult.response,
    tokens: agentAResult.tokens,
  });

  // Update DB
  await db('autopilot_cycles').where({ id: cycleId }).update({
    agent_a_prompt: agentAPrompt,
    agent_a_response: agentAResult.response,
    agent_a_tokens_in: agentAResult.tokens.inputTokens,
    agent_a_tokens_out: agentAResult.tokens.outputTokens,
    status: 'agent_b_running',
  });

  // Check if Agent A signals completion
  if (agentAResult.response.includes('AUTOPILOT_COMPLETE')) {
    await db('autopilot_cycles').where({ id: cycleId }).update({
      status: 'completed',
      completed_at: db.fn.now(),
    });
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

    await db('autopilot_cycles').where({ id: cycleId }).update({
      agent_b_prompt: agentBPrompt,
      agent_b_response: agentBResult.response,
      agent_b_tokens_in: agentBResult.tokens.inputTokens,
      agent_b_tokens_out: agentBResult.tokens.outputTokens,
      commit_hash: commitResult.hash,
      commit_message: commitResult.message,
      files_changed: JSON.stringify(commitResult.filesChanged),
      status: 'committed',
      completed_at: db.fn.now(),
    });

    // Update run counters
    await updateRunCounters(ctx, runId);
  } else {
    // No files changed — still mark cycle as completed
    await db('autopilot_cycles').where({ id: cycleId }).update({
      agent_b_prompt: agentBPrompt,
      agent_b_response: agentBResult.response,
      agent_b_tokens_in: agentBResult.tokens.inputTokens,
      agent_b_tokens_out: agentBResult.tokens.outputTokens,
      status: 'completed',
      completed_at: db.fn.now(),
    });
  }

  emitter.emit('cycle_completed', {
    runId,
    cycleNumber,
    summary: commitResult
      ? `Committed ${commitResult.filesChanged.length} files: ${commitResult.message}`
      : 'Cycle completed (no file changes)',
  });
}

// ─── Specialized Cycle with Custom Prompt ──────────────────────────────────

export async function executeCustomCycle(
  ctx: AutopilotContext,
  cycleNumber: number,
  cycleId: string,
  customPrompt: string,
  commitMessage: string,
  options?: {
    isTestVerification?: boolean;
    skipAgentA?: boolean;
  },
): Promise<void> {
  const { emitter, runId } = ctx;

  // Insert cycle record
  await db('autopilot_cycles').insert({
    id: cycleId,
    run_id: runId,
    cycle_number: cycleNumber,
    status: options?.skipAgentA ? 'agent_b_running' : 'agent_a_running',
    is_test_verification: options?.isTestVerification ? 1 : 0,
  });

  let agentAResult;

  // ── Phase 1: Agent A (optional) ───────────────────────────────────────

  if (!options?.skipAgentA) {
    emitter.emit('cycle_started', { runId, cycleNumber, phase: 'agent_a' });

    agentAResult = await runAgent(ctx, 'a', customPrompt, cycleNumber);

    emitter.emit('agent_a_complete', {
      runId,
      cycleNumber,
      response: agentAResult.response,
      tokens: agentAResult.tokens,
    });

    // Update DB
    await db('autopilot_cycles').where({ id: cycleId }).update({
      agent_a_prompt: customPrompt,
      agent_a_response: agentAResult.response,
      agent_a_tokens_in: agentAResult.tokens.inputTokens,
      agent_a_tokens_out: agentAResult.tokens.outputTokens,
      status: 'agent_b_running',
    });
  }

  // ── Phase 2: Agent B ──────────────────────────────────────────────────

  const agentBPrompt = options?.skipAgentA ? customPrompt : buildAgentBPrompt(ctx, agentAResult!.response);

  emitter.emit('cycle_started', {
    runId,
    cycleNumber,
    phase: 'agent_b',
    isTestVerification: options?.isTestVerification,
  });

  const agentBResult = await runAgent(ctx, 'b', agentBPrompt, cycleNumber);

  emitter.emit('agent_b_complete', {
    runId,
    cycleNumber,
    response: agentBResult.response,
    tokens: agentBResult.tokens,
  });

  // ── Phase 3: Auto-commit ──────────────────────────────────────────────

  const commitResult = await autoCommit(ctx.cwd, ctx.allowedPaths, commitMessage);

  if (commitResult) {
    ctx.commitCount++;
    emitter.emit('commit_made', {
      runId,
      cycleNumber,
      hash: commitResult.hash,
      message: commitResult.message,
      filesChanged: commitResult.filesChanged,
    });

    await db('autopilot_cycles').where({ id: cycleId }).update({
      agent_b_prompt: agentBPrompt,
      agent_b_response: agentBResult.response,
      agent_b_tokens_in: agentBResult.tokens.inputTokens,
      agent_b_tokens_out: agentBResult.tokens.outputTokens,
      commit_hash: commitResult.hash,
      commit_message: commitResult.message,
      files_changed: JSON.stringify(commitResult.filesChanged),
      status: 'committed',
      completed_at: db.fn.now(),
    });

    // Update run counters
    await updateRunCounters(ctx, runId);
  } else {
    await db('autopilot_cycles').where({ id: cycleId }).update({
      agent_b_prompt: agentBPrompt,
      agent_b_response: agentBResult.response,
      agent_b_tokens_in: agentBResult.tokens.inputTokens,
      agent_b_tokens_out: agentBResult.tokens.outputTokens,
      status: 'completed',
      completed_at: db.fn.now(),
    });
  }

  emitter.emit('cycle_completed', {
    runId,
    cycleNumber,
    summary: commitResult
      ? `${options?.isTestVerification ? 'Test Verification: ' : ''}committed ${commitResult.filesChanged.length} files`
      : `${options?.isTestVerification ? 'Test Verification' : 'Cycle'} completed (no file changes)`,
  });
}

// ─── Helper Functions ──────────────────────────────────────────────────────

async function updateRunCounters(ctx: AutopilotContext, runId: string): Promise<void> {
  await db('autopilot_runs').where({ id: runId }).update({
    commit_count: ctx.commitCount,
    cycle_count: ctx.cycleCount + 1,
    agent_a_input_tokens: ctx.totalTokens.agentA.inputTokens,
    agent_a_output_tokens: ctx.totalTokens.agentA.outputTokens,
    agent_b_input_tokens: ctx.totalTokens.agentB.inputTokens,
    agent_b_output_tokens: ctx.totalTokens.agentB.outputTokens,
  });
}
