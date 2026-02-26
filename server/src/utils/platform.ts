/**
 * Cross-platform utilities for Linux + Windows (Git Bash / MSYS2) compatibility.
 *
 * Centralizes platform-specific logic so the rest of the codebase stays clean.
 */

import { homedir, tmpdir, platform } from 'os';
import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';

export const isWindows = platform() === 'win32';

/** Home directory — works on Linux, macOS, and Windows. */
export function getHomeDir(): string {
  return homedir();
}

/** Temp directory — works on all platforms. */
export function getTmpDir(): string {
  return tmpdir();
}

/**
 * Default shell for terminal sessions.
 *
 * - Linux/macOS: $SHELL or /bin/bash
 * - Windows: Git Bash if available, otherwise cmd.exe
 */
export function getDefaultShell(): string {
  if (!isWindows) {
    return process.env.SHELL || '/bin/bash';
  }

  // Prefer bash from Git for Windows
  if (process.env.SHELL) return process.env.SHELL;

  const gitBashPaths = [
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
  ];
  for (const p of gitBashPaths) {
    if (existsSync(p)) return p;
  }

  return process.env.COMSPEC || 'cmd.exe';
}

/**
 * Find a binary by name in PATH — cross-platform replacement for `which`.
 *
 * Returns the full path or null if not found.
 */
export function findBinary(name: string): string | null {
  try {
    if (isWindows) {
      // `where` is the Windows equivalent of `which`.
      // Try `where` first (works in cmd and PowerShell).
      // In Git Bash, `which` also works but `where` is more reliable.
      const result = execSync(`where ${name} 2>NUL`, { encoding: 'utf8' }).trim();
      // `where` can return multiple lines — take the first match.
      return result.split(/\r?\n/)[0] || null;
    } else {
      const result = execSync(`which ${name} 2>/dev/null`, { encoding: 'utf8' }).trim();
      return result || null;
    }
  } catch {
    return null;
  }
}

/**
 * Gracefully kill a process — cross-platform.
 *
 * On Linux/macOS: sends SIGTERM, then SIGKILL after `gracePeriodMs`.
 * On Windows: `proc.kill()` calls TerminateProcess (always forceful).
 */
export function gracefulKill(proc: { kill: (signal?: string | number) => boolean; pid?: number }, gracePeriodMs = 3000): void {
  try {
    if (isWindows) {
      // On Windows, SIGTERM is emulated — just kill directly.
      proc.kill();
    } else {
      proc.kill('SIGTERM');
      // Schedule a forceful kill if the process doesn't exit in time.
      const timer = setTimeout(() => {
        try { proc.kill('SIGKILL'); } catch { /* already dead */ }
      }, gracePeriodMs);
      // Don't keep the event loop alive just for this timer
      if (timer && typeof timer === 'object' && 'unref' in timer) {
        (timer as NodeJS.Timeout).unref();
      }
    }
  } catch { /* already dead */ }
}

/**
 * Convert a cwd path to a safe directory-name hash.
 *
 * Claude CLI uses this pattern to locate session JSONL files:
 *   ~/.claude/projects/<cwd-hash>/<sessionId>.jsonl
 *
 * On Linux: /home/user/project → -home-user-project
 * On Windows: C:\Users\user\project → C-Users-user-project
 */
export function cwdToHash(cwd: string): string {
  if (isWindows) {
    // Replace both backslash and colon with dash (C:\foo → C-foo)
    return cwd.replace(/[:\\/]/g, '-').replace(/^-+/, '');
  }
  return cwd.replace(/\//g, '-');
}

/**
 * Common binary search paths — extends PATH-based lookup with well-known locations.
 * Returns an array of candidate paths to check with existsSync().
 */
export function getCommonBinaryPaths(binaryName: string): string[] {
  const home = getHomeDir();

  if (isWindows) {
    return [
      join(home, 'AppData', 'Local', 'Programs', 'Python', 'Python312', 'Scripts', binaryName + '.exe'),
      join(home, 'AppData', 'Roaming', 'Python', 'Scripts', binaryName + '.exe'),
      join(home, '.local', 'bin', binaryName + '.exe'),
      join(home, 'scoop', 'shims', binaryName + '.exe'),
    ];
  }

  return [
    join(home, '.local', 'bin', binaryName),
    `/usr/local/bin/${binaryName}`,
    `/usr/bin/${binaryName}`,
  ];
}
