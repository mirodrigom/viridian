import * as pty from 'node-pty';
import { v4 as uuid } from 'uuid';

interface TerminalSession {
  id: string;
  pty: pty.IPty;
  cwd: string;
}

const sessions = new Map<string, TerminalSession>();

export function createTerminal(cwd: string, cols = 80, rows = 24): TerminalSession {
  const shell = process.env.SHELL || '/bin/bash';
  const id = uuid();

  const ptyProcess = pty.spawn(shell, [], {
    name: 'xterm-256color',
    cols,
    rows,
    cwd,
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
