import { Router } from 'express';
import { randomUUID } from 'crypto';
import { existsSync } from 'fs';
import { z } from 'zod';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';
import { getDb } from '../db/database.js';
import {
  startService,
  stopService,
  stopAllForProject,
  getServiceStatus,
  activateAgent,
  deactivateAgent,
  getAgentSessionId,
} from '../services/project-manager.js';
import { createLogger } from '../logger.js';
import { validate } from '../middleware/validate.js';

const log = createLogger('projects');
const router: ReturnType<typeof Router> = Router();
router.use(authMiddleware);

interface ProjectRow {
  id: string;
  user_id: number;
  name: string;
  path: string;
  description: string;
  created_at: string;
  updated_at: string;
}

interface ServiceRow {
  id: string;
  project_id: string;
  name: string;
  command: string;
  sort_order: number;
  created_at: string;
}

function rowToService(s: ServiceRow) {
  return {
    id: s.id,
    projectId: s.project_id,
    name: s.name,
    command: s.command,
    sortOrder: s.sort_order,
    status: getServiceStatus(s.id),
    createdAt: s.created_at,
  };
}

function rowToProject(row: ProjectRow, services: ServiceRow[]) {
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    services: services.map(rowToService),
    agentStatus: getAgentSessionId(row.id) ? 'active' : 'inactive',
    agentSessionId: getAgentSessionId(row.id),
  };
}

// GET / — list all projects for user
router.get('/', (req: AuthRequest, res) => {
  const db = getDb();
  const projects = db
    .prepare('SELECT * FROM projects WHERE user_id = ? ORDER BY created_at DESC')
    .all(req.user!.id) as ProjectRow[];

  const result = projects.map(p => {
    const services = db
      .prepare('SELECT * FROM project_services WHERE project_id = ? ORDER BY sort_order ASC')
      .all(p.id) as ServiceRow[];
    return rowToProject(p, services);
  });

  res.json({ projects: result });
});

// GET /:id — get single project
router.get('/:id', (req: AuthRequest, res) => {
  const db = getDb();
  const p = db
    .prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user!.id) as ProjectRow | undefined;
  if (!p) { res.status(404).json({ error: 'Project not found' }); return; }

  const services = db
    .prepare('SELECT * FROM project_services WHERE project_id = ? ORDER BY sort_order ASC')
    .all(p.id) as ServiceRow[];
  res.json({ project: rowToProject(p, services) });
});

// POST / — create project
router.post('/', validate({
  body: z.object({
    name: z.string().min(1),
    path: z.string().min(1),
    description: z.string().optional(),
    services: z.array(z.object({ name: z.string(), command: z.string() })).optional(),
  }),
}), (req: AuthRequest, res) => {
  const { name, path, description, services } = req.body as {
    name: string;
    path: string;
    description?: string;
    services?: { name: string; command: string }[];
  };
  if (!existsSync(path)) {
    res.status(400).json({ error: 'Path does not exist on the server filesystem' });
    return;
  }

  const db = getDb();
  const id = randomUUID();
  db.prepare('INSERT INTO projects (id, user_id, name, path, description) VALUES (?, ?, ?, ?, ?)')
    .run(id, req.user!.id, name, path, description || '');

  if (Array.isArray(services) && services.length > 0) {
    const insertService = db.prepare(
      'INSERT INTO project_services (id, project_id, name, command, sort_order) VALUES (?, ?, ?, ?, ?)',
    );
    services.forEach((s, i) => {
      insertService.run(randomUUID(), id, s.name, s.command, i);
    });
  }

  const p = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow;
  const svcs = db
    .prepare('SELECT * FROM project_services WHERE project_id = ? ORDER BY sort_order ASC')
    .all(id) as ServiceRow[];
  res.status(201).json({ project: rowToProject(p, svcs) });
});

// PUT /:id — update project metadata
router.put('/:id', (req: AuthRequest, res) => {
  const db = getDb();
  const existing = db
    .prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user!.id) as ProjectRow | undefined;
  if (!existing) { res.status(404).json({ error: 'Project not found' }); return; }

  const { name, description } = req.body as { name?: string; description?: string };
  const updates: string[] = [];
  const params: unknown[] = [];
  if (name !== undefined) { updates.push('name = ?'); params.push(name); }
  if (description !== undefined) { updates.push('description = ?'); params.push(description); }
  if (updates.length === 0) {
    const svcs = db.prepare('SELECT * FROM project_services WHERE project_id = ? ORDER BY sort_order ASC').all(existing.id) as ServiceRow[];
    res.json({ project: rowToProject(existing, svcs) });
    return;
  }

  updates.push('updated_at = CURRENT_TIMESTAMP');
  params.push(req.params.id, req.user!.id);
  db.prepare(`UPDATE projects SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`).run(...params);

  const p = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id) as ProjectRow;
  const svcs = db.prepare('SELECT * FROM project_services WHERE project_id = ? ORDER BY sort_order ASC').all(p.id) as ServiceRow[];
  res.json({ project: rowToProject(p, svcs) });
});

