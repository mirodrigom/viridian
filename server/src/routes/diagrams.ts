import { Router } from 'express';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';
import { db } from '../db/database.js';
import { safeJsonParse } from '../lib/safeJson.js';
import { createLogger } from '../logger.js';
import { validate } from '../middleware/validate.js';

const log = createLogger('diagrams');
const router: ReturnType<typeof Router> = Router();
router.use(authMiddleware);

interface DiagramRow {
  id: string;
  user_id: number;
  project_path: string;
  name: string;
  description: string;
  diagram_data: string;
  created_at: string;
  updated_at: string;
}

function rowToDiagram(row: DiagramRow) {
  const diagramData = safeJsonParse<Record<string, unknown>>(row.diagram_data, {});
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    projectPath: row.project_path,
    nodes: diagramData.nodes || [],
    edges: diagramData.edges || [],
    viewport: diagramData.viewport || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToSummary(row: DiagramRow) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    updatedAt: row.updated_at,
  };
}

// GET / — list diagrams for a project
router.get('/', validate({ query: z.object({ project: z.string().min(1) }) }), async (req: AuthRequest, res) => {
  const { project } = req.query;

  const rows = await db('diagrams')
    .where({ user_id: req.user!.id, project_path: project as string })
    .orderBy('updated_at', 'desc')
    .select() as DiagramRow[];
  res.json({ diagrams: rows.map(rowToSummary) });
});

// GET /:id — get single diagram
router.get('/:id', async (req: AuthRequest, res) => {
  const row = await db('diagrams')
    .where({ id: req.params.id, user_id: req.user!.id })
    .first() as DiagramRow | undefined;

  if (!row) {
    res.status(404).json({ error: 'Diagram not found' });
    return;
  }

  res.json(rowToDiagram(row));
});

// POST / — create diagram
router.post('/', validate({
  body: z.object({
    project: z.string().min(1),
    name: z.string().optional(),
    description: z.string().optional(),
    diagramData: z.record(z.unknown()).optional(),
  }),
}), async (req: AuthRequest, res) => {
  const { name, project, diagramData, description } = req.body;

  const id = randomUUID();

  await db('diagrams').insert({
    id,
    user_id: req.user!.id,
    project_path: project,
    name: name || 'Untitled Diagram',
    description: description || '',
    diagram_data: JSON.stringify(diagramData || {}),
  });

  const row = await db('diagrams').where({ id }).first() as DiagramRow;
  res.status(201).json(rowToDiagram(row));
});

// PUT /:id — update diagram
router.put('/:id', async (req: AuthRequest, res) => {
  const existing = await db('diagrams')
    .where({ id: req.params.id, user_id: req.user!.id })
    .first() as DiagramRow | undefined;

  if (!existing) {
    res.status(404).json({ error: 'Diagram not found' });
    return;
  }

  const { name, description, diagramData } = req.body;

  const updates: Record<string, unknown> = {};

  if (name !== undefined) updates.name = name;
  if (description !== undefined) updates.description = description;
  if (diagramData !== undefined) updates.diagram_data = JSON.stringify(diagramData);

  if (Object.keys(updates).length === 0) {
    res.json(rowToDiagram(existing));
    return;
  }

  updates.updated_at = db.fn.now();

  await db('diagrams').where({ id: req.params.id, user_id: req.user!.id }).update(updates);
  const row = await db('diagrams').where({ id: req.params.id }).first() as DiagramRow;
  res.json(rowToDiagram(row));
});

// DELETE /:id — delete diagram
router.delete('/:id', async (req: AuthRequest, res) => {
  const existing = await db('diagrams')
    .where({ id: req.params.id, user_id: req.user!.id })
    .select('id')
    .first();

  if (!existing) {
    res.status(404).json({ error: 'Diagram not found' });
    return;
  }

  await db('diagrams').where({ id: req.params.id, user_id: req.user!.id }).delete();
  res.json({ ok: true });
});

export default router;
