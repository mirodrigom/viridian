/**
 * Claude Code SDK — Binary resolution logic.
 *
 * Locates the Claude CLI binary by checking (in order):
 * 1. CLAUDE_PATH environment variable
 * 2. VS Code extension native binaries
 * 3. System PATH
 */

import { existsSync, readdirSync } from 'fs';
import { join, resolve as resolvePath } from 'path';
import { getHomeDir, findBinary as findBinaryInPath, isWindows } from '../utils/platform.js';

// ─── Binary resolution ──────────────────────────────────────────────────────

let resolvedPath: string | null = null;

export function findClaudeBinary(): string {
  if (resolvedPath) return resolvedPath;

  if (process.env.CLAUDE_PATH && existsSync(process.env.CLAUDE_PATH)) {
    // resolvePath normalises forward slashes to backslashes on Windows,
    // which is required for cmd.exe to execute .cmd wrappers.
    resolvedPath = resolvePath(process.env.CLAUDE_PATH);
    return resolvedPath;
  }

  // Search for native binary in VS Code extensions first (preferred over npm wrapper)
  const home = getHomeDir();
  const searchPaths = isWindows
    ? [
        join(home, '.vscode', 'extensions'),
        join(home, '.vscode-server', 'extensions'),
      ]
    : [
        join(home, '.var/app/com.visualstudio.code/data/vscode/extensions'),
        join(home, '.vscode/extensions'),
        join(home, '.vscode-server/extensions'),
      ];

  for (const extDir of searchPaths) {
    try {
      if (!existsSync(extDir)) continue;
      const matches = readdirSync(extDir)
        .filter(d => d.startsWith('anthropic.claude-code-'))
        .sort()
        .reverse();
      for (const dir of matches) {
        const binName = isWindows ? 'claude.exe' : 'claude';
        const binPath = join(extDir, dir, 'resources', 'native-binary', binName);
        if (existsSync(binPath)) { resolvedPath = binPath; return resolvedPath; }
      }
    } catch { /* skip */ }
  }

  // Fall back to claude in PATH (may be a native install or npm wrapper)
  const inPath = findBinaryInPath('claude');
  if (inPath) { resolvedPath = inPath; return resolvedPath; }

  throw new Error(
    'Claude CLI binary not found. Set CLAUDE_PATH env var, install claude globally, or install the Claude Code VS Code extension.',
  );
}
