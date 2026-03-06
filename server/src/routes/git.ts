import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import * as gitService from '../services/git.js';
import { getProvider, getDefaultProvider } from '../providers/registry.js';
import type { ProviderId } from '../providers/types.js';
import { cwdToHash } from '../utils/platform.js';
import { markSessionInternal, isSessionInternal } from '../db/database.js';
import { createLogger } from '../logger.js';
import { validate } from '../middleware/validate.js';
import { z } from 'zod';

const log = createLogger('git');

// ─── Shared schemas ──────────────────────────────────────────────────────
const cwdQuery = z.object({ cwd: z.string().min(1) });
const cwdBody = z.object({ cwd: z.string().min(1) });
const cwdFilesBody = z.object({ cwd: z.string().min(1), files: z.array(z.string()).min(1) });
const cwdBranchBody = z.object({ cwd: z.string().min(1), branch: z.string().min(1) });

const router: ReturnType<typeof Router> = Router();

// Track session IDs created by internal utility queries (e.g. commit message generation)
// so they can be filtered out of the sidebar session list.
// In-memory set for fast lookups during current server lifetime;
// also persisted to DB so they survive server restarts.
const internalSessionIds = new Set<string>();

export function isInternalSession(claudeSessionId: string): boolean {
  return internalSessionIds.has(claudeSessionId) || isSessionInternal(claudeSessionId);
}

router.use(authMiddleware);

router.get('/status', validate({ query: cwdQuery }), async (req, res) => {
  try {
    const cwd = req.query.cwd as string;
    const status = await gitService.getStatus(cwd);
    res.json(status);
  } catch (err) {
    log.warn({ err }, 'Failed to get status');
    res.status(500).json({ error: 'Failed to get git status' });
  }
});

router.get('/diff', validate({ query: cwdQuery }), async (req, res) => {
  try {
    const cwd = req.query.cwd as string;
    const staged = req.query.staged === 'true';
    const diff = await gitService.getDiff(cwd, staged);
    res.json({ diff });
  } catch (err) {
    log.warn({ err }, 'Failed to get diff');
    res.status(500).json({ error: 'Failed to get diff' });
  }
});

router.post('/stage', validate({ body: cwdFilesBody }), async (req, res) => {
  try {
    const { cwd, files } = req.body;
    await gitService.stageFiles(cwd, files);
    res.json({ success: true });
  } catch (err) {
    log.warn({ err }, 'Failed to stage files');
    res.status(500).json({ error: 'Failed to stage files' });
  }
});

router.post('/unstage', validate({ body: cwdFilesBody }), async (req, res) => {
  try {
    const { cwd, files } = req.body;
    await gitService.unstageFiles(cwd, files);
    res.json({ success: true });
  } catch (err) {
    log.warn({ err }, 'Failed to unstage files');
    res.status(500).json({ error: 'Failed to unstage files' });
  }
});

router.post('/commit', validate({ body: z.object({ cwd: z.string().min(1), message: z.string().min(1) }) }), async (req, res) => {
  try {
    const { cwd, message } = req.body;
    const result = await gitService.commit(cwd, message);
    res.json(result);
  } catch (err) {
    log.warn({ err }, 'Failed to commit');
    const msg = err instanceof Error ? err.message : 'Failed to commit';
    res.status(500).json({ error: msg });
  }
});

router.get('/log', validate({ query: cwdQuery }), async (req, res) => {
  try {
    const cwd = req.query.cwd as string;
    const gitLog = await gitService.getLog(cwd);
    res.json(gitLog);
  } catch (err) {
    log.warn({ err }, 'Failed to get log');
    res.status(500).json({ error: 'Failed to get log' });
  }
});

router.get('/branches', validate({ query: cwdQuery }), async (req, res) => {
  try {
    const cwd = req.query.cwd as string;
    const branches = await gitService.getBranches(cwd);
    res.json(branches);
  } catch (err) {
    log.warn({ err }, 'Failed to get branches');
    res.status(500).json({ error: 'Failed to get branches' });
  }
});

