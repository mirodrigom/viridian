/**
 * Management routes — services, scripts, env file, running processes.
 * Scoped to a project path via ?project= query param.
 */
import { Router } from 'express';
import { randomUUID } from 'crypto';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { spawn } from 'child_process';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';
import { getDb } from '../db/database.js';
import {
  startService,
  stopService,
  getServiceStatus,
  getRunningEntry,
} from '../services/project-manager.js';

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

router.get('/services', (req: AuthRequest, res) => {
  const db = getDb();
  const project = req.query.project as string | undefined;
  let rows: ServiceRow[];
  if (project) {
    rows = db.prepare('SELECT * FROM management_services WHERE user_id = ? AND project_path = ? ORDER BY sort_order ASC, created_at ASC')
      .all(req.user!.id, project) as ServiceRow[];
  } else {
    rows = db.prepare('SELECT * FROM management_services WHERE user_id = ? ORDER BY sort_order ASC, created_at ASC')
      .all(req.user!.id) as ServiceRow[];
  }
  res.json({ services: rows.map(rowToService) });
});

router.post('/services', (req: AuthRequest, res) => {
  const { name, command, cwd, projectPath } = req.body as { name?: string; command?: string; cwd?: string; projectPath?: string };
  if (!name || !command) { res.status(400).json({ error: 'name and command are required' }); return; }

  const db = getDb();
  const maxOrder = (db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM management_services WHERE user_id = ?').get(req.user!.id) as { next: number }).next;
  const id = randomUUID();
  db.prepare('INSERT INTO management_services (id, user_id, name, command, cwd, project_path, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, req.user!.id, name, command, cwd || '', projectPath || '', maxOrder);

  const row = db.prepare('SELECT * FROM management_services WHERE id = ?').get(id) as ServiceRow;
  res.status(201).json({ service: rowToService(row) });
});

router.put('/services/:id', (req: AuthRequest, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT id FROM management_services WHERE id = ? AND user_id = ?').get(req.params.id, req.user!.id);
  if (!existing) { res.status(404).json({ error: 'Service not found' }); return; }

  const { name, command, cwd } = req.body as { name?: string; command?: string; cwd?: string };
  const updates: string[] = [];
  const params: unknown[] = [];
  if (name !== undefined) { updates.push('name = ?'); params.push(name); }
  if (command !== undefined) { updates.push('command = ?'); params.push(command); }
  if (cwd !== undefined) { updates.push('cwd = ?'); params.push(cwd); }
  if (updates.length === 0) { res.json({ ok: true }); return; }
  params.push(req.params.id, req.user!.id);
  db.prepare(`UPDATE management_services SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`).run(...params);

  const row = db.prepare('SELECT * FROM management_services WHERE id = ?').get(req.params.id) as ServiceRow;
  res.json({ service: rowToService(row) });
});

router.delete('/services/:id', (req: AuthRequest, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT id FROM management_services WHERE id = ? AND user_id = ?').get(req.params.id, req.user!.id);
  if (!existing) { res.status(404).json({ error: 'Service not found' }); return; }
  stopService(req.params.id);
  db.prepare('DELETE FROM management_services WHERE id = ? AND user_id = ?').run(req.params.id, req.user!.id);
  res.json({ ok: true });
});

router.post('/services/:id/start', (req: AuthRequest, res) => {
  const db = getDb();
  const s = db.prepare('SELECT * FROM management_services WHERE id = ? AND user_id = ?').get(req.params.id, req.user!.id) as ServiceRow | undefined;
  if (!s) { res.status(404).json({ error: 'Service not found' }); return; }
  startService(s.id, '__management__', s.command, s.cwd || process.cwd());
  res.json({ ok: true });
});

router.post('/services/:id/stop', (req: AuthRequest, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT id FROM management_services WHERE id = ? AND user_id = ?').get(req.params.id, req.user!.id);
  if (!existing) { res.status(404).json({ error: 'Service not found' }); return; }
  stopService(req.params.id);
  res.json({ ok: true });
});

router.post('/services/reorder', (req: AuthRequest, res) => {
  const { ids } = req.body as { ids?: string[] };
  if (!Array.isArray(ids)) { res.status(400).json({ error: 'ids array required' }); return; }
  const db = getDb();
  const stmt = db.prepare('UPDATE management_services SET sort_order = ? WHERE id = ? AND user_id = ?');
  const tx = db.transaction(() => { ids.forEach((id, i) => stmt.run(i, id, req.user!.id)); });
  tx();
  res.json({ ok: true });
});

// ─── Scripts ──────────────────────────────────────────────────────────────────

router.get('/scripts', (req: AuthRequest, res) => {
  const db = getDb();
  const project = req.query.project as string | undefined;
  let rows: ScriptRow[];
  if (project) {
    rows = db.prepare('SELECT * FROM management_scripts WHERE user_id = ? AND project_path = ? ORDER BY sort_order ASC, created_at ASC')
      .all(req.user!.id, project) as ScriptRow[];
  } else {
    rows = db.prepare('SELECT * FROM management_scripts WHERE user_id = ? ORDER BY sort_order ASC, created_at ASC')
      .all(req.user!.id) as ScriptRow[];
  }
  res.json({ scripts: rows.map(rowToScript) });
});

router.post('/scripts', (req: AuthRequest, res) => {
  const { name, command, cwd, projectPath } = req.body as { name?: string; command?: string; cwd?: string; projectPath?: string };
  if (!name || !command) { res.status(400).json({ error: 'name and command are required' }); return; }
  const db = getDb();
  const maxOrder = (db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM management_scripts WHERE user_id = ?').get(req.user!.id) as { next: number }).next;
  const id = randomUUID();
  db.prepare('INSERT INTO management_scripts (id, user_id, name, command, cwd, project_path, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, req.user!.id, name, command, cwd || '', projectPath || '', maxOrder);
  const row = db.prepare('SELECT * FROM management_scripts WHERE id = ?').get(id) as ScriptRow;
  res.status(201).json({ script: rowToScript(row) });
});

router.delete('/scripts/:id', (req: AuthRequest, res) => {
  const db = getDb();
  db.prepare('DELETE FROM management_scripts WHERE id = ? AND user_id = ?').run(req.params.id, req.user!.id);
  res.json({ ok: true });
});

// POST /scripts/:id/run — execute script, stream output via SSE
router.post('/scripts/:id/run', (req: AuthRequest, res) => {
  const db = getDb();
  const s = db.prepare('SELECT * FROM management_scripts WHERE id = ? AND user_id = ?').get(req.params.id, req.user!.id) as ScriptRow | undefined;
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

router.get('/env', (req: AuthRequest, res) => {
  const filePath = req.query.path as string;
  if (!filePath) { res.status(400).json({ error: 'path query param required' }); return; }
  if (!existsSync(filePath)) { res.json({ content: '' }); return; }
  try {
    const content = readFileSync(filePath, 'utf8');
    res.json({ content });
  } catch (err) {
    res.status(500).json({ error: 'Failed to read file' });
  }
});

router.put('/env', (req: AuthRequest, res) => {
  const { path: filePath, content } = req.body as { path?: string; content?: string };
  if (!filePath || content === undefined) { res.status(400).json({ error: 'path and content are required' }); return; }
  try {
    writeFileSync(filePath, content, 'utf8');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to write file' });
  }
});

// ─── Running processes ────────────────────────────────────────────────────────

router.get('/processes', (req: AuthRequest, res) => {
  const db = getDb();
  const project = req.query.project as string | undefined;
  let serviceRows: ServiceRow[];
  if (project) {
    serviceRows = db.prepare('SELECT * FROM management_services WHERE user_id = ? AND project_path = ?').all(req.user!.id, project) as ServiceRow[];
  } else {
    serviceRows = db.prepare('SELECT * FROM management_services WHERE user_id = ?').all(req.user!.id) as ServiceRow[];
  }
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
