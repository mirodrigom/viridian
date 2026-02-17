import { Router } from 'express';
import { randomUUID } from 'crypto';
import archiver from 'archiver';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';
import { getDb } from '../db/database.js';
import { claudeQuery } from '../services/claude-sdk.js';
import { safeJsonParse } from '../lib/safeJson.js';
import { exportGraphToClaude } from '../services/graph-exporter.js';

const router: ReturnType<typeof Router> = Router();
router.use(authMiddleware);

interface GraphRow {
  id: string;
  user_id: number;
  project_path: string;
  name: string;
  description: string;
  graph_data: string;
  created_at: string;
  updated_at: string;
}

function rowToGraph(row: GraphRow) {
  const graphData = safeJsonParse<Record<string, unknown>>(row.graph_data, {});
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    projectPath: row.project_path,
    nodes: graphData.nodes || [],
    edges: graphData.edges || [],
    viewport: graphData.viewport || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToSummary(row: GraphRow) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    updatedAt: row.updated_at,
  };
}

// GET / — list graphs for a project
router.get('/', (req: AuthRequest, res) => {
  const { project } = req.query;
  if (!project || typeof project !== 'string') {
    res.status(400).json({ error: 'project query param required' });
    return;
  }

  const db = getDb();
  const rows = db.prepare(
    'SELECT * FROM graphs WHERE user_id = ? AND project_path = ? ORDER BY updated_at DESC',
  ).all(req.user!.id, project) as GraphRow[];
  res.json({ graphs: rows.map(rowToSummary) });
});

// GET /:id — get single graph with full data
router.get('/:id', (req: AuthRequest, res) => {
  const db = getDb();
  const row = db.prepare(
    'SELECT * FROM graphs WHERE id = ? AND user_id = ?',
  ).get(req.params.id, req.user!.id) as GraphRow | undefined;
  if (!row) { res.status(404).json({ error: 'Graph not found' }); return; }
  res.json(rowToGraph(row));
});

// POST / — create graph
router.post('/', (req: AuthRequest, res) => {
  const { name, project, description, graphData } = req.body;
  if (!project) {
    res.status(400).json({ error: 'project is required' });
    return;
  }

  const db = getDb();
  const id = randomUUID();

  db.prepare(`
    INSERT INTO graphs (id, user_id, project_path, name, description, graph_data)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, req.user!.id, project, name || 'Untitled Graph', description || '', JSON.stringify(graphData || {}));

  const row = db.prepare('SELECT * FROM graphs WHERE id = ?').get(id) as GraphRow;
  res.status(201).json(rowToGraph(row));
});

// PUT /:id — update graph
router.put('/:id', (req: AuthRequest, res) => {
  const db = getDb();
  const existing = db.prepare(
    'SELECT * FROM graphs WHERE id = ? AND user_id = ?',
  ).get(req.params.id, req.user!.id) as GraphRow | undefined;
  if (!existing) { res.status(404).json({ error: 'Graph not found' }); return; }

  const { name, description, graphData } = req.body;

  const updates: string[] = [];
  const params: unknown[] = [];

  if (name !== undefined) { updates.push('name = ?'); params.push(name); }
  if (description !== undefined) { updates.push('description = ?'); params.push(description); }
  if (graphData !== undefined) { updates.push('graph_data = ?'); params.push(JSON.stringify(graphData)); }

  if (updates.length === 0) { res.json(rowToGraph(existing)); return; }

  updates.push('updated_at = CURRENT_TIMESTAMP');
  params.push(req.params.id, req.user!.id);

  db.prepare(`UPDATE graphs SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`).run(...params);
  const row = db.prepare('SELECT * FROM graphs WHERE id = ?').get(req.params.id) as GraphRow;
  res.json(rowToGraph(row));
});

// DELETE /:id — delete graph
router.delete('/:id', (req: AuthRequest, res) => {
  const db = getDb();
  const existing = db.prepare(
    'SELECT id FROM graphs WHERE id = ? AND user_id = ?',
  ).get(req.params.id, req.user!.id);
  if (!existing) { res.status(404).json({ error: 'Graph not found' }); return; }

  db.prepare('DELETE FROM graphs WHERE id = ? AND user_id = ?').run(req.params.id, req.user!.id);
  res.json({ ok: true });
});

// ─── Export as .claude/ directory (zip) ─────────────────────────────────

router.post('/export-claude', (req: AuthRequest, res) => {
  try {
    const { graphData, name } = req.body;
    if (!graphData?.nodes || !graphData?.edges) {
      res.status(400).json({ error: 'graphData with nodes and edges is required' });
      return;
    }

    const files = exportGraphToClaude(graphData, name || 'Untitled Graph');

    const safeName = (name || 'graph')
      .replace(/[<>:"/\\|?*]/g, '')
      .replace(/\s+/g, '-')
      .toLowerCase();

    res.writeHead(200, {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${safeName}-claude.zip"`,
    });

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.pipe(res);

    for (const file of files) {
      archive.append(file.content, { name: file.path });
    }

    archive.finalize();
  } catch (err) {
    if (!res.headersSent) {
      const msg = err instanceof Error ? err.message : 'Export failed';
      res.status(500).json({ error: msg });
    }
  }
});

// ─── AI prompt generation ───────────────────────────────────────────────

