import { Router } from 'express';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';
import { getDb } from '../db/database.js';
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
router.get('/', validate({ query: z.object({ project: z.string().min(1) }) }), (req: AuthRequest, res) => {
  const { project } = req.query;

  const db = getDb();
  const rows = db.prepare(
    'SELECT * FROM diagrams WHERE user_id = ? AND project_path = ? ORDER BY updated_at DESC',
  ).all(req.user!.id, project) as DiagramRow[];
  res.json({ diagrams: rows.map(rowToSummary) });
});

// GET /:id — get single diagram
router.get('/:id', (req: AuthRequest, res) => {
  const db = getDb();
  const row = db.prepare(
    'SELECT * FROM diagrams WHERE id = ? AND user_id = ?',
  ).get(req.params.id, req.user!.id) as DiagramRow | undefined;

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
}), (req: AuthRequest, res) => {
  const { name, project, diagramData, description } = req.body;

  const db = getDb();
  const id = randomUUID();

  db.prepare(`
    INSERT INTO diagrams (id, user_id, project_path, name, description, diagram_data)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    id,
    req.user!.id,
    project,
    name || 'Untitled Diagram',
    description || '',
    JSON.stringify(diagramData || {}),
  );

  const row = db.prepare('SELECT * FROM diagrams WHERE id = ?').get(id) as DiagramRow;
  res.status(201).json(rowToDiagram(row));
});

// PUT /:id — update diagram
router.put('/:id', (req: AuthRequest, res) => {
  const db = getDb();
  const existing = db.prepare(
    'SELECT * FROM diagrams WHERE id = ? AND user_id = ?',
  ).get(req.params.id, req.user!.id) as DiagramRow | undefined;

  if (!existing) {
    res.status(404).json({ error: 'Diagram not found' });
    return;
  }

  const { name, description, diagramData } = req.body;

  const updates: string[] = [];
  const params: unknown[] = [];

  if (name !== undefined) { updates.push('name = ?'); params.push(name); }
  if (description !== undefined) { updates.push('description = ?'); params.push(description); }
  if (diagramData !== undefined) { updates.push('diagram_data = ?'); params.push(JSON.stringify(diagramData)); }

  if (updates.length === 0) {
    res.json(rowToDiagram(existing));
    return;
  }

  updates.push('updated_at = CURRENT_TIMESTAMP');
  params.push(req.params.id, req.user!.id);

  db.prepare(`UPDATE diagrams SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`).run(...params);
  const row = db.prepare('SELECT * FROM diagrams WHERE id = ?').get(req.params.id) as DiagramRow;
  res.json(rowToDiagram(row));
});

// DELETE /:id — delete diagram
router.delete('/:id', (req: AuthRequest, res) => {
  const db = getDb();
  const existing = db.prepare(
    'SELECT id FROM diagrams WHERE id = ? AND user_id = ?',
  ).get(req.params.id, req.user!.id);

  if (!existing) {
    res.status(404).json({ error: 'Diagram not found' });
    return;
  }

  db.prepare('DELETE FROM diagrams WHERE id = ? AND user_id = ?').run(req.params.id, req.user!.id);
  res.json({ ok: true });
});

export default router;
