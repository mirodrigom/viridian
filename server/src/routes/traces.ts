/**
 * Traces routes — queries the built-in SQLite tracing tables.
 * Drop-in replacement for the old Langfuse proxy routes.
 */

import { Router } from 'express';
import { getDb } from '../db/database.js';

const router: ReturnType<typeof Router> = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseJson(val: string | null | undefined): unknown {
  if (!val) return undefined;
  try { return JSON.parse(val); } catch { return val; }
}

interface TraceRow {
  id: string; name: string; user_id: string | null; session_id: string | null;
  metadata: string | null; tags: string | null; input: string | null; output: string | null;
  status: string; start_time: string; end_time: string | null;
  input_tokens: number; output_tokens: number;
}

interface ObservationRow {
  id: string; trace_id: string; parent_observation_id: string | null;
  type: string; name: string; input: string | null; output: string | null;
  model: string | null; metadata: string | null; start_time: string;
  end_time: string | null; input_tokens: number; output_tokens: number;
  level: string; status_message: string | null;
}

function mapObservation(row: ObservationRow) {
  return {
    id: row.id,
    traceId: row.trace_id,
    parentObservationId: row.parent_observation_id || null,
    type: row.type,
    name: row.name,
    startTime: row.start_time,
    endTime: row.end_time || undefined,
    model: row.model || undefined,
    input: parseJson(row.input),
    output: parseJson(row.output),
    metadata: parseJson(row.metadata) as Record<string, unknown> | undefined,
    level: row.level,
    statusMessage: row.status_message || undefined,
    usage: {
      input: row.input_tokens,
      output: row.output_tokens,
      total: row.input_tokens + row.output_tokens,
    },
  };
}

function mapTrace(row: TraceRow, observations?: ObservationRow[]) {
  return {
    id: row.id,
    name: row.name,
    timestamp: row.start_time,
    userId: row.user_id || undefined,
    tags: parseJson(row.tags) as string[] | undefined,
    metadata: parseJson(row.metadata) as Record<string, unknown> | undefined,
    observations: observations?.map(mapObservation),
  };
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// GET /api/traces/status — always configured (built-in)
router.get('/status', (_req, res) => {
  res.json({ configured: true, reachable: true });
});

// GET /api/traces?page=1&limit=30&userId=X
router.get('/', (req, res) => {
  const db = getDb();
  const limit = Math.min(Number(req.query.limit) || 30, 200);
  const page = Math.max(Number(req.query.page) || 1, 1);
  const offset = (page - 1) * limit;
  const userId = req.query.userId as string | undefined;

  try {
    // Fetch traces
    let traceRows: TraceRow[];
    if (userId) {
      traceRows = db.prepare(
        'SELECT * FROM traces WHERE user_id = ? ORDER BY start_time DESC LIMIT ? OFFSET ?',
      ).all(userId, limit, offset) as TraceRow[];
    } else {
      traceRows = db.prepare(
        'SELECT * FROM traces ORDER BY start_time DESC LIMIT ? OFFSET ?',
      ).all(limit, offset) as TraceRow[];
    }

    // Fetch summary observations for each trace (no input/output blobs for list perf)
    const getSummaryObs = db.prepare(
      `SELECT id, trace_id, parent_observation_id, type, name, '' as input, '' as output,
              model, metadata, start_time, end_time, input_tokens, output_tokens, level, status_message
       FROM observations WHERE trace_id = ? ORDER BY start_time`,
    );

    const data = traceRows.map(t => {
      const obs = getSummaryObs.all(t.id) as ObservationRow[];
      return mapTrace(t, obs);
    });

    res.json({ configured: true, data });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: msg });
  }
});

// GET /api/traces/:id — full trace detail with all observations
router.get('/:id', (req, res) => {
  const db = getDb();

  try {
    const traceRow = db.prepare('SELECT * FROM traces WHERE id = ?').get(req.params.id) as TraceRow | undefined;
    if (!traceRow) { res.status(404).json({ error: 'Trace not found' }); return; }

    const obsRows = db.prepare(
      'SELECT * FROM observations WHERE trace_id = ? ORDER BY start_time',
    ).all(req.params.id) as ObservationRow[];

    res.json(mapTrace(traceRow, obsRows));
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: msg });
  }
});

export default router;
