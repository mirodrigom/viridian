/**
 * Synthetic JSONL writer for non-Claude providers.
 *
 * Providers like Kiro output plain text and don't write JSONL session files.
 * This service writes JSONL files in ~/.claude/projects/<cwd-hash>/ so the
 * existing session listing, sidebar, and message loading infrastructure works.
 */

import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { v4 as uuid } from 'uuid';
import { getHomeDir, cwdToHash } from '../utils/platform.js';

const CLAUDE_DIR = join(getHomeDir(), '.claude', 'projects');

/** Maps sessionId → file path for active sessions. */
const sessionFiles = new Map<string, string>();

/** Maps sessionId → cwd for writing cwd into user messages. */
const sessionCwds = new Map<string, string>();

/**
 * Initialize the JSONL file directory for a non-Claude session.
 * Call once when createSession() assigns a claudeSessionId.
 */
export function initSessionFile(sessionId: string, cwd: string): void {
  const projectDir = cwdToHash(cwd);
  const dirPath = join(CLAUDE_DIR, projectDir);
  mkdirSync(dirPath, { recursive: true });
  const filePath = join(dirPath, `${sessionId}.jsonl`);
  sessionFiles.set(sessionId, filePath);
  sessionCwds.set(sessionId, cwd);
}

/**
 * Append a user message entry to the JSONL file.
 */
export function appendUserMessage(sessionId: string, prompt: string): void {
  const filePath = sessionFiles.get(sessionId);
  if (!filePath) return;

  const entry = {
    type: 'user',
    message: { content: prompt },
    timestamp: new Date().toISOString(),
    uuid: uuid(),
    cwd: sessionCwds.get(sessionId) || '',
  };
  appendFileSync(filePath, JSON.stringify(entry) + '\n', 'utf8');
}

/**
 * Append an assistant message entry to the JSONL file.
 */
export function appendAssistantMessage(sessionId: string, text: string): void {
  const filePath = sessionFiles.get(sessionId);
  if (!filePath) return;

  const entry = {
    type: 'assistant',
    message: {
      content: [{ type: 'text', text }],
    },
    timestamp: new Date().toISOString(),
    uuid: uuid(),
  };
  appendFileSync(filePath, JSON.stringify(entry) + '\n', 'utf8');
}

/**
 * Remove session tracking when a session is cleaned up.
 */
export function cleanupSession(sessionId: string): void {
  sessionFiles.delete(sessionId);
  sessionCwds.delete(sessionId);
}
