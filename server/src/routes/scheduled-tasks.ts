import { Router } from 'express';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import cron from 'node-cron';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';
import { getDb } from '../db/database.js';
import { validate } from '../middleware/validate.js';
import {
  scheduleTask,
  unscheduleTask,
  refreshTask,
  executeTask,
  type ScheduledTask,
  type TaskExecution,
} from '../services/task-scheduler.js';
import { createLogger } from '../logger.js';

const log = createLogger('scheduled-tasks-routes');
const router: ReturnType<typeof Router> = Router();
router.use(authMiddleware);

// ─── Row → DTO helpers ──────────────────────────────────────────────────────

interface ScheduledTaskRow {
  id: string;
  name: string;
  description: string;
  prompt: string;
  schedule: string;
  project_dir: string;
  enabled: number;
  last_run_at: string | null;
  next_run_at: string | null;
  status: string;
  created_at: string;
}

interface ExecutionRow {
  id: string;
  task_id: string;
  status: string;
  output: string;
  error: string | null;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
}

function rowToDto(row: ScheduledTaskRow) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    prompt: row.prompt,
    schedule: row.schedule,
    projectDir: row.project_dir,
    enabled: !!row.enabled,
    lastRunAt: row.last_run_at,
    nextRunAt: row.next_run_at,
    status: row.status,
    createdAt: row.created_at,
  };
}

function executionToDto(row: ExecutionRow) {
  return {
    id: row.id,
    taskId: row.task_id,
    status: row.status,
    output: row.output,
    error: row.error,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    durationMs: row.duration_ms,
  };
}

// ─── GET / — list all scheduled tasks ──────────────────────────────────────

router.get('/', (_req: AuthRequest, res) => {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM scheduled_tasks ORDER BY created_at DESC').all() as ScheduledTaskRow[];
  res.json({ tasks: rows.map(rowToDto) });
});

// ─── POST / — create a new scheduled task ──────────────────────────────────

router.post('/', validate({
  body: z.object({
    name: z.string().min(1).max(200),
    description: z.string().max(2000).optional(),
    prompt: z.string().min(1),
    schedule: z.string().min(1),
    projectDir: z.string().min(1),
    enabled: z.boolean().optional(),
  }),
}), (req: AuthRequest, res) => {
  const { name, description, prompt, schedule, projectDir, enabled } = req.body;

  if (!cron.validate(schedule)) {
    res.status(400).json({ error: 'Invalid cron expression' });
    return;
  }

  const db = getDb();
  const id = randomUUID();
  const isEnabled = enabled !== false ? 1 : 0;

  db.prepare(`
    INSERT INTO scheduled_tasks (id, name, description, prompt, schedule, project_dir, enabled, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'idle')
  `).run(id, name, description || '', prompt, schedule, projectDir, isEnabled);

  const row = db.prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get(id) as ScheduledTaskRow;

  // Schedule it if enabled
  if (isEnabled) {
    scheduleTask(row as unknown as ScheduledTask);
    // Re-read to get updated nextRunAt
    const updated = db.prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get(id) as ScheduledTaskRow;
    res.status(201).json(rowToDto(updated));
    return;
  }

  res.status(201).json(rowToDto(row));
});

// ─── PATCH /:id — update a scheduled task ──────────────────────────────────

router.patch('/:id', (req: AuthRequest, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get(req.params.id) as ScheduledTaskRow | undefined;
  if (!existing) {
    res.status(404).json({ error: 'Scheduled task not found' });
    return;
  }

  const { name, description, prompt, schedule, projectDir, enabled } = req.body;

  // Validate cron if provided
  if (schedule !== undefined && !cron.validate(schedule)) {
    res.status(400).json({ error: 'Invalid cron expression' });
    return;
  }

  const updates: string[] = [];
  const params: unknown[] = [];

  if (name !== undefined) { updates.push('name = ?'); params.push(name); }
  if (description !== undefined) { updates.push('description = ?'); params.push(description); }
  if (prompt !== undefined) { updates.push('prompt = ?'); params.push(prompt); }
  if (schedule !== undefined) { updates.push('schedule = ?'); params.push(schedule); }
  if (projectDir !== undefined) { updates.push('project_dir = ?'); params.push(projectDir); }
  if (enabled !== undefined) { updates.push('enabled = ?'); params.push(enabled ? 1 : 0); }

  if (updates.length === 0) {
    res.json(rowToDto(existing));
    return;
  }

  params.push(req.params.id);
  db.prepare(`UPDATE scheduled_tasks SET ${updates.join(', ')} WHERE id = ?`).run(...params);

  // Refresh the cron job
  refreshTask(req.params.id as string);

  const row = db.prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get(req.params.id) as ScheduledTaskRow;
  res.json(rowToDto(row));
});

// ─── DELETE /:id — delete a scheduled task ─────────────────────────────────

router.delete('/:id', (req: AuthRequest, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT id FROM scheduled_tasks WHERE id = ?').get(req.params.id);
  if (!existing) {
    res.status(404).json({ error: 'Scheduled task not found' });
    return;
  }

  unscheduleTask(req.params.id as string);
  db.prepare('DELETE FROM scheduled_tasks WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ─── POST /:id/run — manually trigger a task ──────────────────────────────

router.post('/:id/run', (req: AuthRequest, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get(req.params.id) as ScheduledTaskRow | undefined;
  if (!existing) {
    res.status(404).json({ error: 'Scheduled task not found' });
    return;
  }

  // Execute asynchronously and return immediately
  res.json({ message: 'Task execution started', taskId: req.params.id });

  executeTask(req.params.id as string).catch((err) => {
    log.error({ err, taskId: req.params.id }, 'Manual task execution failed');
  });
});

// ─── GET /:id/history — get execution history ─────────────────────────────

router.get('/:id/history', (req: AuthRequest, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT id FROM scheduled_tasks WHERE id = ?').get(req.params.id);
  if (!existing) {
    res.status(404).json({ error: 'Scheduled task not found' });
    return;
  }

  const limit = Math.min(parseInt(req.query.limit as string, 10) || 50, 200);
  const offset = parseInt(req.query.offset as string, 10) || 0;

  const rows = db.prepare(
    'SELECT * FROM scheduled_task_executions WHERE task_id = ? ORDER BY started_at DESC LIMIT ? OFFSET ?',
  ).all(req.params.id, limit, offset) as ExecutionRow[];

  const total = (db.prepare(
    'SELECT COUNT(*) as count FROM scheduled_task_executions WHERE task_id = ?',
  ).get(req.params.id) as { count: number }).count;

  res.json({ executions: rows.map(executionToDto), total });
});

export default router;
