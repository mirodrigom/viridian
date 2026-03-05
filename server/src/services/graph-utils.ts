/**
 * Graph Utilities — shared debug logging and session tracking helpers.
 *
 * This module exists to break circular dependencies between graph-runner.ts
 * (the orchestrator) and its sub-modules (resolver, prompts, execution, environment).
 */

import { appendFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { isSessionInternal } from '../db/database.js';

// ─── Debug Logging ──────────────────────────────────────────────────────

const DEBUG_LOG = join(tmpdir(), 'graph-runner-debug.log');

/** Debug log to file for tracing delegation flow. Used by all graph sub-modules. */
export function debugLog(msg: string) {
  const ts = new Date().toISOString().slice(11, 23);
  const line = `[${ts}] ${msg}\n`;
  try { appendFileSync(DEBUG_LOG, line); } catch { /* ignore */ }
  console.log(msg);
}

// ─── Session ID Tracking ────────────────────────────────────────────────

/**
 * Set of Claude CLI session IDs created by graph runner executions.
 * Used to filter these sessions out of the chat sidebar listing.
 */
const graphRunnerSessionIds = new Set<string>();

/** Check if a Claude session ID belongs to a graph runner execution. */
export function isGraphRunnerSession(claudeSessionId: string): boolean {
  return graphRunnerSessionIds.has(claudeSessionId) || isSessionInternal(claudeSessionId);
}

/** Add a session ID to the graph runner tracking set. Used by graph-execution. */
export function addGraphRunnerSessionId(sessionId: string): void {
  graphRunnerSessionIds.add(sessionId);
}

/** Remove a session ID from the graph runner tracking set. */
export function deleteGraphRunnerSessionId(sessionId: string): void {
  graphRunnerSessionIds.delete(sessionId);
}
