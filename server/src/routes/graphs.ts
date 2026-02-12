import { Router } from 'express';
import { randomUUID } from 'crypto';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';
import { getDb } from '../db/database.js';

const router: ReturnType<typeof Router> = Router();
router.use(authMiddleware);

interface GraphRow {
  id: string;
  user_id: number;
  project_path: string;
  name: string;
  description: string;
  graph_data: string;
  created_at: string;
  updated_at: string;
}

function rowToGraph(row: GraphRow) {
  const graphData = JSON.parse(row.graph_data || '{}');
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    projectPath: row.project_path,
    nodes: graphData.nodes || [],
    edges: graphData.edges || [],
    viewport: graphData.viewport || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToSummary(row: GraphRow) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    updatedAt: row.updated_at,
  };
}

// GET / — list graphs for a project
router.get('/', (req: AuthRequest, res) => {
  const { project } = req.query;
  if (!project || typeof project !== 'string') {
    res.status(400).json({ error: 'project query param required' });
    return;
  }

  const db = getDb();
  const rows = db.prepare(
    'SELECT * FROM graphs WHERE user_id = ? AND project_path = ? ORDER BY updated_at DESC',
  ).all(req.user!.id, project) as GraphRow[];
  res.json({ graphs: rows.map(rowToSummary) });
});

// GET /:id — get single graph with full data
router.get('/:id', (req: AuthRequest, res) => {
  const db = getDb();
  const row = db.prepare(
    'SELECT * FROM graphs WHERE id = ? AND user_id = ?',
  ).get(req.params.id, req.user!.id) as GraphRow | undefined;
  if (!row) { res.status(404).json({ error: 'Graph not found' }); return; }
  res.json(rowToGraph(row));
});

// POST / — create graph
router.post('/', (req: AuthRequest, res) => {
  const { name, project, description, graphData } = req.body;
  if (!project) {
    res.status(400).json({ error: 'project is required' });
    return;
  }

  const db = getDb();
  const id = randomUUID();

  db.prepare(`
    INSERT INTO graphs (id, user_id, project_path, name, description, graph_data)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, req.user!.id, project, name || 'Untitled Graph', description || '', JSON.stringify(graphData || {}));

  const row = db.prepare('SELECT * FROM graphs WHERE id = ?').get(id) as GraphRow;
  res.status(201).json(rowToGraph(row));
});

// PUT /:id — update graph
router.put('/:id', (req: AuthRequest, res) => {
  const db = getDb();
  const existing = db.prepare(
    'SELECT * FROM graphs WHERE id = ? AND user_id = ?',
  ).get(req.params.id, req.user!.id) as GraphRow | undefined;
  if (!existing) { res.status(404).json({ error: 'Graph not found' }); return; }

  const { name, description, graphData } = req.body;

  const updates: string[] = [];
  const params: unknown[] = [];

  if (name !== undefined) { updates.push('name = ?'); params.push(name); }
  if (description !== undefined) { updates.push('description = ?'); params.push(description); }
  if (graphData !== undefined) { updates.push('graph_data = ?'); params.push(JSON.stringify(graphData)); }

  if (updates.length === 0) { res.json(rowToGraph(existing)); return; }

  updates.push('updated_at = CURRENT_TIMESTAMP');
  params.push(req.params.id, req.user!.id);

  db.prepare(`UPDATE graphs SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`).run(...params);
  const row = db.prepare('SELECT * FROM graphs WHERE id = ?').get(req.params.id) as GraphRow;
  res.json(rowToGraph(row));
});

// DELETE /:id — delete graph
router.delete('/:id', (req: AuthRequest, res) => {
  const db = getDb();
  const existing = db.prepare(
    'SELECT id FROM graphs WHERE id = ? AND user_id = ?',
  ).get(req.params.id, req.user!.id);
  if (!existing) { res.status(404).json({ error: 'Graph not found' }); return; }

  db.prepare('DELETE FROM graphs WHERE id = ? AND user_id = ?').run(req.params.id, req.user!.id);
  res.json({ ok: true });
});

export default router;
