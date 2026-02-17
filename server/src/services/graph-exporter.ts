/**
 * Graph → .claude/ directory exporter.
 *
 * Transforms a Viridian graph into a set of files matching Claude CLI's
 * native directory structure (.claude/agents/, .claude/skills/, CLAUDE.md, .mcp.json).
 * The output can be zipped and dropped into any project for native CLI usage.
 */

import { resolveExecutionGraph, findRootNode } from './graph-runner.js';

// ─── Types ──────────────────────────────────────────────────────────────

interface GraphNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: Record<string, unknown>;
}

interface GraphEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  data: Record<string, unknown>;
}

interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface ExportedFile {
  /** Relative path in the zip (e.g. ".claude/agents/reviewer.md") */
  path: string;
  content: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────

const MODEL_MAP: Record<string, string> = {
  'claude-opus-4-6': 'opus',
  'claude-sonnet-4-5-20250929': 'sonnet',
  'claude-haiku-4-5-20251001': 'haiku',
};

function mapModel(fullId: string): string {
  return MODEL_MAP[fullId] || fullId;
}

function toSlug(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    || 'unnamed';
}

function dedupeSlug(slug: string, used: Set<string>): string {
  if (!used.has(slug)) {
    used.add(slug);
    return slug;
  }
  let counter = 2;
  while (used.has(`${slug}-${counter}`)) counter++;
  const unique = `${slug}-${counter}`;
  used.add(unique);
  return unique;
}

/**
 * Render a simple YAML frontmatter block.
 * Handles strings, numbers, and string arrays (inline for short lists).
 */
function renderYamlFrontmatter(data: Record<string, unknown>): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      // Short arrays inline, long arrays as block
      if (value.every(v => typeof v === 'string' && v.length < 40) && value.length <= 5) {
        lines.push(`${key}: ${value.join(', ')}`);
      } else {
        lines.push(`${key}:`);
        for (const item of value) {
          lines.push(`  - ${item}`);
        }
      }
    } else if (typeof value === 'string' && (value.includes(':') || value.includes('#') || value.includes('\n'))) {
      lines.push(`${key}: "${value.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`);
    } else {
      lines.push(`${key}: ${value}`);
    }
  }
  return lines.join('\n');
}

// ─── File Generators ────────────────────────────────────────────────────

interface ResolvedNode {
  node: GraphNode;
  skills: GraphNode[];
  mcps: GraphNode[];
  rules: GraphNode[];
  delegates: GraphNode[];
}

function generateAgentFile(
  resolved: ResolvedNode,
  slugMap: Map<string, string>,
): ExportedFile {
  const { node } = resolved;
  const d = node.data;
  const slug = slugMap.get(node.id)!;

  const fm: Record<string, unknown> = { name: slug };

  // Description
  const description = (d.description as string)
    || (d.taskDescription as string)
    || (d.specialty ? `${d.specialty} specialist` : '')
    || '';
  if (description) fm.description = description;

  // Model
  const model = mapModel((d.model as string) || '');
  if (model) fm.model = model;

  // Permission mode
  const perm = d.permissionMode as string;
  if (perm && perm !== 'bypassPermissions') fm.permissionMode = perm;

  // Tools
  const allowed = d.allowedTools as string[] | undefined;
  if (allowed?.length) fm.tools = allowed.join(', ');
  const disallowed = d.disallowedTools as string[] | undefined;
  if (disallowed?.length) fm.disallowedTools = disallowed.join(', ');

  // Skills — reference connected skill slugs
  const skillSlugs = resolved.skills
    .map(s => slugMap.get(s.id))
    .filter((s): s is string => !!s);
  if (skillSlugs.length > 0) fm.skills = skillSlugs;

  // MCP servers — reference by slug name
  const mcpNames = resolved.mcps
    .map(m => slugMap.get(m.id))
    .filter((s): s is string => !!s);
  if (mcpNames.length > 0) fm.mcpServers = mcpNames;

  // Build body from system prompt
  let body = (d.systemPrompt as string) || '';

  // For orchestrators, append delegate info
  if (resolved.delegates.length > 0) {
    const delegateLines = resolved.delegates.map(del => {
      const delSlug = slugMap.get(del.id) || toSlug((del.data.label as string) || 'agent');
      const desc = (del.data.description as string)
        || (del.data.taskDescription as string)
        || (del.data.specialty as string)
        || '';
      return `- **${del.data.label || delSlug}** (\`${delSlug}\`): ${desc}`;
    }).join('\n');
    body += `\n\n## Delegates\n\nYou can delegate tasks to the following agents:\n${delegateLines}`;
  }

  const yaml = renderYamlFrontmatter(fm);
  return {
    path: `.claude/agents/${slug}.md`,
    content: `---\n${yaml}\n---\n\n${body.trim()}\n`,
  };
}

