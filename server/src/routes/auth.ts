import { Router } from 'express';
import { z } from 'zod';
import { createUser, authenticateUser, getUserCount } from '../services/auth.js';
import { createLogger } from '../logger.js';
import { validate } from '../middleware/validate.js';

const log = createLogger('auth');
const router: ReturnType<typeof Router> = Router();

const credentialsBody = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

const registerBody = z.object({
  username: z.string().min(1),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

router.post('/login', validate({ body: credentialsBody }), async (req, res) => {
  try {
    const { username, password } = req.body;
    const token = await authenticateUser(username, password);
    res.json({ token, username });
  } catch (err) {
    log.warn({ err }, 'Login failed');
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

router.post('/register', validate({ body: registerBody }), async (req, res) => {
  try {
    const count = getUserCount();
    if (count > 0) {
      res.status(403).json({ error: 'Registration is disabled. A user already exists.' });
      return;
    }
    const { username, password } = req.body;
    const user = await createUser(username, password);
    const token = await authenticateUser(username, password);
    res.status(201).json({ token, username: user.username });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Registration failed';
    log.warn({ err }, 'Registration failed');
    res.status(400).json({ error: message });
  }
});

router.get('/status', (_req, res) => {
  const count = getUserCount();
  res.json({ hasUsers: count > 0, userCount: count });
});

export default router;
