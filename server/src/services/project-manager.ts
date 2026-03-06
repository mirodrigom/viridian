/**
 * Project Manager Service
 * Spawns and tracks dev server processes for registered projects.
 * Emits events for process status and output, consumed by ws/projects.ts.
 */

import { EventEmitter } from 'events';
import { spawn, type ChildProcess } from 'child_process';
import { isWindows } from '../utils/platform.js';
import { createLogger } from '../logger.js';

const log = createLogger('project-manager');

export const projectEmitter = new EventEmitter();
projectEmitter.setMaxListeners(100);

export interface RunningProcess {
  serviceId: string;
  projectId: string;
  process: ChildProcess;
  pid: number;
  startedAt: number;
}

// In-memory maps (reset on server restart — process state is ephemeral)
const runningProcesses = new Map<string, RunningProcess>();
const activeAgents = new Map<string, string>(); // projectId → sessionId

// ─── Service lifecycle ────────────────────────────────────────────────────────

export function startService(serviceId: string, projectId: string, command: string, cwd: string): void {
  if (runningProcesses.has(serviceId)) {
    log.debug({ serviceId }, 'Service already running');
    return;
  }

  let proc: ChildProcess;
  try {
    proc = spawn(command, {
      cwd,
      shell: true,
      detached: true, // becomes process group leader → we can kill the whole group
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to spawn process';
    log.error({ err, serviceId, command, cwd }, 'Failed to spawn service process');
    projectEmitter.emit('service:status', { serviceId, projectId, status: 'error', error: msg });
    return;
  }

  if (!proc.pid) {
    projectEmitter.emit('service:status', { serviceId, projectId, status: 'error', error: 'No PID assigned' });
    return;
  }

  runningProcesses.set(serviceId, { serviceId, projectId, process: proc, pid: proc.pid, startedAt: Date.now() });
  projectEmitter.emit('service:status', { serviceId, projectId, status: 'running', pid: proc.pid });

  proc.stdout?.on('data', (data: Buffer) => {
    projectEmitter.emit('service:output', {
      serviceId, projectId, data: data.toString(), stream: 'stdout',
    });
  });

  proc.stderr?.on('data', (data: Buffer) => {
    projectEmitter.emit('service:output', {
      serviceId, projectId, data: data.toString(), stream: 'stderr',
    });
  });

  proc.on('exit', (code) => {
    runningProcesses.delete(serviceId);
    projectEmitter.emit('service:status', { serviceId, projectId, status: 'stopped', exitCode: code });
  });

  proc.on('error', (err) => {
    runningProcesses.delete(serviceId);
    projectEmitter.emit('service:status', { serviceId, projectId, status: 'error', error: err.message });
  });
}

export function stopService(serviceId: string): void {
  const entry = runningProcesses.get(serviceId);
  if (!entry) return;
  try {
    // Kill entire process group so child processes (e.g. vite spawned by pnpm) also stop
    if (isWindows) {
      // Windows doesn't support process groups via negative PID
      try { process.kill(entry.pid, 'SIGTERM'); } catch { /* already dead */ }
    } else {
      process.kill(-entry.pid, 'SIGTERM');
    }
  } catch {
    // Process may have already exited — ensure map is clean
    runningProcesses.delete(serviceId);
    projectEmitter.emit('service:status', {
      serviceId, projectId: entry.projectId, status: 'stopped',
    });
  }
}

export function stopAllForProject(projectId: string): void {
  for (const [sid, entry] of runningProcesses.entries()) {
    if (entry.projectId === projectId) stopService(sid);
  }
}

export function getServiceStatus(serviceId: string): 'running' | 'stopped' {
  return runningProcesses.has(serviceId) ? 'running' : 'stopped';
}

export function getRunningEntry(serviceId: string): RunningProcess | undefined {
  return runningProcesses.get(serviceId);
}

// ─── Agent lifecycle ──────────────────────────────────────────────────────────

export function activateAgent(projectId: string, sessionId: string): void {
  activeAgents.set(projectId, sessionId);
  projectEmitter.emit('agent:status', { projectId, status: 'active', sessionId });
}

export function deactivateAgent(projectId: string): void {
  activeAgents.delete(projectId);
  projectEmitter.emit('agent:status', { projectId, status: 'inactive' });
}

export function getAgentSessionId(projectId: string): string | undefined {
  return activeAgents.get(projectId);
}
