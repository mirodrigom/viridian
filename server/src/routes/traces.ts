/**
 * Traces routes — queries the built-in SQLite tracing tables.
 * Drop-in replacement for the old Langfuse proxy routes.
 */

import { Router } from 'express';
import { db } from '../db/database.js';

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
router.get('/', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 30, 200);
  const page = Math.max(Number(req.query.page) || 1, 1);
  const offset = (page - 1) * limit;
  const userId = req.query.userId as string | undefined;

  try {
    // Fetch traces
    let traceQuery = db('traces').orderBy('start_time', 'desc').limit(limit).offset(offset);
    if (userId) {
      traceQuery = traceQuery.where({ user_id: userId });
    }
    const traceRows = await traceQuery.select() as TraceRow[];

    // Fetch summary observations for each trace (no input/output blobs for list perf)
    const data = await Promise.all(traceRows.map(async t => {
      const obs = await db('observations')
        .where({ trace_id: t.id })
        .orderBy('start_time')
        .select(
          'id', 'trace_id', 'parent_observation_id', 'type', 'name',
          db.raw("'' as input"), db.raw("'' as output"),
          'model', 'metadata', 'start_time', 'end_time',
          'input_tokens', 'output_tokens', 'level', 'status_message',
        ) as ObservationRow[];
      return mapTrace(t, obs);
    }));

    res.json({ configured: true, data });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: msg });
  }
});

// GET /api/traces/:id — full trace detail with all observations
router.get('/:id', async (req, res) => {
  try {
    const traceRow = await db('traces').where({ id: req.params.id }).first() as TraceRow | undefined;
    if (!traceRow) { res.status(404).json({ error: 'Trace not found' }); return; }

    const obsRows = await db('observations')
      .where({ trace_id: req.params.id })
      .orderBy('start_time')
      .select() as ObservationRow[];

    res.json(mapTrace(traceRow, obsRows));
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: msg });
  }
});

export default router;
