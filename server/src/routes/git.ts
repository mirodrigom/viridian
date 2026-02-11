import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import * as gitService from '../services/git.js';

const router: ReturnType<typeof Router> = Router();

router.use(authMiddleware);

router.get('/status', async (req, res) => {
  try {
    const cwd = req.query.cwd as string;
    if (!cwd) { res.status(400).json({ error: 'cwd is required' }); return; }
    const status = await gitService.getStatus(cwd);
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get git status' });
  }
});

router.get('/diff', async (req, res) => {
  try {
    const cwd = req.query.cwd as string;
    const staged = req.query.staged === 'true';
    if (!cwd) { res.status(400).json({ error: 'cwd is required' }); return; }
    const diff = await gitService.getDiff(cwd, staged);
    res.json({ diff });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get diff' });
  }
});

router.post('/stage', async (req, res) => {
  try {
    const { cwd, files } = req.body;
    if (!cwd || !files?.length) { res.status(400).json({ error: 'cwd and files are required' }); return; }
    await gitService.stageFiles(cwd, files);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to stage files' });
  }
});

router.post('/unstage', async (req, res) => {
  try {
    const { cwd, files } = req.body;
    if (!cwd || !files?.length) { res.status(400).json({ error: 'cwd and files are required' }); return; }
    await gitService.unstageFiles(cwd, files);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to unstage files' });
  }
});

router.post('/commit', async (req, res) => {
  try {
    const { cwd, message } = req.body;
    if (!cwd || !message) { res.status(400).json({ error: 'cwd and message are required' }); return; }
    const result = await gitService.commit(cwd, message);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to commit' });
  }
});

router.get('/log', async (req, res) => {
  try {
    const cwd = req.query.cwd as string;
    if (!cwd) { res.status(400).json({ error: 'cwd is required' }); return; }
    const log = await gitService.getLog(cwd);
    res.json(log);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get log' });
  }
});

router.get('/branches', async (req, res) => {
  try {
    const cwd = req.query.cwd as string;
    if (!cwd) { res.status(400).json({ error: 'cwd is required' }); return; }
    const branches = await gitService.getBranches(cwd);
    res.json(branches);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get branches' });
  }
});

router.post('/pull', async (req, res) => {
  try {
    const { cwd } = req.body;
    if (!cwd) { res.status(400).json({ error: 'cwd is required' }); return; }
    const result = await gitService.pull(cwd);
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to pull';
    res.status(500).json({ error: msg });
  }
});

router.post('/push', async (req, res) => {
  try {
    const { cwd } = req.body;
    if (!cwd) { res.status(400).json({ error: 'cwd is required' }); return; }
    const result = await gitService.push(cwd);
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to push';
    res.status(500).json({ error: msg });
  }
});

router.post('/fetch', async (req, res) => {
  try {
    const { cwd } = req.body;
    if (!cwd) { res.status(400).json({ error: 'cwd is required' }); return; }
    const result = await gitService.fetch(cwd);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch' });
  }
});

router.post('/checkout', async (req, res) => {
  try {
    const { cwd, branch } = req.body;
    if (!cwd || !branch) { res.status(400).json({ error: 'cwd and branch are required' }); return; }
    await gitService.checkoutBranch(cwd, branch);
    res.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to checkout';
    res.status(500).json({ error: msg });
  }
});

router.post('/create-branch', async (req, res) => {
  try {
    const { cwd, branch } = req.body;
    if (!cwd || !branch) { res.status(400).json({ error: 'cwd and branch are required' }); return; }
    await gitService.createBranch(cwd, branch);
    res.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to create branch';
    res.status(500).json({ error: msg });
  }
});

router.post('/discard', async (req, res) => {
  try {
    const { cwd, file } = req.body;
    if (!cwd || !file) { res.status(400).json({ error: 'cwd and file are required' }); return; }
    await gitService.discardFile(cwd, file);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to discard file' });
  }
});

router.get('/file-diff', async (req, res) => {
  try {
    const cwd = req.query.cwd as string;
    const file = req.query.file as string;
    const staged = req.query.staged === 'true';
    if (!cwd || !file) { res.status(400).json({ error: 'cwd and file are required' }); return; }
    const diff = await gitService.getFileDiff(cwd, file, staged);
    res.json({ diff });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get file diff' });
  }
});

router.get('/show', async (req, res) => {
  try {
    const cwd = req.query.cwd as string;
    const hash = req.query.hash as string;
    if (!cwd || !hash) { res.status(400).json({ error: 'cwd and hash are required' }); return; }
    const show = await gitService.getShowCommit(cwd, hash);
    res.json({ show });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get commit details' });
  }
});

router.get('/file-versions', async (req, res) => {
  try {
    const cwd = req.query.cwd as string;
    const file = req.query.file as string;
    const staged = req.query.staged === 'true';
    if (!cwd || !file) { res.status(400).json({ error: 'cwd and file are required' }); return; }
    const versions = await gitService.getFileVersions(cwd, file, staged);
    res.json(versions);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get file versions' });
  }
});

router.post('/generate-commit-message', async (req, res) => {
  try {
    const { cwd } = req.body;
    if (!cwd) { res.status(400).json({ error: 'cwd is required' }); return; }
    const diff = await gitService.getDiff(cwd, true);
    if (!diff.trim()) {
      res.status(400).json({ error: 'No staged changes to describe' });
      return;
    }
    // Truncate diff to avoid blowing token limits
    const truncatedDiff = diff.length > 8000 ? diff.slice(0, 8000) + '\n... (truncated)' : diff;
    res.json({ diff: truncatedDiff });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate commit message' });
  }
});

export default router;