// DELETE /:id — delete project + stop all its services
router.delete('/:id', (req: AuthRequest, res) => {
  const db = getDb();
  const existing = db
    .prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user!.id);
  if (!existing) { res.status(404).json({ error: 'Project not found' }); return; }

  stopAllForProject(req.params.id);
  deactivateAgent(req.params.id);
  db.prepare('DELETE FROM projects WHERE id = ? AND user_id = ?').run(req.params.id, req.user!.id);
  res.json({ ok: true });
});

// POST /:id/services — add a service to a project
router.post('/:id/services', (req: AuthRequest, res) => {
  const db = getDb();
  const p = db
    .prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user!.id);
  if (!p) { res.status(404).json({ error: 'Project not found' }); return; }

  const { name, command } = req.body as { name: string; command: string };
  if (!name || !command) { res.status(400).json({ error: 'name and command are required' }); return; }

  const maxOrder = (
    db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM project_services WHERE project_id = ?')
      .get(req.params.id) as { next: number }
  ).next;

  const sid = randomUUID();
  db.prepare('INSERT INTO project_services (id, project_id, name, command, sort_order) VALUES (?, ?, ?, ?, ?)')
    .run(sid, req.params.id, name, command, maxOrder);

  const s = db.prepare('SELECT * FROM project_services WHERE id = ?').get(sid) as ServiceRow;
  res.status(201).json({ service: rowToService(s) });
});

// DELETE /:id/services/:sid — remove a service
router.delete('/:id/services/:sid', (req: AuthRequest, res) => {
  const db = getDb();
  const p = db
    .prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user!.id);
  if (!p) { res.status(404).json({ error: 'Project not found' }); return; }

  stopService(req.params.sid);
  db.prepare('DELETE FROM project_services WHERE id = ? AND project_id = ?')
    .run(req.params.sid, req.params.id);
  res.json({ ok: true });
});

// POST /:id/services/:sid/start — start a service
router.post('/:id/services/:sid/start', (req: AuthRequest, res) => {
  const db = getDb();
  const p = db
    .prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user!.id) as ProjectRow | undefined;
  if (!p) { res.status(404).json({ error: 'Project not found' }); return; }

  const s = db
    .prepare('SELECT * FROM project_services WHERE id = ? AND project_id = ?')
    .get(req.params.sid, req.params.id) as ServiceRow | undefined;
  if (!s) { res.status(404).json({ error: 'Service not found' }); return; }

  startService(s.id, p.id, s.command, p.path);
  res.json({ ok: true, status: 'starting' });
});

// POST /:id/services/:sid/stop — stop a service
router.post('/:id/services/:sid/stop', (req: AuthRequest, res) => {
  const db = getDb();
  const p = db
    .prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user!.id);
  if (!p) { res.status(404).json({ error: 'Project not found' }); return; }

  stopService(req.params.sid);
  res.json({ ok: true, status: 'stopped' });
});

// POST /:id/agent/activate — create a chat session scoped to the project path
router.post('/:id/agent/activate', (req: AuthRequest, res) => {
  const db = getDb();
  const p = db
    .prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user!.id) as ProjectRow | undefined;
  if (!p) { res.status(404).json({ error: 'Project not found' }); return; }

  // Create a session record so the chat tab can resume it
  const sessionId = randomUUID();
  db.prepare('INSERT INTO sessions (id, user_id, project_path) VALUES (?, ?, ?)')
    .run(sessionId, req.user!.id, p.path);

  activateAgent(p.id, sessionId);
  res.json({ sessionId });
});

// POST /:id/agent/deactivate — remove agent association (session stays in history)
router.post('/:id/agent/deactivate', (req: AuthRequest, res) => {
  const db = getDb();
  const p = db
    .prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user!.id);
  if (!p) { res.status(404).json({ error: 'Project not found' }); return; }

  deactivateAgent(req.params.id);
  res.json({ ok: true });
});

export default router;