interface PromptGenInput {
  nodeType: string;
  label?: string;
  description?: string;
  model?: string;
  permissionMode?: string;
  specialty?: string;
  taskDescription?: string;
  command?: string;
  ruleType?: string;
  scope?: string;
  connections?: {
    parents: { label: string; nodeType: string; description?: string }[];
    children: { label: string; nodeType: string; description?: string; edgeType: string }[];
  };
  existingPrompt?: string;
}

function buildPromptGenerationQuery(input: PromptGenInput): string {
  const { nodeType, label, description, connections, existingPrompt } = input;

  let graphContext = '';
  if (connections) {
    if (connections.parents.length > 0) {
      graphContext += '\nUpstream nodes (delegate TO this node):\n';
      for (const p of connections.parents) {
        graphContext += `  - [${p.nodeType}] "${p.label}"${p.description ? ` — ${p.description}` : ''}\n`;
      }
    }
    if (connections.children.length > 0) {
      graphContext += '\nDownstream nodes (this node connects TO):\n';
      for (const c of connections.children) {
        graphContext += `  - [${c.nodeType}] "${c.label}" (${c.edgeType})${c.description ? ` — ${c.description}` : ''}\n`;
      }
    }
  }

  const refinementClause = existingPrompt
    ? `\n\nThe user has an existing prompt. Refine and improve it rather than replacing it entirely:\n\`\`\`\n${existingPrompt}\n\`\`\``
    : '';

  const typeInstructions: Record<string, string> = {
    agent: `This is a top-level orchestrator AGENT node.
Model: ${input.model || 'unspecified'}
Permission Mode: ${input.permissionMode || 'unspecified'}

Generate a comprehensive system prompt for an AI agent orchestrator. Include:
- Its primary role and responsibilities based on the label and description
- Tool usage guidelines (what tools to prefer, when to delegate)
- Delegation patterns (when to spawn subagents vs handle directly)
- Output format expectations
- Error handling approach`,

    subagent: `This is a SUBAGENT (delegated worker) node.
Model: ${input.model || 'unspecified'}
Permission Mode: ${input.permissionMode || 'unspecified'}
Task Description: ${input.taskDescription || 'unspecified'}

Generate a focused worker system prompt for a delegated subagent. Include:
- The specific task/domain this subagent handles (based on taskDescription and label)
- How it should report results back to its parent
- Scope boundaries (what it should and should NOT do)
- Quality standards for its output`,

    expert: `This is an EXPERT (deep specialist) node.
Model: ${input.model || 'unspecified'}
Specialty: ${input.specialty || 'unspecified'}

Generate a specialist system prompt. Include:
- Deep expertise description based on the specialty field
- When this expert should be consulted
- The format and depth of analysis expected
- How it should communicate findings`,

    skill: `This is a SKILL (reusable prompt template) node.
Command: ${input.command || 'unspecified'}

Generate a prompt template for a reusable skill. Include:
- Clear instructions for what this skill does
- Variable placeholders using {{variable_name}} syntax for dynamic inputs
- Expected input format
- Expected output format`,

    rule: `This is a RULE (behavioral constraint) node.
Rule Type: ${input.ruleType || 'guideline'}
Scope: ${input.scope || 'project'}

Generate rule/constraint text. Include:
- Clear, enforceable ${input.ruleType || 'guideline'} statement(s)
- Specific behaviors that are required or prohibited
- Scope of applicability (${input.scope || 'project'}-level)`,
  };

  return `You are an expert at writing system prompts for AI agent architectures. Generate a high-quality prompt for the following node in a multi-agent graph.

Node Type: ${nodeType}
Label: "${label || 'Unnamed'}"
${description ? `Description: "${description}"` : ''}

${typeInstructions[nodeType] || 'Generate an appropriate prompt for this node.'}
${graphContext}${refinementClause}

Rules:
- Output ONLY the raw prompt text — no markdown fences, no explanatory preamble, no meta-commentary
- Be specific and actionable, not generic
- Tailor the prompt to this node's specific role in the graph based on its label, description, and connections
- If the node has downstream skills/tools/MCPs, reference them by name where useful
- If the node has upstream parents, acknowledge the delegation context
- Keep the prompt focused and professional`;
}

router.post('/generate-prompt', async (req: AuthRequest, res) => {
  try {
    const { nodeType } = req.body;
    if (!nodeType) {
      res.status(400).json({ error: 'nodeType is required' });
      return;
    }

    const prompt = buildPromptGenerationQuery(req.body);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    const abortController = new AbortController();
    res.on('close', () => abortController.abort());

    const timeout = setTimeout(() => {
      abortController.abort();
      res.write(`event: error\ndata: ${JSON.stringify({ error: 'Request timed out after 5 minutes' })}\n\n`);
      res.end();
    }, 5 * 60_000);

    for await (const msg of claudeQuery({
      prompt,
      cwd: process.cwd(),
      permissionMode: 'bypassPermissions',
      noTools: true,
      abortSignal: abortController.signal,
    })) {
      if (msg.type === 'text_delta') {
        res.write(`event: delta\ndata: ${JSON.stringify({ text: msg.text })}\n\n`);
      } else if (msg.type === 'error') {
        res.write(`event: error\ndata: ${JSON.stringify({ error: msg.error })}\n\n`);
      }
    }
    clearTimeout(timeout);
    res.write(`event: done\ndata: {}\n\n`);
    res.end();
  } catch (err) {
    clearTimeout(timeout);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to generate prompt' });
    } else {
      const msg = err instanceof Error ? err.message : 'Failed to generate prompt';
      res.write(`event: error\ndata: ${JSON.stringify({ error: msg })}\n\n`);
      res.end();
    }
  }
});

export default router;
