/**
 * Management routes — services, scripts, env file, running processes.
 * Scoped to a project path via ?project= query param.
 */
import { Router } from 'express';
import { randomUUID } from 'crypto';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { spawn } from 'child_process';
import { z } from 'zod';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';
import { db } from '../db/database.js';
import {
  startService,
  stopService,
  getServiceStatus,
  getRunningEntry,
} from '../services/project-manager.js';
import { bootstrapProject, discoverEnvFiles } from '../services/project-bootstrap.js';
import { createLogger } from '../logger.js';
import { validate } from '../middleware/validate.js';

const log = createLogger('management');
const router: ReturnType<typeof Router> = Router();
router.use(authMiddleware);

// ─── Types ────────────────────────────────────────────────────────────────────

interface ServiceRow {
  id: string;
  user_id: number;
  name: string;
  command: string;
  cwd: string;
  project_path: string;
  sort_order: number;
  created_at: string;
}

interface ScriptRow {
  id: string;
  user_id: number;
  name: string;
  command: string;
  cwd: string;
  project_path: string;
  sort_order: number;
  created_at: string;
}

function rowToService(s: ServiceRow) {
  const entry = getRunningEntry(s.id);
  return {
    id: s.id,
    name: s.name,
    command: s.command,
    cwd: s.cwd,
    projectPath: s.project_path,
    sortOrder: s.sort_order,
    status: getServiceStatus(s.id),
    pid: entry?.pid,
    startedAt: entry?.startedAt,
    createdAt: s.created_at,
  };
}

function rowToScript(s: ScriptRow) {
  return {
    id: s.id,
    name: s.name,
    command: s.command,
    cwd: s.cwd,
    projectPath: s.project_path,
    sortOrder: s.sort_order,
    createdAt: s.created_at,
  };
}

// ─── Services ─────────────────────────────────────────────────────────────────

router.get('/services', async (req: AuthRequest, res) => {
  const project = req.query.project as string | undefined;
  let query = db('management_services')
    .where({ user_id: req.user!.id })
    .orderBy('sort_order', 'asc')
    .orderBy('created_at', 'asc');
  if (project) {
    query = query.andWhere({ project_path: project });
  }
  const rows = await query.select() as ServiceRow[];
  res.json({ services: rows.map(rowToService) });
});

router.post('/services', validate({
  body: z.object({
    name: z.string().min(1),
    command: z.string().min(1),
    cwd: z.string().optional(),
    projectPath: z.string().optional(),
  }),
}), async (req: AuthRequest, res) => {
  const { name, command, cwd, projectPath } = req.body as { name: string; command: string; cwd?: string; projectPath?: string };

  const maxRow = await db('management_services')
    .where({ user_id: req.user!.id })
    .max('sort_order as max_sort')
    .first();
  const maxOrder = (((maxRow as any)?.max_sort) ?? -1) + 1;
  const id = randomUUID();
  await db('management_services').insert({
    id, user_id: req.user!.id, name, command,
    cwd: cwd || '', project_path: projectPath || '', sort_order: maxOrder,
  });

  const row = await db('management_services').where({ id }).first() as ServiceRow;
  res.status(201).json({ service: rowToService(row) });
});

router.put('/services/:id', async (req: AuthRequest, res) => {
  const existing = await db('management_services')
    .where({ id: req.params.id, user_id: req.user!.id })
    .first();
  if (!existing) { res.status(404).json({ error: 'Service not found' }); return; }

  const { name, command, cwd } = req.body as { name?: string; command?: string; cwd?: string };
  const updates: Record<string, unknown> = {};
  if (name !== undefined) updates['name'] = name;
  if (command !== undefined) updates['command'] = command;
  if (cwd !== undefined) updates['cwd'] = cwd;
  if (Object.keys(updates).length === 0) { res.json({ ok: true }); return; }
  await db('management_services')
    .where({ id: req.params.id, user_id: req.user!.id })
    .update(updates);

  const row = await db('management_services').where({ id: req.params.id }).first() as ServiceRow;
  res.json({ service: rowToService(row) });
});

router.delete('/services/:id', async (req: AuthRequest, res) => {
  const existing = await db('management_services')
    .where({ id: req.params.id, user_id: req.user!.id })
    .first();
  if (!existing) { res.status(404).json({ error: 'Service not found' }); return; }
  stopService(req.params.id);
  await db('management_services')
    .where({ id: req.params.id, user_id: req.user!.id })
    .delete();
  res.json({ ok: true });
});

router.post('/services/:id/start', async (req: AuthRequest, res) => {
  const s = await db('management_services')
    .where({ id: req.params.id, user_id: req.user!.id })
    .first() as ServiceRow | undefined;
  if (!s) { res.status(404).json({ error: 'Service not found' }); return; }
  startService(s.id, '__management__', s.command, s.cwd || process.cwd());
  res.json({ ok: true });
});

router.post('/services/:id/stop', async (req: AuthRequest, res) => {
  const existing = await db('management_services')
    .where({ id: req.params.id, user_id: req.user!.id })
    .first();
  if (!existing) { res.status(404).json({ error: 'Service not found' }); return; }
  stopService(req.params.id);
  res.json({ ok: true });
});

router.post('/services/reorder', validate({
  body: z.object({ ids: z.array(z.string()) }),
}), async (req: AuthRequest, res) => {
  const { ids } = req.body as { ids: string[] };
  await db.transaction(async (trx) => {
    for (let i = 0; i < ids.length; i++) {
      await trx('management_services')
        .where({ id: ids[i], user_id: req.user!.id })
        .update({ sort_order: i });
    }
  });
  res.json({ ok: true });
});

