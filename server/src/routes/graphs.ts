import { Router } from 'express';
import { randomUUID } from 'crypto';
import { readdirSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import archiver from 'archiver';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';
import { getDb } from '../db/database.js';
import { claudeQuery } from '../services/claude-sdk.js';
import { safeJsonParse } from '../lib/safeJson.js';
import { exportGraphToClaude } from '../services/graph-exporter.js';
import { generateMetadataForNodes } from '../services/metadata-generator.js';
import type { MetadataGenerationInput } from '../services/metadata-generator.js';

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

// ─── Project asset scanning helpers ─────────────────────────────────

type FmValue = string | string[] | Record<string, string>[];

function parseFrontmatter(content: string): { fm: Record<string, FmValue>; body: string } {
  if (!content.startsWith('---\n')) return { fm: {}, body: content.trim() };
  const end = content.indexOf('\n---\n', 4);
  if (end === -1) return { fm: {}, body: content.trim() };

  const yamlStr = content.slice(4, end);
  const body = content.slice(end + 5).trim();
  const fm: Record<string, FmValue> = {};
  let currentArrayKey: string | null = null;
  // Track whether the current array contains objects (e.g. capabilities)
  let currentArrayIsObjects = false;

  for (const line of yamlStr.split('\n')) {
    // Multi-line array item: "  - key: value" (object) or "  - value" (string)
    if (currentArrayKey && /^\s+-\s+/.test(line)) {
      const item = line.replace(/^\s+-\s+/, '').trim();
      // Check if this is an object item ("key: value")
      const objMatch = item.match(/^([a-zA-Z_]\w*)\s*:\s*(.+)/);
      if (objMatch) {
        currentArrayIsObjects = true;
        const arr = fm[currentArrayKey] as Record<string, string>[];
        arr.push({ [objMatch[1]]: objMatch[2].trim() });
      } else {
        (fm[currentArrayKey] as string[]).push(item);
      }
      continue;
    }
    // Continuation of an object item: "    key: value" (indented but no dash)
    if (currentArrayKey && currentArrayIsObjects && /^\s{4,}\S/.test(line)) {
      const kvMatch = line.trim().match(/^([a-zA-Z_]\w*)\s*:\s*(.+)/);
      if (kvMatch) {
        const arr = fm[currentArrayKey] as Record<string, string>[];
        if (arr.length > 0) {
          arr[arr.length - 1][kvMatch[1]] = kvMatch[2].trim();
        }
        continue;
      }
    }
    currentArrayKey = null;
    currentArrayIsObjects = false;

    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const rest = line.slice(colonIdx + 1).trim();

    if (rest === '') {
      // Start of a multi-line array
      currentArrayKey = key;
      fm[key] = [];
    } else {
      let value = rest;
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      fm[key] = value;
    }
  }

  return { fm, body };
}

const REVERSE_MODEL_MAP: Record<string, string> = {
  opus: 'claude-opus-4-6',
  sonnet: 'claude-sonnet-4-6',
  haiku: 'claude-haiku-4-5-20251001',
};

function reverseMapModel(short: string): string {
  return REVERSE_MODEL_MAP[short] || short || 'claude-sonnet-4-6';
}

function slugToLabel(slug: string): string {
  return slug.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// GET /project-assets — scan a project's .claude/ directory for importable assets
router.get('/project-assets', (req: AuthRequest, res) => {
  const { cwd } = req.query;
  if (!cwd || typeof cwd !== 'string') {
    res.status(400).json({ error: 'cwd query param required' });
    return;
  }

  try {
    const result: {
      agents: unknown[];
      skills: unknown[];
      mcps: unknown[];
      rules: unknown[];
      hasClaudeMd: boolean;
    } = { agents: [], skills: [], mcps: [], rules: [], hasClaudeMd: false };

    // ── Agents (.claude/agents/*.md) ─────────────────────────────────
    const agentsDir = join(cwd, '.claude', 'agents');
    if (existsSync(agentsDir)) {
      for (const file of readdirSync(agentsDir)) {
        if (!file.endsWith('.md')) continue;
        try {
          const content = readFileSync(join(agentsDir, file), 'utf8');
          const { fm, body } = parseFrontmatter(content);
          const slug = file.replace(/\.md$/, '');
          const label = fm.name ? slugToLabel(fm.name as string) : slugToLabel(slug);
          const toolsRaw = fm.tools || fm['allowed-tools'] || '';
          const disallowedRaw = fm.disallowedTools || '';

          // Parse metadata fields from frontmatter
          const tagsRaw = fm.tags || '';
          const tags = Array.isArray(tagsRaw) ? tagsRaw as string[] : (typeof tagsRaw === 'string' && tagsRaw ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean) : []);
          const fromRaw = fm.from || '';
          const fromArr = Array.isArray(fromRaw) ? fromRaw as string[] : (typeof fromRaw === 'string' && fromRaw ? fromRaw.split(',').map(t => t.trim()).filter(Boolean) : []);
          const toRaw = fm.to || '';
          const toArr = Array.isArray(toRaw) ? toRaw as string[] : (typeof toRaw === 'string' && toRaw ? toRaw.split(',').map(t => t.trim()).filter(Boolean) : []);
          const domain = (fm.domain as string) || 'general';
          const capabilitiesRaw = fm.capabilities;
          const capabilities = Array.isArray(capabilitiesRaw)
            ? (capabilitiesRaw as Record<string, string>[]).map(c => ({
                id: c.id || '',
                description: c.description || '',
              })).filter(c => c.id)
            : [];

          const metadata = (tags.length || fromArr.length || toArr.length || capabilities.length || domain !== 'general')
            ? { metadataVersion: 1 as const, tags, domain, from: fromArr, to: toArr, capabilities }
            : undefined;

          result.agents.push({
            label,
            description: fm.description || '',
            model: reverseMapModel((fm.model as string) || 'sonnet'),
            systemPrompt: body,
            allowedTools: Array.isArray(toolsRaw) ? toolsRaw as string[] : (typeof toolsRaw === 'string' && toolsRaw ? toolsRaw.split(',').map(t => t.trim()).filter(Boolean) : []),
            disallowedTools: Array.isArray(disallowedRaw) ? disallowedRaw as string[] : (typeof disallowedRaw === 'string' && disallowedRaw ? disallowedRaw.split(',').map(t => t.trim()).filter(Boolean) : []),
            permissionMode: (fm.permissionMode as string) || 'bypassPermissions',
            ...(metadata ? { metadata } : {}),
          });
        } catch { /* skip unreadable */ }
      }
    }

    // ── Skills (.claude/skills/*/SKILL.md) ───────────────────────────
    const skillsDir = join(cwd, '.claude', 'skills');
    if (existsSync(skillsDir)) {
      for (const dir of readdirSync(skillsDir)) {
        const skillFile = join(skillsDir, dir, 'SKILL.md');
        if (!existsSync(skillFile)) continue;
        try {
          const content = readFileSync(skillFile, 'utf8');
          const { fm, body } = parseFrontmatter(content);
          const commandName = (fm.name as string) || dir;
          const skillToolsRaw = fm['allowed-tools'] || fm.tools || '';
          result.skills.push({
            label: slugToLabel(commandName),
            description: (fm.description as string) || '',
            command: `/${commandName.replace(/^\//, '')}`,
            promptTemplate: body,
            allowedTools: Array.isArray(skillToolsRaw) ? skillToolsRaw : (skillToolsRaw ? skillToolsRaw.split(',').map(t => t.trim()).filter(Boolean) : []),
          });
        } catch { /* skip */ }
      }
    }

    // ── MCP servers (.mcp.json) ──────────────────────────────────────
    const mcpFile = join(cwd, '.mcp.json');
    if (existsSync(mcpFile)) {
      try {
        const mcpJson = JSON.parse(readFileSync(mcpFile, 'utf8'));
        const servers = (mcpJson.mcpServers || {}) as Record<string, Record<string, unknown>>;
        for (const [name, cfg] of Object.entries(servers)) {
          result.mcps.push({
            label: slugToLabel(name),
            serverType: (cfg.type as string) || 'stdio',
            command: (cfg.command as string) || '',
            args: (cfg.args as string[]) || [],
            url: (cfg.url as string) || '',
            env: (cfg.env as Record<string, string>) || {},
            headers: (cfg.headers as Record<string, string>) || {},
          });
        }
      } catch { /* skip */ }
    }

    // ── Rules (CLAUDE.md) ────────────────────────────────────────────
    const claudeMdFile = join(cwd, 'CLAUDE.md');
    if (existsSync(claudeMdFile)) {
      result.hasClaudeMd = true;
      try {
        const content = readFileSync(claudeMdFile, 'utf8');
        const rulesBeforeCount = result.rules.length;
        let currentSection = 'guideline';
        for (const line of content.split('\n')) {
          if (line.startsWith('## ')) {
            const heading = line.slice(3).toLowerCase().trim();
            if (heading.includes('allow')) currentSection = 'allow';
            else if (heading.includes('deny') || heading.includes('disallow')) currentSection = 'deny';
            else if (heading.includes('constraint')) currentSection = 'constraint';
            else currentSection = 'guideline';
            continue;
          }
          if (line.startsWith('#') || line.startsWith('>')) continue;

          // "- **Label**: text"
          const boldMatch = line.match(/^-\s+\*\*(.+?)\*\*:\s*(.+)/);
          if (boldMatch) {
            result.rules.push({
              label: boldMatch[1],
              ruleText: boldMatch[2].trim(),
              ruleType: currentSection,
              scope: 'project',
            });
            continue;
          }
          // "- plain text"
          const plainMatch = line.match(/^-\s+(.+)/);
          if (plainMatch && plainMatch[1].trim()) {
            result.rules.push({
              label: 'Rule',
              ruleText: plainMatch[1].trim(),
              ruleType: currentSection,
              scope: 'project',
            });
          }
        }
        // Fallback: if CLAUDE.md exists but no bullet-point rules were parsed,
        // import the entire file as a single guideline rule
        if (result.rules.length === rulesBeforeCount && content.trim()) {
          result.rules.push({
            label: 'CLAUDE.md',
            ruleText: content.trim(),
            ruleType: 'guideline',
            scope: 'project',
          });
        }
      } catch { /* skip */ }
    }

    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to read project assets';
    res.status(500).json({ error: msg });
  }
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

// ─── Save to project directory ──────────────────────────────────────────

router.post('/save-to-project', (req: AuthRequest, res) => {
  try {
    const { graphData, name, projectPath, preview } = req.body;
    if (!graphData?.nodes || !graphData?.edges) {
      res.status(400).json({ error: 'graphData with nodes and edges is required' });
      return;
    }
    if (!projectPath || typeof projectPath !== 'string') {
      res.status(400).json({ error: 'projectPath is required' });
      return;
    }

    const files = exportGraphToClaude(graphData, name || 'Untitled Graph');

    // Skip README — not needed when saving in-place
    const filtered = files.filter(f => f.path !== 'README.md');

    const fileInfos = filtered.map(f => {
      const fullPath = join(projectPath, f.path);
      return { path: f.path, exists: existsSync(fullPath), content: f.content };
    });

    if (preview) {
      res.json({ files: fileInfos.map(({ path, exists }) => ({ path, exists })) });
      return;
    }

    const written: string[] = [];
    const overwritten: string[] = [];

    for (const f of fileInfos) {
      const fullPath = join(projectPath, f.path);
      mkdirSync(dirname(fullPath), { recursive: true });
      if (f.exists) {
        overwritten.push(f.path);
      } else {
        written.push(f.path);
      }
      writeFileSync(fullPath, f.content, 'utf8');
    }

    res.json({ ok: true, written, overwritten });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Save to project failed';
    res.status(500).json({ error: msg });
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
  let timeout: ReturnType<typeof setTimeout> | undefined;
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

// ── POST /generate-metadata — auto-generate metadata for agent nodes ──

router.post('/generate-metadata', async (req: AuthRequest, res) => {
  try {
    const { graphData, projectPath } = req.body;
    if (!graphData?.nodes) {
      res.status(400).json({ error: 'graphData with nodes is required' });
      return;
    }

    const cwd = projectPath || process.cwd();

    // Extract agent/subagent/expert nodes as generation inputs
    const executableTypes = new Set(['agent', 'subagent', 'expert']);
    const inputs: MetadataGenerationInput[] = graphData.nodes
      .filter((n: Record<string, unknown>) => executableTypes.has(n.type as string))
      .map((n: Record<string, unknown>) => {
        const data = n.data as Record<string, unknown>;
        return {
          nodeId: n.id as string,
          label: (data.label as string) || '',
          description: (data.description as string) || undefined,
          systemPrompt: (data.systemPrompt as string) || undefined,
          specialty: (data.specialty as string) || undefined,
          taskDescription: (data.taskDescription as string) || undefined,
          nodeType: n.type as string,
        };
      });

    if (inputs.length === 0) {
      res.json({ results: [] });
      return;
    }

    const results = await generateMetadataForNodes(inputs, cwd);
    res.json({ results });
  } catch (err) {
    console.error('[graphs] generate-metadata error:', err);
    res.status(500).json({ error: 'Failed to generate metadata' });
  }
});

export default router;
