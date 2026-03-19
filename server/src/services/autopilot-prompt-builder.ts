/**
 * Autopilot Prompt Builder — template-based prompt generation for agents.
 *
 * Handles Agent A and Agent B prompt construction, goal and context synthesis.
 */

import { db } from '../db/database.js';
import { type AutopilotRunConfig, type AutopilotContext } from './autopilot-run-manager.js';

// ─── Agent A Prompt Builder ──────────────────────────────────────────────

export async function buildAgentAPrompt(
  ctx: AutopilotContext,
  config: AutopilotRunConfig,
  cycleNumber: number,
): Promise<string> {
  if (cycleNumber === 0) {
    return `## Goal\n${config.goalPrompt}\n\n## Instructions\nAnalyze the project and suggest the first improvement to achieve this goal. Focus on ONE specific, actionable suggestion.`;
  }

  // Get last cycle's Agent B response from DB
  const lastCycle = await db('autopilot_cycles')
    .where({ run_id: ctx.runId, cycle_number: cycleNumber - 1 })
    .orderBy('cycle_number', 'desc')
    .select('agent_b_response', 'commit_message', 'files_changed')
    .first() as {
      agent_b_response: string;
      commit_message: string | null;
      files_changed: string | null;
    } | undefined;

  const context = lastCycle
    ? `## Previous Cycle Results\n${lastCycle.commit_message ? `Commit: ${lastCycle.commit_message}` : 'No commit made'}\n${lastCycle.files_changed ? `Files changed: ${lastCycle.files_changed}` : ''}\n\nExecutor's response:\n${lastCycle.agent_b_response?.slice(0, 2000) || 'No response'}`
    : '';

  return `## Goal\n${config.goalPrompt}\n\n${context}\n\n## Instructions\nReview the changes made in the previous cycle. Then suggest the NEXT improvement to continue achieving the goal. Focus on ONE specific, actionable suggestion.\n\nIf you believe the goal has been sufficiently achieved, respond with: "AUTOPILOT_COMPLETE: No more improvements needed."`;
}

// ─── Agent B Prompt Builder ──────────────────────────────────────────────

export function buildAgentBPrompt(ctx: AutopilotContext, agentAResponse: string): string {
  return `## Task from Analyst\n${agentAResponse}\n\n## Instructions\nImplement the suggested change. Be thorough but focused. After making changes, provide a brief summary of what was modified and why.`;
}

// ─── Test Verification Prompt Builder ────────────────────────────────────

export function buildTestVerificationPrompt(changedFiles: string[]): string {
  const fileList = changedFiles.map(f => `- ${f}`).join('\n');

  return `## Test Verification Cycle

This is an automated test verification step. The following files were modified during this autopilot run:

${fileList}

## Your Tasks (in order)

1. **Find existing tests**: Search for existing test files related to the changed files above (look for \`*.test.*\`, \`*.spec.*\`, \`__tests__/\` directories).

2. **Run existing tests**: If you find existing tests that cover the changed files, run them using the project's test runner (check \`package.json\` scripts for \`test\`, \`vitest\`, \`jest\`, etc.). Report the results.

3. **Identify gaps**: For each changed file, check if corresponding tests exist. List any files that lack test coverage.

4. **Create new tests**: For files without test coverage, create appropriate test files following the project's existing test patterns and conventions. Focus on:
   - Core function behavior (happy paths)
   - Error handling
   - Edge cases

5. **Run all tests again**: After creating new tests, run the full test suite to verify everything passes.

6. **Summary**: Provide a summary of:
   - Tests found and their status (pass/fail)
   - New tests created (file paths)
   - Any tests that are failing and why

Be thorough but focused. Only create tests for the files that were changed in this run.`;
}

// ─── Helper Functions ─────────────────────────────────────────────────────

export function summarize(text: string, maxLen: number): string {
  const firstLine = text.split('\n').find(l => l.trim().length > 0) || text;
  const clean = firstLine.replace(/^#+\s*/, '').trim();
  return clean.length > maxLen ? clean.slice(0, maxLen - 3) + '...' : clean;
}