function generateSkillFile(node: GraphNode, slug: string): ExportedFile {
  const d = node.data;
  const fm: Record<string, unknown> = {};

  const command = (d.command as string) || slug;
  fm.name = command.replace(/^\//, '');

  const description = (d.description as string) || '';
  if (description) fm.description = description;

  const tools = d.allowedTools as string[] | undefined;
  if (tools?.length) fm['allowed-tools'] = tools.join(', ');

  const body = (d.promptTemplate as string) || '';
  const yaml = renderYamlFrontmatter(fm);

  return {
    path: `.claude/skills/${slug}/SKILL.md`,
    content: `---\n${yaml}\n---\n\n${body.trim()}\n`,
  };
}

function generateMcpJson(mcpNodes: GraphNode[], slugMap: Map<string, string>): ExportedFile | null {
  if (mcpNodes.length === 0) return null;

  const mcpServers: Record<string, Record<string, unknown>> = {};

  for (const node of mcpNodes) {
    const name = slugMap.get(node.id) || toSlug((node.data.label as string) || 'mcp');
    const serverType = node.data.serverType as string;

    if (serverType === 'stdio') {
      mcpServers[name] = {
        type: 'stdio',
        command: node.data.command as string,
        args: (node.data.args as string[]) || [],
        ...(node.data.env && Object.keys(node.data.env as object).length > 0
          ? { env: node.data.env }
          : {}),
      };
    } else {
      mcpServers[name] = {
        type: serverType,
        url: node.data.url as string,
        ...(node.data.headers && Object.keys(node.data.headers as object).length > 0
          ? { headers: node.data.headers }
          : {}),
      };
    }
  }

  return {
    path: '.mcp.json',
    content: JSON.stringify({ mcpServers }, null, 2) + '\n',
  };
}

function generateClaudeMd(ruleNodes: GraphNode[], graphName: string): ExportedFile | null {
  if (ruleNodes.length === 0) return null;

  const lines: string[] = [];
  lines.push(`# ${graphName} — Project Rules\n`);
  lines.push('> Auto-generated from Viridian graph export.\n');

  // Group by ruleType
  const grouped: Record<string, GraphNode[]> = {};
  for (const r of ruleNodes) {
    const type = (r.data.ruleType as string) || 'guideline';
    if (!grouped[type]) grouped[type] = [];
    grouped[type].push(r);
  }

  for (const [type, rules] of Object.entries(grouped)) {
    lines.push(`## ${type.charAt(0).toUpperCase() + type.slice(1)}s\n`);
    for (const r of rules) {
      const label = (r.data.label as string) || 'Rule';
      const text = (r.data.ruleText as string) || '';
      lines.push(`- **${label}**: ${text}`);
    }
    lines.push('');
  }

  return { path: 'CLAUDE.md', content: lines.join('\n') };
}

function generateReadme(
  graphName: string,
  rootSlug: string,
  agentCount: number,
  skillCount: number,
  mcpCount: number,
  ruleCount: number,
): ExportedFile {
  const content = `# ${graphName}

Exported from Viridian Graph Editor.

## Structure

\`\`\`
.claude/
  agents/           # ${agentCount} agent(s)
  skills/           # ${skillCount} skill(s)
${ruleCount > 0 ? `CLAUDE.md             # ${ruleCount} project rule(s)\n` : ''}\
${mcpCount > 0 ? `.mcp.json             # ${mcpCount} MCP server(s)\n` : ''}\
\`\`\`

## Usage

1. Unzip into your project root
2. Start Claude Code in the project directory
3. The agents, skills, and rules will be auto-discovered

## Entry Point

The root agent is \`.claude/agents/${rootSlug}.md\`. You can invoke it with:

\`\`\`
Use the ${rootSlug} agent to <your task>
\`\`\`
`;
  return { path: 'README.md', content };
}

// ─── Main Export Function ───────────────────────────────────────────────

export function exportGraphToClaude(
  graphData: GraphData,
  graphName: string,
): ExportedFile[] {
  const resolved = resolveExecutionGraph(graphData);
  const rootNode = findRootNode(graphData, resolved);
  if (!rootNode) throw new Error('No root agent node found in graph');

  const files: ExportedFile[] = [];
  const slugMap = new Map<string, string>();
  const usedSlugs = new Set<string>();

  // Assign slugs to all nodes
  for (const node of graphData.nodes) {
    const label = (node.data.label as string) || node.type;
    const slug = dedupeSlug(toSlug(label), usedSlugs);
    slugMap.set(node.id, slug);
  }

  // Agent files — one per executable node
  for (const [, res] of resolved) {
    files.push(generateAgentFile(res, slugMap));
  }

  // Skill files — one directory per skill node
  const skillNodes = graphData.nodes.filter(n => n.type === 'skill');
  for (const skill of skillNodes) {
    files.push(generateSkillFile(skill, slugMap.get(skill.id)!));
  }

  // .mcp.json — aggregated MCP servers
  const mcpNodes = graphData.nodes.filter(n => n.type === 'mcp');
  const mcpFile = generateMcpJson(mcpNodes, slugMap);
  if (mcpFile) files.push(mcpFile);

  // CLAUDE.md — aggregated rules
  const ruleNodes = graphData.nodes.filter(n => n.type === 'rule');
  const claudeMd = generateClaudeMd(ruleNodes, graphName);
  if (claudeMd) files.push(claudeMd);

  // README
  const rootSlug = slugMap.get(rootNode.id)!;
  files.push(generateReadme(
    graphName,
    rootSlug,
    resolved.size,
    skillNodes.length,
    mcpNodes.length,
    ruleNodes.length,
  ));

  return files;
}
