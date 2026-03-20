import { v4 as uuid } from 'uuid';
import { getDefaultShell, getHomeDir } from '../utils/platform.js';
import { createLogger } from '../logger.js';

const log = createLogger('terminal');

let pty: typeof import('node-pty') | null = null;

async function loadPty() {
  if (!pty) {
    try {
      pty = await import('node-pty');
    } catch {
      log.warn('node-pty not available — terminal feature disabled');
    }
  }
  return pty;
}

interface TerminalSession {
  id: string;
  pty: import('node-pty').IPty;
  cwd: string;
}

const sessions = new Map<string, TerminalSession>();

export async function createTerminal(cwd: string, cols = 80, rows = 24): Promise<TerminalSession | null> {
  const mod = await loadPty();
  if (!mod) return null;

  const shell = getDefaultShell();
  const id = uuid();

  // Validate cwd exists, fall back to home directory or /tmp
  let safeCwd = cwd;
  try {
    const { statSync } = await import('fs');
    statSync(safeCwd);
  } catch {
    safeCwd = getHomeDir();
    try {
      const { statSync } = await import('fs');
      statSync(safeCwd);
    } catch {
      safeCwd = '/tmp';
    }
  }

  const ptyProcess = mod.spawn(shell, [], {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: safeCwd,
    env: process.env as Record<string, string>,
  });

  const session: TerminalSession = { id, pty: ptyProcess, cwd };
  sessions.set(id, session);
  return session;
}

export function getTerminal(id: string): TerminalSession | undefined {
  return sessions.get(id);
}

export function resizeTerminal(id: string, cols: number, rows: number) {
  const session = sessions.get(id);
  if (session) {
    session.pty.resize(cols, rows);
  }
}

export function writeTerminal(id: string, data: string) {
  const session = sessions.get(id);
  if (session) {
    session.pty.write(data);
  }
}

export function destroyTerminal(id: string) {
  const session = sessions.get(id);
  if (session) {
    session.pty.kill();
    sessions.delete(id);
  }
}

export function destroyAllTerminals() {
  for (const [id, session] of sessions) {
    session.pty.kill();
    sessions.delete(id);
  }
}
