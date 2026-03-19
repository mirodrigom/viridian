/**
 * Autopilot Test Verifier — test detection, execution, and reporting.
 *
 * Handles test verification cycles after regular autopilot cycles complete.
 */

import { v4 as uuid } from 'uuid';
import { db } from '../db/database.js';
import { safeJsonParse } from '../lib/safeJson.js';
import { type AutopilotRunConfig, type AutopilotContext } from './autopilot-run-manager.js';
import { buildTestVerificationPrompt } from './autopilot-prompt-builder.js';
import { executeCustomCycle } from './autopilot-cycle-executor.js';

// ─── Test Verification Cycle ───────────────────────────────────────────────

export async function executeTestCycle(
  ctx: AutopilotContext,
  config: AutopilotRunConfig,
): Promise<void> {
  const { emitter, runId } = ctx;
  const cycleNumber = ctx.cycleCount;
  const cycleId = uuid();

  // Collect all files changed across ALL cycles in this run
  const changedFiles = await collectChangedFiles(runId);

  if (changedFiles.length === 0) {
    emitter.emit('cycle_completed', {
      runId,
      cycleNumber,
      summary: 'Test Verification skipped: no files were changed during the run',
    });
    return;
  }

  // Build the test verification prompt
  const testPrompt = buildTestVerificationPrompt(changedFiles);

  // Auto-commit message for any new test files
  const commitMsg = `autopilot: test verification — added/ran tests for ${changedFiles.length} changed files`;

  // Execute the test verification cycle (Agent B only, with test marker)
  await executeCustomCycle(ctx, cycleNumber, cycleId, testPrompt, commitMsg, {
    isTestVerification: true,
    skipAgentA: true,
  });

  // Update run counters for test verification
  await updateRunCountersForTest(ctx, runId);
}

// ─── Changed Files Collection ──────────────────────────────────────────────

async function collectChangedFiles(runId: string): Promise<string[]> {
  const allCycles = await db('autopilot_cycles')
    .where({ run_id: runId })
    .whereNotNull('files_changed')
    .whereNot('files_changed', '[]')
    .select('files_changed') as { files_changed: string }[];

  const changedFiles = new Set<string>();

  for (const row of allCycles) {
    const files = safeJsonParse<string[]>(row.files_changed, []);
    files.forEach(f => changedFiles.add(f));
  }

  return Array.from(changedFiles);
}

// ─── Test File Detection ────────────────────────────────────────────────────

export interface TestFileInfo {
  path: string;
  type: 'jest' | 'vitest' | 'mocha' | 'tap' | 'ava' | 'unknown';
  sourceFile?: string;
}

export function detectTestFiles(cwd: string): TestFileInfo[] {
  const { readdirSync, statSync, existsSync } = require('fs');
  const { join, relative, parse } = require('path');

  if (!existsSync(cwd)) return [];

  const testFiles: TestFileInfo[] = [];

  function scanDirectory(dir: string): void {
    try {
      const entries = readdirSync(dir);

      for (const entry of entries) {
        const fullPath = join(dir, entry);
        const stat = statSync(fullPath);

        if (stat.isDirectory()) {
          // Skip common non-test directories
          if (['node_modules', '.git', 'dist', 'build', 'coverage'].includes(entry)) {
            continue;
          }
          scanDirectory(fullPath);
        } else if (stat.isFile()) {
          const relativePath = relative(cwd, fullPath);
          const { name, ext } = parse(entry);

          // Detect test files by pattern
          if (
            entry.includes('.test.') ||
            entry.includes('.spec.') ||
            entry.endsWith('.test.js') ||
            entry.endsWith('.test.ts') ||
            entry.endsWith('.spec.js') ||
            entry.endsWith('.spec.ts') ||
            dir.includes('__tests__') ||
            dir.includes('test/') ||
            dir.includes('tests/')
          ) {
            const testInfo: TestFileInfo = {
              path: relativePath,
              type: detectTestFramework(fullPath),
            };

            // Try to infer source file
            const sourceName = name.replace(/\.(test|spec)$/, '');
            const sourceFile = findSourceFile(cwd, dir, sourceName, ext);
            if (sourceFile) {
              testInfo.sourceFile = relative(cwd, sourceFile);
            }

            testFiles.push(testInfo);
          }
        }
      }
    } catch (err) {
      // Skip directories we can't read
    }
  }

  scanDirectory(cwd);
  return testFiles;
}

