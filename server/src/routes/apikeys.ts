import { Router } from 'express';
import { randomBytes, createHash } from 'crypto';
import { z } from 'zod';
import { getDb } from '../db/database.js';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';
import { createLogger } from '../logger.js';
import { validate } from '../middleware/validate.js';

const log = createLogger('apikeys');
const router: ReturnType<typeof Router> = Router();
router.use(authMiddleware as any);

const KEY_PREFIX = 'ck_';

function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

// GET /api/keys — list all API keys for current user
router.get('/', (req, res) => {
  const authReq = req as AuthRequest;
  const db = getDb();
  const keys = db.prepare(
    'SELECT id, name, key_prefix, created_at, last_used_at, revoked FROM api_keys WHERE user_id = ? ORDER BY created_at DESC',
  ).all(authReq.user!.id);
  res.json({ keys });
});

// POST /api/keys — create a new API key
router.post('/', validate({ body: z.object({ name: z.string().min(1) }) }), (req, res) => {
  const authReq = req as AuthRequest;
  const { name } = req.body;

  const rawKey = KEY_PREFIX + randomBytes(32).toString('hex');
  const prefix = rawKey.slice(0, 12) + '...';
  const hash = hashKey(rawKey);

  const db = getDb();
  const result = db.prepare(
    'INSERT INTO api_keys (user_id, name, key_prefix, key_hash) VALUES (?, ?, ?, ?)',
  ).run(authReq.user!.id, name.trim(), prefix, hash);

  // Return the full key only once — it won't be shown again
  res.status(201).json({
    id: result.lastInsertRowid,
    name: name.trim(),
    key: rawKey,
    key_prefix: prefix,
    created_at: new Date().toISOString(),
  });
});

// DELETE /api/keys/:id — revoke an API key
router.delete('/:id', (req, res) => {
  const authReq = req as AuthRequest;
  const { id } = req.params;
  const db = getDb();

  const numId = Number(id);
  if (Number.isNaN(numId)) {
    res.status(400).json({ error: 'Invalid key ID' });
    return;
  }

  const key = db.prepare('SELECT id FROM api_keys WHERE id = ? AND user_id = ?').get(
    numId, authReq.user!.id,
  );
  if (!key) {
    res.status(404).json({ error: 'Key not found' });
    return;
  }

  db.prepare('UPDATE api_keys SET revoked = 1 WHERE id = ?').run(numId);
  res.json({ ok: true });
});

export default router;
