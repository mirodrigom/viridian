import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';
import { db } from '../db/database.js';
import { safeJsonParse } from '../lib/safeJson.js';
import { createLogger } from '../logger.js';
import { validate } from '../middleware/validate.js';

const log = createLogger('graph-runs');
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
router.get('/', validate({ query: z.object({ graphId: z.string().min(1) }) }), async (req: AuthRequest, res) => {
  const { graphId } = req.query;
  const rows = await db('graph_runs')
    .where({ graph_id: graphId, user_id: req.user!.id })
    .orderBy('started_at', 'desc')
    .limit(50)
    .select() as GraphRunRow[];
  res.json({ runs: rows.map(rowToSummary) });
});

// GET /api/graph-runs/:id — full run with timeline & executions
router.get('/:id', async (req: AuthRequest, res) => {
  const row = await db('graph_runs')
    .where({ id: req.params.id, user_id: req.user!.id })
    .first() as GraphRunRow | undefined;
  if (!row) {
    res.status(404).json({ error: 'Run not found' });
    return;
  }
  res.json(rowToFull(row));
});

// DELETE /api/graph-runs/:id — delete a run
router.delete('/:id', async (req: AuthRequest, res) => {
  const count = await db('graph_runs')
    .where({ id: req.params.id, user_id: req.user!.id })
    .delete();
  if (count === 0) {
    res.status(404).json({ error: 'Run not found' });
    return;
  }
  res.json({ ok: true });
});

export default router;
