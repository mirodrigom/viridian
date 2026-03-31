import { Router } from 'express';
import { randomUUID } from 'crypto';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';
import { db } from '../db/database.js';
import { getProvider } from '../providers/registry.js';
import type { ProviderId } from '../providers/types.js';
import { createLogger } from '../logger.js';
import { validate } from '../middleware/validate.js';
import { z } from 'zod';

const log = createLogger('confluence');

const router: ReturnType<typeof Router> = Router();
router.use(authMiddleware);

// ─── Types ────────────────────────────────────────────────────────────

interface ConfluencePageRow {
  id: string;
  user_id: number;
  project_path: string;
  title: string;
  input_text: string;
  markdown: string;
  confluence_output: string;
  created_at: string;
  updated_at: string;
}

function rowToPage(row: ConfluencePageRow) {
  return {
    id: row.id,
    title: row.title,
    inputText: row.input_text,
    markdown: row.markdown,
    confluenceOutput: row.confluence_output,
    projectPath: row.project_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToSummary(row: ConfluencePageRow) {
  return {
    id: row.id,
    title: row.title,
    updatedAt: row.updated_at,
  };
}

// ─── CRUD Endpoints ───────────────────────────────────────────────────

// GET /pages — list saved pages for a project
router.get('/pages', validate({ query: z.object({ project: z.string().min(1) }) }), async (req: AuthRequest, res) => {
  const { project } = req.query;

  const rows = await db('confluence_pages')
    .where({ user_id: req.user!.id, project_path: project })
    .orderBy('updated_at', 'desc')
    .select() as ConfluencePageRow[];
  res.json({ pages: rows.map(rowToSummary) });
});

// GET /pages/:id — get single page
router.get('/pages/:id', async (req: AuthRequest, res) => {
  const row = await db('confluence_pages')
    .where({ id: req.params.id, user_id: req.user!.id })
    .first() as ConfluencePageRow | undefined;

  if (!row) {
    res.status(404).json({ error: 'Page not found' });
    return;
  }

  res.json(rowToPage(row));
});

// POST /pages — create new page
router.post('/pages', validate({ body: z.object({ project: z.string().min(1) }).passthrough() }), async (req: AuthRequest, res) => {
  const { title, project, inputText, markdown, confluenceOutput } = req.body;

  const id = randomUUID();

  await db('confluence_pages').insert({
    id,
    user_id: req.user!.id,
    project_path: project,
    title: title || 'Untitled Conversion',
    input_text: inputText || '',
    markdown: markdown || '',
    confluence_output: confluenceOutput || '',
  });

  const row = await db('confluence_pages').where({ id }).first() as ConfluencePageRow;
  res.status(201).json(rowToPage(row));
});

// PUT /pages/:id — update page
router.put('/pages/:id', async (req: AuthRequest, res) => {
  const existing = await db('confluence_pages')
    .where({ id: req.params.id, user_id: req.user!.id })
    .first() as ConfluencePageRow | undefined;

  if (!existing) {
    res.status(404).json({ error: 'Page not found' });
    return;
  }

  const { title, inputText, markdown, confluenceOutput } = req.body;

  const updates: Record<string, unknown> = {};

  if (title !== undefined) updates['title'] = title;
  if (inputText !== undefined) updates['input_text'] = inputText;
  if (markdown !== undefined) updates['markdown'] = markdown;
  if (confluenceOutput !== undefined) updates['confluence_output'] = confluenceOutput;

  if (Object.keys(updates).length === 0) {
    res.json(rowToPage(existing));
    return;
  }

  updates['updated_at'] = db.fn.now();
  await db('confluence_pages')
    .where({ id: req.params.id, user_id: req.user!.id })
    .update(updates);
  const row = await db('confluence_pages').where({ id: req.params.id }).first() as ConfluencePageRow;
  res.json(rowToPage(row));
});

// DELETE /pages/:id — delete page
router.delete('/pages/:id', async (req: AuthRequest, res) => {
  const deleted = await db('confluence_pages')
    .where({ id: req.params.id, user_id: req.user!.id })
    .delete();

  if (deleted === 0) {
    res.status(404).json({ error: 'Page not found' });
    return;
  }

  res.json({ ok: true });
});

// ─── Format Endpoint (existing) ───────────────────────────────────────

const formatBodySchema = z.object({
  text: z.string().min(1, 'text is required'),
  providerId: z.string().optional(),
  model: z.string().optional(),
});

const SYSTEM_PROMPT = `You are a professional documentation expert. You take raw, unformatted text and transform it into a richly structured, visually engaging Markdown document optimized for Confluence Cloud.

The output will be converted to HTML and pasted into Confluence's visual editor. You have access to ALL of these formatting features — USE THEM AGGRESSIVELY to make the document look polished and professional.

## CORE RULES
- Preserve ALL original content — do NOT summarize or remove information.
- Do NOT add introductions, conclusions, or meta-commentary.
- Do NOT wrap the output in a code fence.
- Return ONLY the formatted Markdown.

---

## FORMATTING ARSENAL — use every feature that applies

### Structure & Hierarchy
- **Headings (# to ######):** Break content into clear sections. Use H1 for the document title, H2 for major sections, H3-H4 for subsections. NEVER leave a large block of text without headings.
- **Horizontal rules (---):** Use between major sections for visual separation.
- **Sub-headings:** If a paragraph has 3+ distinct topics, split it with sub-headings.

### Text Emphasis
- **Bold (\*\*text\*\*):** Use GENEROUSLY for: service names, tool names, product names, key concepts, metrics, important values, action verbs in instructions ("Click **Save**", "Run **deploy**"), and anything the reader should spot while scanning.
- **Italic (*text*):** Use for: technical terms on first mention, file names, paths, book/article titles, and foreign phrases.
- **Bold + Italic (\*\*\*text\*\*\*):** Use sparingly for critical emphasis — the single most important word or phrase in a section.
- **Strikethrough (~~text~~):** Use when showing deprecated or replaced values.

### Code & Technical Content
- **Inline code (\`text\`):** Use for ALL: commands, CLI flags, function names, variable names, port numbers, URLs, config keys, env vars, file paths, version numbers, error codes, HTTP methods (\`GET\`, \`POST\`), status codes (\`200\`, \`404\`), and any literal value.
- **Fenced code blocks (\`\`\`lang):** Use for multi-line code, config files, terminal output, JSON/YAML, SQL queries, etc. ALWAYS specify the language identifier.
  - Common languages: \`bash\`, \`python\`, \`javascript\`, \`typescript\`, \`json\`, \`yaml\`, \`sql\`, \`java\`, \`go\`, \`xml\`, \`dockerfile\`, \`hcl\`

### Lists & Organization
- **Bulleted lists (-):** Use for unordered collections, features, requirements.
- **Numbered lists (1.):** Use for sequential steps, procedures, priorities, rankings.
- **Nested lists:** Use 2-3 levels of nesting to show hierarchy within lists.
- **Task lists (- [ ]):** Use for checklists, action items, acceptance criteria.

### Tables
- Use Markdown tables when presenting: comparisons, feature matrices, config options, API parameters, environment variables, service mappings, status summaries, or ANY set of 3+ items with shared attributes.
- Always include a header row with descriptive column names.
- Tables make information dramatically more scannable than paragraphs — prefer them over long lists when data has 2+ attributes.

Example:
| Service | Port | Purpose |
|---------|------|---------|
| **API Gateway** | \`8080\` | Routes external traffic |
| **Auth Service** | \`8081\` | JWT validation |

### Links & References
- Convert raw URLs to proper Markdown links: [Display Text](url)
- For repeated references, use consistent link text.

### Blockquotes
- Use standard blockquotes (>) for: quoted text, excerpts, definitions, or key takeaways.

---

## ADMONITIONS — colored callout panels (CRITICAL FEATURE)

These render as colored panels in Confluence. Use GitHub-style alerts PROACTIVELY — you MUST include at least 2-3 admonitions in any document longer than 5 lines.

### Types and when to use each:

**> [!NOTE]** (blue panel) — Supplementary information:
- Background context, FYI details, "good to know" info
- Explanations of WHY something works a certain way
- References to related documentation or resources
- Clarifications that prevent confusion

**> [!TIP]** (green panel) — Helpful advice:
- Best practices and recommendations
- Performance optimizations and shortcuts
- "Pro tips" and time-saving tricks
- Alternative approaches that might be better

**> [!IMPORTANT]** (purple panel) — Must-know information:
- Prerequisites and requirements
- Mandatory configuration steps
- Constraints, limitations, or deadlines
- Dependencies that must be met first

**> [!WARNING]** (yellow panel) — Potential problems:
- Common mistakes and gotchas
- Breaking changes and deprecations
- Side effects and unexpected behavior
- Compatibility issues

**> [!CAUTION]** (red panel) — Danger zone:
- Destructive or irreversible operations
- Data loss risks
- Security vulnerabilities
- Production-impacting actions

### PROACTIVE USAGE — extract admonitions from the text even when not explicitly labeled:
- A sentence mentioning a prerequisite → \`> [!IMPORTANT]\`
- A sentence about a common pitfall → \`> [!WARNING]\`
- A helpful shortcut or best practice → \`> [!TIP]\`
- Context or background explanation → \`> [!NOTE]\`
- Anything involving deletion, data loss, or security → \`> [!CAUTION]\`

### Syntax (EVERY line MUST start with "> "):
> [!WARNING]
> This operation will **delete all data** in the \`production\` database.
> Make sure to create a backup before proceeding.

---

## ENRICHMENT STRATEGY

When processing the raw text, follow this mental checklist:

1. **Identify the document type** (runbook, architecture doc, meeting notes, API docs, tutorial, RFC, incident report, etc.) and apply appropriate conventions.
2. **Add structure first:** headings, sections, horizontal rules.
3. **Format inline elements:** bold key terms, italicize tech terms, code-span all literals.
4. **Create tables** wherever you see list-like data with multiple attributes.
5. **Add admonitions** — scan every paragraph for warnings, tips, important notes, cautions.
6. **Add code blocks** with language identifiers for any multi-line code or config.
7. **Final check:** Is anything still a "wall of text"? Break it up further.

---

## DIAGRAMS — handle ASCII art
- When the text contains ASCII art diagrams (box-drawing characters, arrows, text-based flowcharts), convert to a structured table or bulleted architecture breakdown.
- Extract all components, relationships, and data flows.
- Present with clear headings for each layer/section.
- Do NOT try to recreate ASCII art.`;

// POST /format — convert raw text to Markdown via AI, streamed as SSE
router.post('/format', async (req: AuthRequest, res) => {
  const parsed = formatBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message ?? 'Invalid request body' });
    return;
  }

  const { text, providerId = 'claude', model } = parsed.data;

  // SSE setup
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  function sendEvent(type: string, data: Record<string, unknown>) {
    res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
  }

  try {
    const provider = getProvider(providerId as ProviderId);
    log.info({ provider: providerId, textLength: text.length }, 'Format start');

    sendEvent('progress', { text: 'Connecting to provider...' });

    let accumulatedText = '';
    let lastProgressAt = 0;

    const stream = provider.query({
      prompt: text,
      systemPrompt: SYSTEM_PROMPT,
      cwd: '/tmp',
      model,
      permissionMode: 'bypassPermissions',
      noTools: true,
    });

    for await (const msg of stream) {
      if (msg.type === 'text_delta') {
        accumulatedText += msg.text;
        const now = Date.now();
        if (now - lastProgressAt > 500) {
          lastProgressAt = now;
          sendEvent('progress', { text: accumulatedText });
        }
      }
    }

    log.info({ chars: accumulatedText.length }, 'Format done');

    const stripped = accumulatedText.replace(/\s+/g, '');
    if (!stripped || stripped.length < 1) {
      log.warn({ chars: accumulatedText.length }, 'Provider returned empty content');
      sendEvent('error', { error: 'The AI provider returned no content. Check that the provider is properly configured and has API access.' });
      res.end();
      return;
    }

    sendEvent('done', { markdown: accumulatedText });
    res.end();
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    log.error({ err, errorMsg }, 'Format failed');
    sendEvent('error', { error: errorMsg });
    res.end();
  }
});

