/**
 * Langfuse proxy routes — forwards requests to the self-hosted Langfuse instance.
 * Keeps API keys server-side; client never sees them.
 */

import { Router } from 'express';
import { createLogger } from '../logger.js';

const log = createLogger('langfuse');
const router: ReturnType<typeof Router> = Router();

function getConfig(): { baseUrl: string; authHeader: string } | null {
  const pk = process.env.LANGFUSE_PUBLIC_KEY;
  const sk = process.env.LANGFUSE_SECRET_KEY;
  const baseUrl = process.env.LANGFUSE_BASE_URL || 'http://localhost:3001';
  if (!pk || !sk || pk === 'pk-lf-...' || sk === 'sk-lf-...') return null;
  const authHeader = 'Basic ' + Buffer.from(`${pk}:${sk}`).toString('base64');
  return { baseUrl, authHeader };
}

async function langfuseFetch(path: string): Promise<Response> {
  const cfg = getConfig();
  if (!cfg) throw new Error('not_configured');
  return fetch(`${cfg.baseUrl}${path}`, {
    headers: { Authorization: cfg.authHeader, 'Content-Type': 'application/json' },
  });
}

// GET /api/langfuse/status — check if Langfuse is configured and reachable
router.get('/status', async (_req, res) => {
  const cfg = getConfig();
  if (!cfg) {
    res.json({ configured: false });
    return;
  }
  try {
    const r = await fetch(`${cfg.baseUrl}/api/public/traces?limit=1`, {
      headers: { Authorization: cfg.authHeader },
    });
    res.json({ configured: true, reachable: r.ok });
  } catch {
    res.json({ configured: true, reachable: false });
  }
});

// GET /api/langfuse/traces?page=1&limit=30
router.get('/traces', async (req, res) => {
  const cfg = getConfig();
  if (!cfg) { res.json({ configured: false, data: [] }); return; }

  const page = req.query.page || 1;
  const limit = req.query.limit || 30;
  const userId = req.query.userId as string | undefined;

  try {
    const userFilter = userId ? `&userId=${encodeURIComponent(userId)}` : '';
    const r = await langfuseFetch(
      `/api/public/traces?page=${page}&limit=${limit}${userFilter}`,
    );
    if (!r.ok) { res.status(r.status).json({ error: 'Langfuse error' }); return; }
    const data = await r.json() as Record<string, unknown>;
    res.json({ configured: true, ...data });
  } catch (err) {
    log.warn({ err }, 'Failed to fetch traces');
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: msg });
  }
});

// GET /api/langfuse/traces/:id — trace detail with observations
router.get('/traces/:id', async (req, res) => {
  const cfg = getConfig();
  if (!cfg) { res.status(503).json({ error: 'Langfuse not configured' }); return; }

  try {
    const r = await langfuseFetch(`/api/public/traces/${req.params.id}`);
    if (!r.ok) { res.status(r.status).json({ error: 'Langfuse error' }); return; }
    res.json(await r.json());
  } catch (err) {
    log.warn({ err }, 'Failed to fetch trace detail');
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: msg });
  }
});

export default router;
