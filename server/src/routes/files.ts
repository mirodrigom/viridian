import { Router } from 'express';
import { spawn } from 'child_process';
import { basename, join } from 'path';
import { existsSync } from 'fs';
import { z } from 'zod';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';
import { getFileTree, getDirectoryChildren, getFileContent, saveFileContent, getLanguageFromPath, searchFiles, createDirectory, createFile } from '../services/files.js';
import { getHomeDir } from '../utils/platform.js';
import { createLogger } from '../logger.js';
import { validate } from '../middleware/validate.js';

const log = createLogger('files');
const router: ReturnType<typeof Router> = Router();

router.use(authMiddleware);

router.get('/tree', async (req, res) => {
  try {
    const rootPath = (req.query.path as string) || getHomeDir();
    const depth = Math.max(1, Math.min(10, parseInt(req.query.depth as string) || 1));
    const tree = await getFileTree(rootPath, depth);
    res.json({ tree, rootPath });
  } catch (err) {
    log.warn({ err }, 'Failed to get file tree');
    res.status(500).json({ error: 'Failed to read directory' });
  }
});

router.get('/tree/children', validate({ query: z.object({ root: z.string().min(1) }).passthrough() }), async (req, res) => {
  try {
    const rootPath = req.query.root as string;
    const relativePath = (req.query.path as string) || '';
    const children = await getDirectoryChildren(rootPath, relativePath);
    res.json({ children });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to read directory';
    res.status(500).json({ error: message });
  }
});

router.get('/content', validate({ query: z.object({ root: z.string().min(1), path: z.string().min(1) }) }), async (req, res) => {
  try {
    const rootPath = req.query.root as string;
    const filePath = req.query.path as string;
    const content = await getFileContent(rootPath, filePath);
    const language = getLanguageFromPath(filePath);
    res.json({ content, language, path: filePath });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to read file';
    res.status(500).json({ error: message });
  }
});

router.put('/content', validate({
  body: z.object({ root: z.string().min(1), path: z.string().min(1), content: z.string() }),
}), async (req, res) => {
  try {
    const { root, path, content } = req.body;
    await saveFileContent(root, path, content);
    res.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to save file';
    res.status(500).json({ error: message });
  }
});

router.get('/search', validate({ query: z.object({ root: z.string().min(1), q: z.string().min(1) }) }), async (req, res) => {
  try {
    const rootPath = req.query.root as string;
    const query = req.query.q as string;
    const files = await searchFiles(rootPath, query);
    res.json({ files });
  } catch (err) {
    log.warn({ err }, 'Failed to search files');
    res.status(500).json({ error: 'Failed to search files' });
  }
});

router.post('/create', validate({
  body: z.object({ root: z.string().min(1), path: z.string().min(1) }),
}), async (req, res) => {
  try {
    const { root, path } = req.body;
    await createFile(root, path);
    const language = getLanguageFromPath(path);
    res.json({ success: true, path, language });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create file';
    const status = message.includes('Invalid') || message.includes('traversal') || message.includes('already exists') ? 400 : 500;
    res.status(status).json({ error: message });
  }
});

router.post('/mkdir', validate({
  body: z.object({ parentPath: z.string().min(1), name: z.string().min(1) }),
}), async (req, res) => {
  try {
    const { parentPath, name } = req.body;
    const fullPath = await createDirectory(parentPath, name);
    res.json({ path: fullPath });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create directory';
    const status = message.includes('Invalid') || message.includes('traversal') ? 400 : 500;
    res.status(status).json({ error: message });
  }
});

/** Clone a git repository with SSE progress streaming */
router.post('/clone', validate({
  body: z.object({ url: z.string().min(1), targetDir: z.string().optional() }),
}), (req, res) => {
  const { url, targetDir } = req.body;

  // Validate URL
  const validPattern = /^(https?:\/\/|git@)/;
  if (!validPattern.test(url)) {
    res.status(400).json({ error: 'Invalid repository URL' });
    return;
  }

  // Determine target directory
  const repoName = basename(url).replace(/\.git$/, '');
  const parentDir = targetDir || getHomeDir();
  const clonePath = join(parentDir, repoName);

  if (existsSync(clonePath)) {
    res.status(409).json({ error: `Directory already exists: ${clonePath}` });
    return;
  }

  // Set up SSE
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  const sendEvent = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  sendEvent('progress', { message: `Cloning ${url}...`, percent: 0 });

  const proc = spawn('git', ['clone', '--progress', url, clonePath], {
    cwd: parentDir,
    env: { ...process.env },
  });

  const cloneTimeout = setTimeout(() => {
    proc.kill();
    sendEvent('error', { message: 'Clone timed out after 10 minutes' });
    res.end();
  }, 10 * 60_000);

  // Send keepalive SSE comments every 15s to prevent proxy/ALB timeouts
  const keepalive = setInterval(() => {
    res.write(': keepalive\n\n');
  }, 15_000);

  // git clone writes progress to stderr
  proc.stderr.on('data', (chunk: Buffer) => {
    const text = chunk.toString();
    // Parse git progress: "Receiving objects: 42% (100/238)"
    const match = text.match(/(\d+)%/);
    const percent = match ? parseInt(match[1]!) : undefined;
    sendEvent('progress', { message: text.trim(), percent });
  });

  proc.stdout.on('data', (chunk: Buffer) => {
    sendEvent('progress', { message: chunk.toString().trim() });
  });

  proc.on('close', (code) => {
    clearTimeout(cloneTimeout);
    clearInterval(keepalive);
    if (code === 0) {
      sendEvent('complete', { path: clonePath, repoName });
    } else {
      sendEvent('error', { message: `Clone failed with exit code ${code}` });
    }
    res.end();
  });

  proc.on('error', (err) => {
    clearTimeout(cloneTimeout);
    clearInterval(keepalive);
    sendEvent('error', { message: err.message });
    res.end();
  });

  // Handle client disconnect
  res.on('close', () => {
    clearTimeout(cloneTimeout);
    clearInterval(keepalive);
    proc.kill();
  });
});

export default router;
