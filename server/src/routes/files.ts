import { Router } from 'express';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';
import { getFileTree, getFileContent, saveFileContent, getLanguageFromPath, searchFiles } from '../services/files.js';

const router: ReturnType<typeof Router> = Router();

router.use(authMiddleware);

router.get('/tree', async (req, res) => {
  try {
    const rootPath = (req.query.path as string) || process.env.HOME || '/home';
    const depth = parseInt(req.query.depth as string) || 3;
    const tree = await getFileTree(rootPath, depth);
    res.json({ tree, rootPath });
  } catch (err) {
    res.status(500).json({ error: 'Failed to read directory' });
  }
});

router.get('/content', async (req, res) => {
  try {
    const rootPath = req.query.root as string;
    const filePath = req.query.path as string;
    if (!rootPath || !filePath) {
      res.status(400).json({ error: 'root and path are required' });
      return;
    }
    const content = await getFileContent(rootPath, filePath);
    const language = getLanguageFromPath(filePath);
    res.json({ content, language, path: filePath });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to read file';
    res.status(500).json({ error: message });
  }
});

router.put('/content', async (req, res) => {
  try {
    const { root, path, content } = req.body;
    if (!root || !path || content === undefined) {
      res.status(400).json({ error: 'root, path, and content are required' });
      return;
    }
    await saveFileContent(root, path, content);
    res.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to save file';
    res.status(500).json({ error: message });
  }
});

router.get('/search', async (req, res) => {
  try {
    const rootPath = req.query.root as string;
    const query = req.query.q as string;
    if (!rootPath || !query) {
      res.status(400).json({ error: 'root and q are required' });
      return;
    }
    const files = await searchFiles(rootPath, query);
    res.json({ files });
  } catch (err) {
    res.status(500).json({ error: 'Failed to search files' });
  }
});

export default router;
