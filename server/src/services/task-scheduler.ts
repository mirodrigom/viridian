/**
 * Task Scheduler — manages cron-based scheduled tasks that run AI prompts
 * automatically on a recurring schedule.
 */

import cron, { type ScheduledTask as CronJob } from 'node-cron';
import { randomUUID } from 'crypto';
import { db } from '../db/database.js';
import { getDefaultProvider } from '../providers/registry.js';
import { createLogger } from '../logger.js';

const log = createLogger('task-scheduler');

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ScheduledTask {
  id: string;
  name: string;
  description: string;
  prompt: string;
  schedule: string;
  projectDir: string;
  enabled: number;
  lastRunAt: string | null;
  nextRunAt: string | null;
  status: string;
  createdAt: string;
}

export interface TaskExecution {
  id: string;
  taskId: string;
  status: string;
  output: string;
  error: string | null;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
}

// ─── In-memory cron job tracking ──────────────────────────────────────────────

const activeCronJobs = new Map<string, CronJob>();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function computeNextRun(schedule: string): string | null {
  try {
    // Use node-cron's validate + manual next-run calculation
    if (!cron.validate(schedule)) return null;
    // node-cron doesn't expose "next run" natively, so we compute from the expression
    const interval = parseNextCronDate(schedule);
    return interval ? interval.toISOString() : null;
  } catch {
    return null;
  }
}

/**
 * Simple next-cron-date calculator.
 * Checks each minute for the next 48 hours to find when the cron expression matches.
 */
function parseNextCronDate(expression: string): Date | null {
  const now = new Date();
  // Start from the next full minute
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes() + 1, 0, 0);

  // Check each minute for 48 hours
  for (let i = 0; i < 48 * 60; i++) {
    const candidate = new Date(start.getTime() + i * 60_000);
    // Build a temporary task and see if cron would fire
    // We test by constructing date parts and matching against cron fields
    if (matchesCron(expression, candidate)) {
      return candidate;
    }
  }
  return null;
}

function matchesCron(expression: string, date: Date): boolean {
  const parts = expression.trim().split(/\s+/);
  if (parts.length < 5) return false;

  const [minExpr, hourExpr, domExpr, monExpr, dowExpr] = parts;

  return (
    matchField(minExpr!, date.getMinutes(), 0, 59) &&
    matchField(hourExpr!, date.getHours(), 0, 23) &&
    matchField(domExpr!, date.getDate(), 1, 31) &&
    matchField(monExpr!, date.getMonth() + 1, 1, 12) &&
    matchField(dowExpr!, date.getDay(), 0, 7)
  );
}

function matchField(expr: string, value: number, _min: number, _max: number): boolean {
  if (expr === '*') return true;

  // Handle */N step values
  if (expr.startsWith('*/')) {
    const step = parseInt(expr.slice(2), 10);
    if (isNaN(step) || step === 0) return false;
    return value % step === 0;
  }

  // Handle comma-separated values
  const parts = expr.split(',');
  for (const part of parts) {
    // Handle ranges like 1-5
    if (part.includes('-')) {
      const [start, end] = part.split('-').map(Number);
      if (value >= start! && value <= end!) return true;
    } else {
      const num = parseInt(part, 10);
      // For DOW, treat 7 as 0 (Sunday)
      if (num === value || (num === 7 && value === 0)) return true;
    }
  }

  return false;
}

// ─── Core scheduler functions ─────────────────────────────────────────────────

export async function startTaskScheduler(): Promise<void> {
  log.info('Starting task scheduler');
  const tasks = await db('scheduled_tasks').where({ enabled: 1 }).select('*') as ScheduledTask[];

  for (const task of tasks) {
    scheduleTask(task);
  }

  log.info({ count: tasks.length }, 'Loaded scheduled tasks');
}

