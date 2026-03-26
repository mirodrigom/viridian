import { Router } from 'express';
import { db } from '../db/database.js';
import { safeJsonParse } from '../lib/safeJson.js';
import { createLogger } from '../logger.js';

const log = createLogger('shared');
const router: ReturnType<typeof Router> = Router();

// No auth middleware — this is a public endpoint

interface DiagramRow {
  id: string;
  user_id: number;
  project_path: string;
  name: string;
  description: string;
  diagram_data: string;
  created_at: string;
  updated_at: string;
}

// GET /diagrams/:shareToken — public shared diagram view
router.get('/diagrams/:shareToken', async (req, res) => {
  try {
    const { shareToken } = req.params;

    const share = await db('diagram_shares')
      .where({ id: shareToken })
      .first();

    if (!share) {
      res.status(404).json({ error: 'Diagram not found or link expired' });
      return;
    }

    const row = await db('diagrams')
      .where({ id: share.diagram_id })
      .first() as DiagramRow | undefined;

    if (!row) {
      res.status(404).json({ error: 'Diagram not found or link expired' });
      return;
    }

    const diagramData = safeJsonParse<Record<string, unknown>>(row.diagram_data, {});

    res.json({
      id: row.id,
      name: row.name,
      description: row.description,
      nodes: diagramData.nodes || [],
      edges: diagramData.edges || [],
      viewport: diagramData.viewport || null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  } catch (err) {
    log.error({ err }, 'Failed to fetch shared diagram');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