router.post('/pull', validate({ body: cwdBody }), async (req, res) => {
  try {
    const { cwd } = req.body;
    const result = await gitService.pull(cwd);
    res.json(result);
  } catch (err) {
    log.warn({ err }, 'Failed to pull');
    const msg = err instanceof Error ? err.message : 'Failed to pull';
    res.status(500).json({ error: msg });
  }
});

router.post('/push', validate({ body: cwdBody }), async (req, res) => {
  try {
    const { cwd } = req.body;
    const result = await gitService.push(cwd);
    res.json(result);
  } catch (err) {
    log.warn({ err }, 'Failed to push');
    const msg = err instanceof Error ? err.message : 'Failed to push';
    res.status(500).json({ error: msg });
  }
});

router.post('/fetch', validate({ body: cwdBody }), async (req, res) => {
  try {
    const { cwd } = req.body;
    const result = await gitService.fetch(cwd);
    res.json(result);
  } catch (err) {
    log.warn({ err }, 'Failed to fetch');
    res.status(500).json({ error: 'Failed to fetch' });
  }
});

router.post('/checkout', validate({ body: cwdBranchBody }), async (req, res) => {
  try {
    const { cwd, branch } = req.body;
    await gitService.checkoutBranch(cwd, branch);
    res.json({ success: true });
  } catch (err) {
    log.warn({ err }, 'Failed to checkout');
    const msg = err instanceof Error ? err.message : 'Failed to checkout';
    res.status(500).json({ error: msg });
  }
});

router.post('/create-branch', validate({ body: cwdBranchBody }), async (req, res) => {
  try {
    const { cwd, branch } = req.body;
    await gitService.createBranch(cwd, branch);
    res.json({ success: true });
  } catch (err) {
    log.warn({ err }, 'Failed to create branch');
    const msg = err instanceof Error ? err.message : 'Failed to create branch';
    res.status(500).json({ error: msg });
  }
});

router.delete('/branch', validate({ body: cwdBranchBody }), async (req, res) => {
  try {
    const { cwd, branch, force } = req.body;
    await gitService.deleteBranch(cwd, branch, !!force);
    res.json({ success: true });
  } catch (err) {
    log.warn({ err }, 'Failed to delete branch');
    const msg = err instanceof Error ? err.message : 'Failed to delete branch';
    res.status(500).json({ error: msg });
  }
});

router.post('/discard', validate({ body: z.object({ cwd: z.string().min(1), file: z.string().min(1) }) }), async (req, res) => {
  try {
    const { cwd, file } = req.body;
    await gitService.discardFile(cwd, file);
    res.json({ success: true });
  } catch (err) {
    log.warn({ err }, 'Failed to discard file');
    res.status(500).json({ error: 'Failed to discard file' });
  }
});

router.get('/file-diff', validate({ query: z.object({ cwd: z.string().min(1), file: z.string().min(1) }) }), async (req, res) => {
  try {
    const cwd = req.query.cwd as string;
    const file = req.query.file as string;
    const staged = req.query.staged === 'true';
    const diff = await gitService.getFileDiff(cwd, file, staged);
    res.json({ diff });
  } catch (err) {
    log.warn({ err }, 'Failed to get file diff');
    res.status(500).json({ error: 'Failed to get file diff' });
  }
});

router.get('/show', validate({ query: z.object({ cwd: z.string().min(1), hash: z.string().min(1) }) }), async (req, res) => {
  try {
    const cwd = req.query.cwd as string;
    const hash = req.query.hash as string;
    const show = await gitService.getShowCommit(cwd, hash);
    res.json({ show });
  } catch (err) {
    log.warn({ err }, 'Failed to get commit details');
    res.status(500).json({ error: 'Failed to get commit details' });
  }
});