export function stopTaskScheduler(): void {
  log.info('Stopping task scheduler');
  for (const [id, job] of activeCronJobs) {
    job.stop();
    log.debug({ taskId: id }, 'Stopped cron job');
  }
  activeCronJobs.clear();
}

export function scheduleTask(task: ScheduledTask): void {
  // Remove existing job if any
  unscheduleTask(task.id);

  if (!task.enabled || !cron.validate(task.schedule)) {
    log.warn({ taskId: task.id, schedule: task.schedule }, 'Invalid cron schedule or task disabled');
    return;
  }

  const job = cron.schedule(task.schedule, () => {
    executeTask(task.id).catch((err) => {
      log.error({ err, taskId: task.id }, 'Failed to execute scheduled task');
    });
  });

  activeCronJobs.set(task.id, job);

  // Update nextRunAt
  const nextRun = computeNextRun(task.schedule);
  if (nextRun) {
    db('scheduled_tasks').where({ id: task.id }).update({ next_run_at: nextRun }).catch(() => { /* ignore */ });
  }

  log.info({ taskId: task.id, name: task.name, schedule: task.schedule }, 'Scheduled task');
}

export function unscheduleTask(taskId: string): void {
  const existing = activeCronJobs.get(taskId);
  if (existing) {
    existing.stop();
    activeCronJobs.delete(taskId);
    log.debug({ taskId }, 'Unscheduled task');
  }
}

export async function executeTask(taskId: string): Promise<TaskExecution> {
  const task = await db('scheduled_tasks').where({ id: taskId }).first() as ScheduledTask | undefined;

  if (!task) {
    throw new Error(`Scheduled task not found: ${taskId}`);
  }

  const executionId = randomUUID();
  const startedAt = new Date().toISOString();

  // Create execution record
  await db('scheduled_task_executions').insert({
    id: executionId,
    task_id: taskId,
    status: 'running',
    output: '',
    started_at: startedAt,
  });

  // Update task status
  await db('scheduled_tasks').where({ id: taskId }).update({ status: 'running', last_run_at: startedAt });

  log.info({ taskId, executionId, name: task.name }, 'Executing scheduled task');

  let output = '';
  let error: string | null = null;
  let status = 'success';

  try {
    const provider = getDefaultProvider();
    const abortController = new AbortController();

    // Set a 10-minute timeout for task execution
    const timeout = setTimeout(() => abortController.abort(), 10 * 60_000);

    try {
      for await (const msg of provider.query({
        prompt: task.prompt,
        cwd: task.projectDir,
        permissionMode: 'auto',
        abortSignal: abortController.signal,
      })) {
        if (msg.type === 'text_delta') {
          output += msg.text;
        }
        if (msg.type === 'error') {
          error = msg.error;
          status = 'failure';
        }
      }
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    status = 'failure';
    log.error({ err, taskId, executionId }, 'Task execution failed');
  }

  const completedAt = new Date().toISOString();
  const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();

  // Update execution record
  await db('scheduled_task_executions').where({ id: executionId }).update({
    status,
    output,
    error,
    completed_at: completedAt,
    duration_ms: durationMs,
  });

  // Update task status and compute next run
  const nextRun = computeNextRun(task.schedule);
  await db('scheduled_tasks').where({ id: taskId }).update({
    status: status === 'success' ? 'idle' : 'error',
    next_run_at: nextRun,
  });

  log.info({ taskId, executionId, status, durationMs }, 'Task execution completed');

  return {
    id: executionId,
    taskId,
    status,
    output,
    error,
    startedAt,
    completedAt,
    durationMs,
  };
}

/** Refresh scheduling for a task (after update). */
export async function refreshTask(taskId: string): Promise<void> {
  const task = await db('scheduled_tasks').where({ id: taskId }).first() as ScheduledTask | undefined;
  if (!task) {
    unscheduleTask(taskId);
    return;
  }
  if (task.enabled) {
    scheduleTask(task);
  } else {
    unscheduleTask(taskId);
  }
}
