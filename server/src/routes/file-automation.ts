import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { createLogger } from '../logger.js';
import {
  previewBatchRename,
  executeBatchRename,
  previewClassify,
  executeClassify,
  previewOrganize,
  executeOrganize,
  previewMerge,
  executeMerge,
  undoLastOperation,
  getUndoStack,
} from '../services/file-automation.js';

const log = createLogger('file-automation');
const router: ReturnType<typeof Router> = Router();

router.use(authMiddleware);

// ─── Batch Rename ───────────────────────────────────────────────────────

router.post('/batch-rename/preview', validate({
  body: z.object({
    directoryPath: z.string().min(1),
    instruction: z.string().min(1),
  }),
}), async (req, res) => {
  try {
    const { directoryPath, instruction } = req.body;
    const mappings = await previewBatchRename(directoryPath, instruction);
    res.json({ mappings });
  } catch (err) {
    log.warn({ err }, 'Batch rename preview failed');
    const message = err instanceof Error ? err.message : 'Failed to preview rename';
    res.status(500).json({ error: message });
  }
});

router.post('/batch-rename/execute', validate({
  body: z.object({
    directoryPath: z.string().min(1),
    mappings: z.array(z.object({
      original: z.string().min(1),
      renamed: z.string().min(1),
    })),
  }),
}), async (req, res) => {
  try {
    const { directoryPath, mappings } = req.body;
    const result = await executeBatchRename(directoryPath, mappings);
    res.json(result);
  } catch (err) {
    log.warn({ err }, 'Batch rename execute failed');
    const message = err instanceof Error ? err.message : 'Failed to execute rename';
    res.status(500).json({ error: message });
  }
});

// ─── Classify ───────────────────────────────────────────────────────────

router.post('/classify/preview', validate({
  body: z.object({
    directoryPath: z.string().min(1),
    rules: z.string().optional(),
  }),
}), async (req, res) => {
  try {
    const { directoryPath, rules } = req.body;
    const classifications = await previewClassify(directoryPath, rules);
    res.json({ classifications });
  } catch (err) {
    log.warn({ err }, 'Classify preview failed');
    const message = err instanceof Error ? err.message : 'Failed to preview classification';
    res.status(500).json({ error: message });
  }
});

router.post('/classify/execute', validate({
  body: z.object({
    directoryPath: z.string().min(1),
    classifications: z.array(z.object({
      file: z.string().min(1),
      category: z.string().min(1),
      targetFolder: z.string().min(1),
    })),
  }),
}), async (req, res) => {
  try {
    const { directoryPath, classifications } = req.body;
    const result = await executeClassify(directoryPath, classifications);
    res.json(result);
  } catch (err) {
    log.warn({ err }, 'Classify execute failed');
    const message = err instanceof Error ? err.message : 'Failed to execute classification';
    res.status(500).json({ error: message });
  }
});

// ─── Organize ───────────────────────────────────────────────────────────

router.post('/organize/preview', validate({
  body: z.object({
    directoryPath: z.string().min(1),
    instruction: z.string().min(1),
  }),
}), async (req, res) => {
  try {
    const { directoryPath, instruction } = req.body;
    const moves = await previewOrganize(directoryPath, instruction);
    res.json({ moves });
  } catch (err) {
    log.warn({ err }, 'Organize preview failed');
    const message = err instanceof Error ? err.message : 'Failed to preview organization';
    res.status(500).json({ error: message });
  }
});

router.post('/organize/execute', validate({
  body: z.object({
    directoryPath: z.string().min(1),
    moves: z.array(z.object({
      source: z.string().min(1),
      destination: z.string().min(1),
    })),
  }),
}), async (req, res) => {
  try {
    const { directoryPath, moves } = req.body;
    const result = await executeOrganize(directoryPath, moves);
    res.json(result);
  } catch (err) {
    log.warn({ err }, 'Organize execute failed');
    const message = err instanceof Error ? err.message : 'Failed to execute organization';
    res.status(500).json({ error: message });
  }
});

// ─── Merge ──────────────────────────────────────────────────────────────

router.post('/merge/preview', validate({
  body: z.object({
    filePaths: z.array(z.string().min(1)).min(2).max(20),
    instruction: z.string().min(1),
    rootPath: z.string().min(1),
  }),
}), async (req, res) => {
  try {
    const { filePaths, instruction, rootPath } = req.body;
    const mergedContent = await previewMerge(filePaths, instruction, rootPath);
    res.json({ mergedContent });
  } catch (err) {
    log.warn({ err }, 'Merge preview failed');
    const message = err instanceof Error ? err.message : 'Failed to preview merge';
    res.status(500).json({ error: message });
  }
});

router.post('/merge/execute', validate({
  body: z.object({
    filePaths: z.array(z.string().min(1)).min(2),
    mergedContent: z.string(),
    outputPath: z.string().min(1),
    rootPath: z.string().min(1),
  }),
}), async (req, res) => {
  try {
    const { filePaths, mergedContent, outputPath, rootPath } = req.body;
    await executeMerge(filePaths, mergedContent, outputPath, rootPath);
    res.json({ success: true, outputPath });
  } catch (err) {
    log.warn({ err }, 'Merge execute failed');
    const message = err instanceof Error ? err.message : 'Failed to execute merge';
    res.status(500).json({ error: message });
  }
});

// ─── Undo ───────────────────────────────────────────────────────────────

router.post('/undo', async (_req, res) => {
  try {
    const result = await undoLastOperation();
    if (!result.undone) {
      res.status(404).json({ error: 'Nothing to undo' });
      return;
    }
    res.json(result);
  } catch (err) {
    log.warn({ err }, 'Undo failed');
    const message = err instanceof Error ? err.message : 'Failed to undo';
    res.status(500).json({ error: message });
  }
});

router.get('/undo-stack', async (_req, res) => {
  res.json({ stack: getUndoStack() });
});

export default router;
