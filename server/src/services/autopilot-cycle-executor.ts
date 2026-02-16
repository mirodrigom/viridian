/**
 * Autopilot Cycle Executor — core cycle logic for Agent A → Agent B → auto-commit.
 *
 * Shared between normal and test cycles, handles git integration.
 */

import { v4 as uuid } from 'uuid';
import { getDb } from '../db/database.js';
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
    updateRunCounters(ctx, runId);
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
  const db = getDb();

  // Insert cycle record
  db.prepare(`
    INSERT INTO autopilot_cycles (id, run_id, cycle_number, status, is_test_verification)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    cycleId,
    runId,
    cycleNumber,
    options?.skipAgentA ? 'agent_b_running' : 'agent_a_running',
    options?.isTestVerification ? 1 : 0,
  );

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
    db.prepare(`
      UPDATE autopilot_cycles
      SET agent_a_prompt = ?, agent_a_response = ?,
          agent_a_tokens_in = ?, agent_a_tokens_out = ?,
          status = 'agent_b_running'
      WHERE id = ?
    `).run(
      customPrompt,
      agentAResult.response,
      agentAResult.tokens.inputTokens,
      agentAResult.tokens.outputTokens,
      cycleId,
    );
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
    updateRunCounters(ctx, runId);
  } else {
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
      ? `${options?.isTestVerification ? 'Test Verification: ' : ''}committed ${commitResult.filesChanged.length} files`
      : `${options?.isTestVerification ? 'Test Verification' : 'Cycle'} completed (no file changes)`,
  });
}

// ─── Helper Functions ──────────────────────────────────────────────────────

function updateRunCounters(ctx: AutopilotContext, runId: string): void {
  const db = getDb();
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
}