function detectTestFramework(testFilePath: string): TestFileInfo['type'] {
  const { readFileSync, existsSync } = require('fs');

  if (!existsSync(testFilePath)) return 'unknown';

  try {
    const content = readFileSync(testFilePath, 'utf8');

    if (content.includes('describe(') && content.includes('it(')) {
      if (content.includes('expect(') && content.includes('toBe')) return 'jest';
      return 'mocha';
    }

    if (content.includes('test(') || content.includes('expect.')) return 'vitest';
    if (content.includes('t.equal') || content.includes('t.ok')) return 'tap';
    if (content.includes('test.serial') || content.includes('t.is')) return 'ava';

    return 'unknown';
  } catch {
    return 'unknown';
  }
}

function findSourceFile(cwd: string, testDir: string, sourceName: string, ext: string): string | null {
  const { join, dirname } = require('path');
  const { existsSync } = require('fs');

  // Common source extensions
  const sourceExts = ['.ts', '.js', '.jsx', '.tsx'];

  // Look in common locations relative to test file
  const searchDirs = [
    testDir, // Same directory as test
    dirname(testDir), // Parent directory
    join(dirname(testDir), 'src'), // ../src
    join(cwd, 'src'), // Project src directory
    cwd, // Project root
  ];

  for (const dir of searchDirs) {
    for (const sourceExt of sourceExts) {
      const candidate = join(dir, sourceName + sourceExt);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

// ─── Test Runner Detection ──────────────────────────────────────────────────

export function detectTestRunner(cwd: string): {
  runner: string;
  command: string;
} | null {
  const { existsSync, readFileSync } = require('fs');
  const { join } = require('path');

  const packageJsonPath = join(cwd, 'package.json');

  if (!existsSync(packageJsonPath)) return null;

  try {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
    const scripts = packageJson.scripts || {};
    const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };

    // Check scripts first
    if (scripts.test) {
      const testScript = scripts.test;
      if (testScript.includes('vitest')) return { runner: 'vitest', command: 'npm test' };
      if (testScript.includes('jest')) return { runner: 'jest', command: 'npm test' };
      if (testScript.includes('mocha')) return { runner: 'mocha', command: 'npm test' };
      if (testScript.includes('tap')) return { runner: 'tap', command: 'npm test' };
      if (testScript.includes('ava')) return { runner: 'ava', command: 'npm test' };
    }

    // Check dependencies
    if (deps.vitest) return { runner: 'vitest', command: 'npx vitest run' };
    if (deps.jest) return { runner: 'jest', command: 'npx jest' };
    if (deps.mocha) return { runner: 'mocha', command: 'npx mocha' };
    if (deps.tap) return { runner: 'tap', command: 'npx tap' };
    if (deps.ava) return { runner: 'ava', command: 'npx ava' };

    return null;
  } catch {
    return null;
  }
}

// ─── Helper Functions ──────────────────────────────────────────────────────

async function updateRunCountersForTest(ctx: AutopilotContext, runId: string): Promise<void> {
  await db('autopilot_runs').where({ id: runId }).update({
    commit_count: ctx.commitCount,
    cycle_count: ctx.cycleCount + 1,
    agent_b_input_tokens: ctx.totalTokens.agentB.inputTokens,
    agent_b_output_tokens: ctx.totalTokens.agentB.outputTokens,
  });
}