// ─── Diagram Generation Endpoint ─────────────────────────────────────

const diagramBodySchema = z.object({
  asciiArt: z.string().min(1, 'asciiArt is required'),
  providerId: z.string().optional(),
  model: z.string().optional(),
});

const DIAGRAM_SYSTEM_PROMPT = `You are an AWS architecture diagram generator. You receive ASCII art diagrams or text-based architecture descriptions and produce structured JSON commands that a visual diagram editor executes.

Your task: analyze the ASCII art / architecture text and produce a \`\`\`diagram-commands\`\`\` block that recreates the architecture as an AWS diagram.

## Output Format

Return ONLY a single fenced code block with the language identifier \`diagram-commands\`:

\`\`\`diagram-commands
[
  { "action": "newDiagram" },
  { "action": "addGroup", "params": { "refId": "acct", "groupTypeId": "account", "label": "AWS Account" } },
  ...
]
\`\`\`

## Command Reference

**newDiagram** — Clear the canvas (always start with this)
**addGroup** — Add a container: { "action": "addGroup", "params": { "refId": "<unique-ref>", "groupTypeId": "<type>", "label": "<name>" } }
  Group types: account, region, vpc, availability-zone, subnet-public, subnet-private, security-group, auto-scaling, generic
**addService** — Add an AWS service node: { "action": "addService", "params": { "refId": "<unique-ref>", "serviceId": "<aws-service-id>", "label": "<name>" } }
  Common service IDs: ec2, lambda, ecs, eks, s3, rds, dynamodb, aurora, elasticache, cloudfront, route53, elb, apigateway, vpc, sqs, sns, kinesis, cognito, iam, cloudwatch, cloudtrail, waf, stepfunctions, eventbridge, secretsmanager, kms, codepipeline, codebuild, codedeploy, ecr, fargate, lightsail, beanstalk, ebs, efs, glacier, redshift, documentdb, direct-connect, transit-gateway, shield, guardduty, inspector, config, systems-manager, msk, glue, athena, emr, sagemaker, bedrock, lex, rekognition, textract, translate, polly, comprehend, amplify, appsync
**setParent** — Nest a node inside a group: { "action": "setParent", "params": { "childRef": "<ref>", "parentRef": "<ref>" } }
**addEdge** — Connect two nodes: { "action": "addEdge", "params": { "sourceRef": "<ref>", "targetRef": "<ref>", "label": "<description>", "flowOrder": <number> } }
**updateNode** — Add metadata: { "action": "updateNode", "params": { "ref": "<ref>", "updates": { "description": "...", "notes": "..." } } }

## Rules

1. Always start with newDiagram
2. Always create an \`account\` group as root container
3. Every node must be parented via setParent (no floating nodes)
4. Create groups before their children: account -> region -> vpc -> az -> subnet -> services
5. Global services (cloudfront, route53, waf) go directly under account, NOT inside region
6. ALB/ELB in public subnet, RDS/Aurora/ElastiCache in private subnet
7. Lambda, SQS, SNS, S3, DynamoDB, API Gateway under region (not VPC) unless VPC-attached
8. Use short, descriptive labels on edges
9. Include flowOrder on edges when the architecture shows a numbered flow
10. Map ASCII art components to the closest matching AWS services
11. If the ASCII art shows non-AWS components (e.g. "Users", "Internet"), use the closest AWS service or omit and note in edge labels

Do NOT include any explanation or text outside the diagram-commands block. Return ONLY the code block.`;

