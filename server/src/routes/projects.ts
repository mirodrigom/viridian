import { Router } from 'express';
import { randomUUID } from 'crypto';
import { existsSync } from 'fs';
import { z } from 'zod';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';
import { db } from '../db/database.js';
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
router.get('/', async (req: AuthRequest, res) => {
  const projects = await db('projects')
    .where({ user_id: req.user!.id })
    .orderBy('created_at', 'desc')
    .select() as ProjectRow[];

  const result = await Promise.all(projects.map(async p => {
    const services = await db('project_services')
      .where({ project_id: p.id })
      .orderBy('sort_order', 'asc')
      .select() as ServiceRow[];
    return rowToProject(p, services);
  }));

  res.json({ projects: result });
});

// GET /:id — get single project
router.get('/:id', async (req: AuthRequest, res) => {
  const p = await db('projects')
    .where({ id: req.params.id, user_id: req.user!.id })
    .first() as ProjectRow | undefined;
  if (!p) { res.status(404).json({ error: 'Project not found' }); return; }

  const services = await db('project_services')
    .where({ project_id: p.id })
    .orderBy('sort_order', 'asc')
    .select() as ServiceRow[];
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
}), async (req: AuthRequest, res) => {
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

  const id = randomUUID();
  await db('projects').insert({ id, user_id: req.user!.id, name, path, description: description || '' });

  if (Array.isArray(services) && services.length > 0) {
    await db('project_services').insert(
      services.map((s, i) => ({
        id: randomUUID(),
        project_id: id,
        name: s.name,
        command: s.command,
        sort_order: i,
      })),
    );
  }

  const p = await db('projects').where({ id }).first() as ProjectRow;
  const svcs = await db('project_services')
    .where({ project_id: id })
    .orderBy('sort_order', 'asc')
    .select() as ServiceRow[];
  res.status(201).json({ project: rowToProject(p, svcs) });
});

// PUT /:id — update project metadata
router.put('/:id', async (req: AuthRequest, res) => {
  const existing = await db('projects')
    .where({ id: req.params.id, user_id: req.user!.id })
    .first() as ProjectRow | undefined;
  if (!existing) { res.status(404).json({ error: 'Project not found' }); return; }

  const { name, description } = req.body as { name?: string; description?: string };
  const updates: Record<string, unknown> = {};
  if (name !== undefined) updates.name = name;
  if (description !== undefined) updates.description = description;

  if (Object.keys(updates).length === 0) {
    const svcs = await db('project_services')
      .where({ project_id: existing.id })
      .orderBy('sort_order', 'asc')
      .select() as ServiceRow[];
    res.json({ project: rowToProject(existing, svcs) });
    return;
  }

  updates.updated_at = db.fn.now();
  await db('projects').where({ id: req.params.id, user_id: req.user!.id }).update(updates);

  const p = await db('projects').where({ id: req.params.id }).first() as ProjectRow;
  const svcs = await db('project_services')
    .where({ project_id: p.id })
    .orderBy('sort_order', 'asc')
    .select() as ServiceRow[];
  res.json({ project: rowToProject(p, svcs) });
});

// DELETE /:id — delete project + stop all its services
router.delete('/:id', async (req: AuthRequest, res) => {
  const existing = await db('projects')
    .where({ id: req.params.id, user_id: req.user!.id })
    .select('id')
    .first();
  if (!existing) { res.status(404).json({ error: 'Project not found' }); return; }

  stopAllForProject(req.params.id);
  deactivateAgent(req.params.id);
  await db('projects').where({ id: req.params.id, user_id: req.user!.id }).delete();
  res.json({ ok: true });
});

// POST /:id/services — add a service to a project
router.post('/:id/services', async (req: AuthRequest, res) => {
  const p = await db('projects')
    .where({ id: req.params.id, user_id: req.user!.id })
    .select('id')
    .first();
  if (!p) { res.status(404).json({ error: 'Project not found' }); return; }

  const { name, command } = req.body as { name: string; command: string };
  if (!name || !command) { res.status(400).json({ error: 'name and command are required' }); return; }

  const maxOrderRow = await db('project_services')
    .where({ project_id: req.params.id })
    .max('sort_order as maxOrder')
    .first() as { maxOrder: number | null };
  const nextOrder = (maxOrderRow.maxOrder ?? -1) + 1;

  const sid = randomUUID();
  await db('project_services').insert({
    id: sid,
    project_id: req.params.id,
    name,
    command,
    sort_order: nextOrder,
  });

  const s = await db('project_services').where({ id: sid }).first() as ServiceRow;
  res.status(201).json({ service: rowToService(s) });
});

// DELETE /:id/services/:sid — remove a service
router.delete('/:id/services/:sid', async (req: AuthRequest, res) => {
  const p = await db('projects')
    .where({ id: req.params.id, user_id: req.user!.id })
    .select('id')
    .first();
  if (!p) { res.status(404).json({ error: 'Project not found' }); return; }

  stopService(req.params.sid);
  await db('project_services')
    .where({ id: req.params.sid, project_id: req.params.id })
    .delete();
  res.json({ ok: true });
});

// POST /:id/services/:sid/start — start a service
router.post('/:id/services/:sid/start', async (req: AuthRequest, res) => {
  const p = await db('projects')
    .where({ id: req.params.id, user_id: req.user!.id })
    .first() as ProjectRow | undefined;
  if (!p) { res.status(404).json({ error: 'Project not found' }); return; }

  const s = await db('project_services')
    .where({ id: req.params.sid, project_id: req.params.id })
    .first() as ServiceRow | undefined;
  if (!s) { res.status(404).json({ error: 'Service not found' }); return; }

  startService(s.id, p.id, s.command, p.path);
  res.json({ ok: true, status: 'starting' });
});

// POST /:id/services/:sid/stop — stop a service
router.post('/:id/services/:sid/stop', async (req: AuthRequest, res) => {
  const p = await db('projects')
    .where({ id: req.params.id, user_id: req.user!.id })
    .select('id')
    .first();
  if (!p) { res.status(404).json({ error: 'Project not found' }); return; }

  stopService(req.params.sid);
  res.json({ ok: true, status: 'stopped' });
});

// POST /:id/agent/activate — create a chat session scoped to the project path
router.post('/:id/agent/activate', async (req: AuthRequest, res) => {
  const p = await db('projects')
    .where({ id: req.params.id, user_id: req.user!.id })
    .first() as ProjectRow | undefined;
  if (!p) { res.status(404).json({ error: 'Project not found' }); return; }

  // Create a session record so the chat tab can resume it
  const sessionId = randomUUID();
  await db('sessions').insert({ id: sessionId, user_id: req.user!.id, project_path: p.path });

  activateAgent(p.id, sessionId);
  res.json({ sessionId });
});

// POST /:id/agent/deactivate — remove agent association (session stays in history)
router.post('/:id/agent/deactivate', async (req: AuthRequest, res) => {
  const p = await db('projects')
    .where({ id: req.params.id, user_id: req.user!.id })
    .select('id')
    .first();
  if (!p) { res.status(404).json({ error: 'Project not found' }); return; }

  deactivateAgent(req.params.id);
  res.json({ ok: true });
});

export default router;
