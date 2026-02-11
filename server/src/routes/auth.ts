import { Router } from 'express';
import { createUser, authenticateUser, getUserCount } from '../services/auth.js';

const router: ReturnType<typeof Router> = Router();

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      res.status(400).json({ error: 'Username and password are required' });
      return;
    }
    const token = await authenticateUser(username, password);
    res.json({ token, username });
  } catch (err) {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

router.post('/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      res.status(400).json({ error: 'Username and password are required' });
      return;
    }
    if (password.length < 6) {
      res.status(400).json({ error: 'Password must be at least 6 characters' });
      return;
    }
    const user = await createUser(username, password);
    const token = await authenticateUser(username, password);
    res.status(201).json({ token, username: user.username });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Registration failed';
    res.status(400).json({ error: message });
  }
});

router.get('/status', (_req, res) => {
  const count = getUserCount();
  res.json({ hasUsers: count > 0, userCount: count });
});

export default router;
