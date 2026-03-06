/**
 * Autopilot Git Service — branch creation, scoped auto-commit, push & PR.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { getStatus, stageFiles, commit, getBranches, createBranch } from './git.js';
import { createLogger } from '../logger.js';

const log = createLogger('autopilot-git');

const execFileAsync = promisify(execFile);

/**
 * Create a new autopilot branch with auto-incrementing session number.
 * Returns the branch name (e.g., "autopilot/2025-02-13-session-1").
 */
export async function createAutopilotBranch(cwd: string): Promise<string> {
  const date = new Date().toISOString().slice(0, 10);
  const branches = await getBranches(cwd);
  const allBranchNames = branches.all || [];

  let sessionNum = 1;
  while (allBranchNames.some((b: string) => b.includes(`autopilot/${date}-session-${sessionNum}`))) {
    sessionNum++;
  }

  const branchName = `autopilot/${date}-session-${sessionNum}`;
  await createBranch(cwd, branchName);
  return branchName;
}

/**
 * Auto-commit files that are within the allowed scope.
 * Returns commit info if files were committed, null if no changes in scope.
 */
export async function autoCommit(
  cwd: string,
  allowedPaths: string[],
  suggestedMessage: string,
): Promise<{ hash: string; message: string; filesChanged: string[] } | null> {
  const status = await getStatus(cwd);

  // Collect all changed files (modified, created, not_added)
  const changedFiles: string[] = [];
  if (status.modified) changedFiles.push(...status.modified);
  if (status.created) changedFiles.push(...status.created);
  if (status.not_added) changedFiles.push(...status.not_added);
  // Also include renamed/deleted
  if (status.renamed) changedFiles.push(...status.renamed.map((r) => r.to));
  if (status.deleted) changedFiles.push(...status.deleted);

  // Filter to only files within allowed scope
  const scopedFiles = filterByScope(changedFiles, allowedPaths);
  if (scopedFiles.length === 0) return null;

  // Stage and commit
  await stageFiles(cwd, scopedFiles);
  const message = suggestedMessage || 'autopilot: automated changes';
  const result = await commit(cwd, message);

  return {
    hash: result.commit || '',
    message,
    filesChanged: scopedFiles,
  };
}

/**
 * Convert a simple glob pattern to a RegExp.
 * Supports ** (any path segments) and * (single segment chars).
 */
function globToRegex(pattern: string): RegExp {
  // Escape regex special chars except * and /
  let re = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  // ** matches any number of path segments
  re = re.replace(/\*\*/g, '{{GLOBSTAR}}');
  // * matches anything except /
  re = re.replace(/\*/g, '[^/]*');
  re = re.replace(/\{\{GLOBSTAR\}\}/g, '.*');
  return new RegExp(`^${re}$`);
}

/**
 * Filter file paths by allowed scope globs.
 * If allowedPaths is empty, all files are allowed.
 */
function filterByScope(files: string[], allowedPaths: string[]): string[] {
  if (allowedPaths.length === 0) return files;

  const regexes = allowedPaths.map(globToRegex);
  return files.filter((file) =>
    regexes.some((rx) => rx.test(file)),
  );
}

/**
 * Get diff for a specific commit hash.
 */
export async function getCommitDiff(cwd: string, hash: string): Promise<string> {
  const simpleGit = (await import('simple-git')).default;
  const git = simpleGit(cwd);
  return git.show([hash, '--stat', '--patch']);
}

/**
 * Push autopilot branch and create a PR to main with auto-merge.
 * Best-effort — logs errors but doesn't throw so the run still completes.
 */
export async function pushAndCreatePR(
  cwd: string,
  branchName: string,
  summary: string,
  cycleCount: number,
  commitCount: number,
): Promise<{ prUrl: string } | null> {
  try {
    // Push branch to remote with upstream tracking
    const simpleGit = (await import('simple-git')).default;
    const git = simpleGit(cwd);
    await git.push(['-u', 'origin', branchName]);

    // Create PR via gh CLI
    const body = `## Autopilot Run Summary\n\n${summary}\n\n- **Cycles:** ${cycleCount}\n- **Commits:** ${commitCount}\n- **Branch:** \`${branchName}\``;
    const title = `autopilot: ${branchName}`;

    const { stdout } = await execFileAsync('gh', [
      'pr', 'create',
      '--base', 'main',
      '--head', branchName,
      '--title', title,
      '--body', body,
    ], { cwd });

    const prUrl = stdout.trim();
    log.info({ prUrl }, 'PR created');

    // Enable auto-merge (squash)
    try {
      await execFileAsync('gh', [
        'pr', 'merge', prUrl,
        '--auto', '--squash',
      ], { cwd });
      log.info({ prUrl }, 'Auto-merge enabled');
    } catch (mergeErr) {
      // Auto-merge may not be available (repo settings, no branch protection, etc.)
      log.warn({ err: mergeErr }, 'Could not enable auto-merge');
    }

    return { prUrl };
  } catch (err) {
    log.error({ err }, 'Failed to push/create PR');
    return null;
  }
}
