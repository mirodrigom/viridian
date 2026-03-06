/**
 * Claude Code SDK — Utility functions for text processing and debug logging.
 */

import { appendFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createLogger } from '../logger.js';

// ─── Debug logging ───────────────────────────────────────────────────────────

const log = createLogger('claude-utils');
const DEBUG_LOG = join(tmpdir(), 'graph-runner-debug.log');

export function debugLog(msg: string) {
  const ts = new Date().toISOString().slice(11, 23);
  const line = `[${ts}] ${msg}\n`;
  try { appendFileSync(DEBUG_LOG, line); } catch { /* ignore */ }
  log.debug(msg);
}

// ─── ANSI escape code stripping ─────────────────────────────────────────────

/** Strip ANSI escape sequences (colors, cursor, etc.) from a string. */
export function stripAnsi(text: string): string {
  // Matches: ESC[ ... final byte | ESC (non-[ sequences) | operating system commands
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*[A-Za-z]|\x1b[^[[]|\x1b\].*?(?:\x07|\x1b\\)/g, '');
}

// ─── Error extraction helper ─────────────────────────────────────────────────

/**
 * Extract the most useful error line from Claude CLI's stderr output.
 * Prefers lines that mention specific error conditions; falls back to the last non-empty line.
 */
export function extractClaudeError(stderr: string): string | null {
  const clean = stripAnsi(stderr);
  const lines = clean.split('\n').map((l: string) => l.trim()).filter(Boolean);
  if (!lines.length) return null;
  // Prefer lines with specific error keywords
  const errorLine = [...lines].reverse().find((l: string) =>
    /error|failed|unauthorized|forbidden|timeout|ENOENT|ECONNREFUSED/i.test(l),
  );
  return errorLine || lines[lines.length - 1] || null;
}

// ─── Unicode decode helper ───────────────────────────────────────────────────

/**
 * Decode literal \uXXXX escape sequences in strings.
 * Claude CLI sometimes writes unicode characters as literal backslash-u escapes
 * (e.g. "\\u00ed" instead of "i") which survive JSON.parse as the literal text "\u00ed".
 */
export function decodeUnicodeEscapes(text: string): string {
  return text.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16)),
  );
}