router.get('/file-versions', validate({ query: z.object({ cwd: z.string().min(1), file: z.string().min(1) }) }), async (req, res) => {
  try {
    const cwd = req.query.cwd as string;
    const file = req.query.file as string;
    const staged = req.query.staged === 'true';
    const versions = await gitService.getFileVersions(cwd, file, staged);
    res.json(versions);
  } catch (err) {
    log.warn({ err }, 'Failed to get file versions');
    res.status(500).json({ error: 'Failed to get file versions' });
  }
});

router.post('/generate-commit-message', validate({ body: cwdBody }), async (req, res) => {
  try {
    const { cwd, providerId } = req.body;
    const provider = providerId ? getProvider(providerId as ProviderId) : getDefaultProvider();
    const diff = await gitService.getDiff(cwd, true);
    if (!diff.trim()) {
      res.status(400).json({ error: 'No staged changes to describe' });
      return;
    }
    const truncatedDiff = diff.length > 8000 ? diff.slice(0, 8000) + '\n... (truncated)' : diff;

    // Stream commit message from Claude via SSE
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    const prompt = `You are a git commit message generator. Based on the following staged diff, write a concise, conventional commit message.

Rules:
- First line: short summary (max 72 chars), imperative mood (e.g. "Add", "Fix", "Update", "Refactor")
- If needed, add a blank line followed by a brief body explaining the "why"
- Do NOT use markdown, code fences, or any formatting — output only the raw commit message text
- Do NOT include a "Co-Authored-By" line

Staged diff:
${truncatedDiff}`;

    const abortController = new AbortController();
    res.on('close', () => abortController.abort());

    const timeout = setTimeout(() => {
      abortController.abort();
      res.write(`event: error\ndata: ${JSON.stringify({ error: 'Request timed out after 5 minutes' })}\n\n`);
      res.end();
    }, 5 * 60_000);

    (async () => {
      try {
        for await (const msg of provider.query({
          prompt,
          cwd,
          permissionMode: 'plan',
          allowedTools: [],
          abortSignal: abortController.signal,
        })) {
          if (msg.type === 'system' && msg.sessionId) {
            internalSessionIds.add(msg.sessionId);
            markSessionInternal(cwdToHash(cwd), msg.sessionId);
          }
          if (msg.type === 'result' && msg.sessionId) {
            internalSessionIds.add(msg.sessionId);
            markSessionInternal(cwdToHash(cwd), msg.sessionId);
          }
          if (msg.type === 'text_delta') {
            res.write(`event: delta\ndata: ${JSON.stringify({ text: msg.text })}\n\n`);
          }
          if (msg.type === 'error') {
            res.write(`event: error\ndata: ${JSON.stringify({ error: msg.error })}\n\n`);
          }
        }
        clearTimeout(timeout);
        res.write(`event: done\ndata: {}\n\n`);
        res.end();
      } catch (err) {
        clearTimeout(timeout);
        log.warn({ err }, 'Failed to generate commit message (stream)');
        const msg = err instanceof Error ? err.message : 'Failed to generate commit message';
        res.write(`event: error\ndata: ${JSON.stringify({ error: msg })}\n\n`);
        res.end();
      }
    })();
  } catch (err) {
    log.warn({ err }, 'Failed to generate commit message');
    res.status(500).json({ error: 'Failed to generate commit message' });
  }
});

router.get('/user-config', validate({ query: cwdQuery }), async (req, res) => {
  try {
    const cwd = req.query.cwd as string;
    const userConfig = await gitService.getUserConfig(cwd);
    res.json(userConfig);
  } catch (err) {
    log.warn({ err }, 'Failed to get git user config');
    res.status(500).json({ error: 'Failed to get git user config' });
  }
});

router.put('/user-config', validate({ body: cwdBody }), async (req, res) => {
  try {
    const { cwd, name, email } = req.body;
    await gitService.setUserConfig(cwd, name || '', email || '');
    res.json({ success: true });
  } catch (err) {
    log.warn({ err }, 'Failed to set git user config');
    res.status(500).json({ error: 'Failed to set git user config' });
  }
});

export default router;
