import { Router } from 'express';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';
import { getDb } from '../db/database.js';
import { safeJsonParse } from '../lib/safeJson.js';

const router: ReturnType<typeof Router> = Router();
router.use(authMiddleware);

interface GraphRunRow {
  id: string;
  graph_id: string | null;
  user_id: number;
  project_path: string;
  prompt: string;
  status: string;
  final_output: string | null;
  error: string | null;
  timeline: string;
  executions: string;
  total_input_tokens: number;
  total_output_tokens: number;
  started_at: string;
  completed_at: string | null;
}

function rowToSummary(row: GraphRunRow) {
  return {
    id: row.id,
    graphId: row.graph_id,
    prompt: row.prompt.slice(0, 200),
    status: row.status,
    totalInputTokens: row.total_input_tokens,
    totalOutputTokens: row.total_output_tokens,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    error: row.error,
  };
}

function rowToFull(row: GraphRunRow) {
  return {
    id: row.id,
    graphId: row.graph_id,
    projectPath: row.project_path,
    prompt: row.prompt,
    status: row.status,
    finalOutput: row.final_output,
    error: row.error,
    timeline: safeJsonParse<unknown[]>(row.timeline, []),
    executions: safeJsonParse<Record<string, unknown>>(row.executions, {}),
    totalInputTokens: row.total_input_tokens,
    totalOutputTokens: row.total_output_tokens,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

// GET /api/graph-runs?graphId=xxx — list runs for a graph
router.get('/', (req: AuthRequest, res) => {
  const { graphId } = req.query;
  if (!graphId || typeof graphId !== 'string') {
    res.status(400).json({ error: 'graphId query param required' });
    return;
  }
  const db = getDb();
  const rows = db.prepare(
    'SELECT * FROM graph_runs WHERE graph_id = ? AND user_id = ? ORDER BY started_at DESC LIMIT 50',
  ).all(graphId, req.user!.id) as GraphRunRow[];
  res.json({ runs: rows.map(rowToSummary) });
});

// GET /api/graph-runs/:id — full run with timeline & executions
router.get('/:id', (req: AuthRequest, res) => {
  const db = getDb();
  const row = db.prepare(
    'SELECT * FROM graph_runs WHERE id = ? AND user_id = ?',
  ).get(req.params.id, req.user!.id) as GraphRunRow | undefined;
  if (!row) {
    res.status(404).json({ error: 'Run not found' });
    return;
  }
  res.json(rowToFull(row));
});

// DELETE /api/graph-runs/:id — delete a run
router.delete('/:id', (req: AuthRequest, res) => {
  const db = getDb();
  const result = db.prepare(
    'DELETE FROM graph_runs WHERE id = ? AND user_id = ?',
  ).run(req.params.id, req.user!.id);
  if (result.changes === 0) {
    res.status(404).json({ error: 'Run not found' });
    return;
  }
  res.json({ ok: true });
});

export default router;