// ─── Scripts ──────────────────────────────────────────────────────────────────

router.get('/scripts', async (req: AuthRequest, res) => {
  const project = req.query.project as string | undefined;
  let query = db('management_scripts')
    .where({ user_id: req.user!.id })
    .orderBy('sort_order', 'asc')
    .orderBy('created_at', 'asc');
  if (project) {
    query = query.andWhere({ project_path: project });
  }
  const rows = await query.select() as ScriptRow[];
  res.json({ scripts: rows.map(rowToScript) });
});

router.post('/scripts', validate({
  body: z.object({
    name: z.string().min(1),
    command: z.string().min(1),
    cwd: z.string().optional(),
    projectPath: z.string().optional(),
  }),
}), async (req: AuthRequest, res) => {
  const { name, command, cwd, projectPath } = req.body as { name: string; command: string; cwd?: string; projectPath?: string };
  const maxRow = await db('management_scripts')
    .where({ user_id: req.user!.id })
    .max('sort_order as max_sort')
    .first();
  const maxOrder = (((maxRow as any)?.max_sort) ?? -1) + 1;
  const id = randomUUID();
  await db('management_scripts').insert({
    id, user_id: req.user!.id, name, command,
    cwd: cwd || '', project_path: projectPath || '', sort_order: maxOrder,
  });
  const row = await db('management_scripts').where({ id }).first() as ScriptRow;
  res.status(201).json({ script: rowToScript(row) });
});

router.delete('/scripts/:id', async (req: AuthRequest, res) => {
  await db('management_scripts')
    .where({ id: req.params.id, user_id: req.user!.id })
    .delete();
  res.json({ ok: true });
});

// POST /scripts/:id/run — execute script, stream output via SSE
router.post('/scripts/:id/run', async (req: AuthRequest, res) => {
  const s = await db('management_scripts')
    .where({ id: req.params.id, user_id: req.user!.id })
    .first() as ScriptRow | undefined;
  if (!s) { res.status(404).json({ error: 'Script not found' }); return; }

  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });

  const proc = spawn(s.command, { cwd: s.cwd || process.cwd(), shell: true, stdio: ['ignore', 'pipe', 'pipe'] });

  const send = (type: string, data: unknown) => res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);

  proc.stdout?.on('data', (d: Buffer) => send('output', { stream: 'stdout', data: d.toString() }));
  proc.stderr?.on('data', (d: Buffer) => send('output', { stream: 'stderr', data: d.toString() }));
  proc.on('exit', (code) => { send('done', { exitCode: code }); res.end(); });
  proc.on('error', (err) => { send('error', { error: err.message }); res.end(); });
  res.on('close', () => { try { proc.kill(); } catch { /* ignore */ } });
});

// ─── Env file ─────────────────────────────────────────────────────────────────

// Discover .env files recursively in the project directory
router.get('/env/discover', validate({ query: z.object({ project: z.string().min(1) }) }), (req: AuthRequest, res) => {
  const projectPath = req.query.project as string;
  try {
    const files = discoverEnvFiles(projectPath);
    res.json({ files });
  } catch (err) {
    log.warn({ err, projectPath }, 'Failed to discover env files');
    res.status(500).json({ error: 'Failed to discover env files' });
  }
});

router.get('/env', validate({ query: z.object({ path: z.string().min(1) }) }), (req: AuthRequest, res) => {
  const filePath = req.query.path as string;
  if (!existsSync(filePath)) { res.json({ content: '' }); return; }
  try {
    const content = readFileSync(filePath, 'utf8');
    res.json({ content });
  } catch (err) {
    log.warn({ err, filePath }, 'Failed to read env file');
    res.status(500).json({ error: 'Failed to read file' });
  }
});

router.put('/env', validate({
  body: z.object({ path: z.string().min(1), content: z.string() }),
}), (req: AuthRequest, res) => {
  const { path: filePath, content } = req.body as { path: string; content: string };
  try {
    writeFileSync(filePath, content, 'utf8');
    res.json({ ok: true });
  } catch (err) {
    log.warn({ err, filePath }, 'Failed to write env file');
    res.status(500).json({ error: 'Failed to write file' });
  }
});

// ─── Bootstrap ───────────────────────────────────────────────────────────────

router.post('/bootstrap', validate({
  body: z.object({ projectPath: z.string().min(1) }),
}), async (req: AuthRequest, res) => {
  const { projectPath } = req.body as { projectPath: string };
  try {
    const result = await bootstrapProject(req.user!.id, projectPath);
    res.json(result);
  } catch (err) {
    log.error({ err, projectPath }, 'Bootstrap failed');
    res.status(500).json({ error: 'Bootstrap failed' });
  }
});

// ─── Running processes ────────────────────────────────────────────────────────

router.get('/processes', async (req: AuthRequest, res) => {
  const project = req.query.project as string | undefined;
  let query = db('management_services').where({ user_id: req.user!.id });
  if (project) {
    query = query.andWhere({ project_path: project });
  }
  const serviceRows = await query.select() as ServiceRow[];
  const processes = serviceRows
    .map(s => {
      const entry = getRunningEntry(s.id);
      if (!entry) return null;
      const uptimeMs = Date.now() - entry.startedAt;
      return {
        serviceId: s.id,
        name: s.name,
        command: s.command,
        cwd: s.cwd,
        pid: entry.pid,
        uptimeMs,
        status: 'running' as const,
      };
    })
    .filter(Boolean);
  res.json({ processes });
});

export default router;