// POST /generate-diagram — convert ASCII art to diagram commands via AI, streamed as SSE
router.post('/generate-diagram', async (req: AuthRequest, res) => {
  const parsed = diagramBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message ?? 'Invalid request body' });
    return;
  }

  const { asciiArt, providerId = 'claude', model } = parsed.data;

  // SSE setup
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  function sendEvent(type: string, data: Record<string, unknown>) {
    res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
  }

  try {
    const provider = getProvider(providerId as ProviderId);
    log.info({ provider: providerId, artLength: asciiArt.length }, 'Diagram generation start');

    sendEvent('progress', { text: 'Analyzing architecture diagram...' });

    let accumulatedText = '';

    const stream = provider.query({
      prompt: `Convert this ASCII art / text architecture diagram into diagram-commands:\n\n${asciiArt}`,
      systemPrompt: DIAGRAM_SYSTEM_PROMPT,
      cwd: '/tmp',
      model,
      permissionMode: 'bypassPermissions',
      noTools: true,
    });

    for await (const msg of stream) {
      if (msg.type === 'text_delta') {
        accumulatedText += msg.text;
      }
    }

    log.info({ chars: accumulatedText.length }, 'Diagram generation done');

    const stripped = accumulatedText.replace(/\s+/g, '');
    if (!stripped || stripped.length < 1) {
      sendEvent('error', { error: 'The AI provider returned no content for diagram generation.' });
      res.end();
      return;
    }

    sendEvent('done', { commands: accumulatedText });
    res.end();
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    log.error({ err, errorMsg }, 'Diagram generation failed');
    sendEvent('error', { error: errorMsg });
    res.end();
  }
});

export default router;
