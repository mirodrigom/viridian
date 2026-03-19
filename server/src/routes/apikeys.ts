import { Router } from 'express';
import { randomBytes, createHash } from 'crypto';
import { z } from 'zod';
import { db } from '../db/database.js';
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
router.get('/', async (req, res) => {
  const authReq = req as AuthRequest;
  const keys = await db('api_keys')
    .where({ user_id: authReq.user!.id })
    .select('id', 'name', 'key_prefix', 'created_at', 'last_used_at', 'revoked')
    .orderBy('created_at', 'desc');
  res.json({ keys });
});

// POST /api/keys — create a new API key
router.post('/', validate({ body: z.object({ name: z.string().min(1) }) }), async (req, res) => {
  const authReq = req as AuthRequest;
  const { name } = req.body;

  const rawKey = KEY_PREFIX + randomBytes(32).toString('hex');
  const prefix = rawKey.slice(0, 12) + '...';
  const hash = hashKey(rawKey);

  const [id] = await db('api_keys').insert({
    user_id: authReq.user!.id,
    name: name.trim(),
    key_prefix: prefix,
    key_hash: hash,
  });

  // Return the full key only once — it won't be shown again
  res.status(201).json({
    id,
    name: name.trim(),
    key: rawKey,
    key_prefix: prefix,
    created_at: new Date().toISOString(),
  });
});

// DELETE /api/keys/:id — revoke an API key
router.delete('/:id', async (req, res) => {
  const authReq = req as AuthRequest;
  const { id } = req.params;

  const numId = Number(id);
  if (Number.isNaN(numId)) {
    res.status(400).json({ error: 'Invalid key ID' });
    return;
  }

  const key = await db('api_keys')
    .where({ id: numId, user_id: authReq.user!.id })
    .select('id')
    .first();
  if (!key) {
    res.status(404).json({ error: 'Key not found' });
    return;
  }

  await db('api_keys').where({ id: numId }).update({ revoked: 1 });
  res.json({ ok: true });
});

export default router;
