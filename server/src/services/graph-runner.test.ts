import { describe, it, expect } from 'vitest';

/**
 * Tests for pure functions from graph-runner.ts.
 *
 * These are re-implemented since they depend on imports with heavy
 * side effects (child_process, fs, claude-sdk).
 */

// ─── Types (mirrored from graph-runner.ts) ──────────────────────────────

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

interface ResolvedNode {
  node: GraphNode;
  skills: GraphNode[];
  mcps: GraphNode[];
  rules: GraphNode[];
  delegates: GraphNode[];
}

interface AgentConfig {
  description: string;
  prompt: string;
  tools?: string[];
  disallowedTools?: string[];
  model?: string;
  permissionMode?: string;
  maxTurns?: number;
}

// ─── Re-implemented pure functions ──────────────────────────────────────

function getEdgeType(edge: GraphEdge): string {
  return (edge.data?.edgeType as string) || 'unknown';
}

function resolveExecutionGraph(graphData: GraphData): Map<string, ResolvedNode> {
  const nodesById = new Map<string, GraphNode>();
  for (const node of graphData.nodes) {
    nodesById.set(node.id, node);
  }

  const resolved = new Map<string, ResolvedNode>();
  const executableTypes = new Set(['agent', 'subagent', 'expert']);

  for (const node of graphData.nodes) {
    if (!executableTypes.has(node.type)) continue;

    const skills: GraphNode[] = [];
    const mcps: GraphNode[] = [];
    const rules: GraphNode[] = [];
    const delegates: GraphNode[] = [];

    for (const edge of graphData.edges) {
      if (edge.source !== node.id) continue;
      const target = nodesById.get(edge.target);
      if (!target) continue;

      const edgeType = getEdgeType(edge);
      switch (edgeType) {
        case 'delegation':
          delegates.push(target);
          break;
        case 'skill-usage':
          skills.push(target);
          break;
        case 'tool-access':
          mcps.push(target);
          break;
        case 'rule-constraint':
          rules.push(target);
          break;
      }
    }

    resolved.set(node.id, { node, skills, mcps, rules, delegates });
  }

  return resolved;
}

function findRootNode(graphData: GraphData, resolved: Map<string, ResolvedNode>): GraphNode | null {
  const delegationTargets = new Set<string>();
  for (const edge of graphData.edges) {
    if (getEdgeType(edge) === 'delegation') {
      delegationTargets.add(edge.target);
    }
  }

  const roots: GraphNode[] = [];
  for (const [nodeId, res] of resolved) {
    if (!delegationTargets.has(nodeId)) {
      roots.push(res.node);
    }
  }

  const agentRoot = roots.find(n => n.type === 'agent');
  return agentRoot || roots[0] || null;
}

function toAgentKey(label: string, usedKeys: Set<string>): string {
  let key = label
    .replace(/[^a-zA-Z0-9\s_-]/g, '')
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join('');

  if (!key) key = 'Agent';

  const base = key;
  let counter = 2;
  while (usedKeys.has(key)) {
    key = `${base}${counter++}`;
  }
  usedKeys.add(key);
  return key;
}

function composeSystemPrompt(
  resolved: ResolvedNode,
  opts?: { skipRules?: boolean; projectPath?: string },
): string {
  const parts: string[] = [];

  if (opts?.projectPath) {
    parts.push(`IMPORTANT: The project you are working on is located at: ${opts.projectPath}\nYou MUST use absolute paths (starting with ${opts.projectPath}) when reading, editing, creating, or searching project files. Do NOT use relative paths.`);
  }

  const ownPrompt = resolved.node.data.systemPrompt as string || '';
  if (ownPrompt) {
    parts.push(ownPrompt);
  }

  if (!opts?.skipRules && resolved.rules.length > 0) {
    const ruleLines = resolved.rules.map(r => {
      const ruleType = (r.data.ruleType as string || 'guideline').toUpperCase();
      const ruleText = r.data.ruleText as string || '';
      return `- [${ruleType}] ${r.data.label || 'Rule'}: ${ruleText}`;
    });
    parts.push(`\n## Rules\n${ruleLines.join('\n')}`);
  }

  if (resolved.skills.length > 0) {
    const skillSections = resolved.skills.map(s => {
      const command = s.data.command as string || '';
      const template = s.data.promptTemplate as string || '';
      const label = s.data.label as string || 'Skill';
      return `### Skill: ${label}\n**Command**: \`${command}\`\n**Instructions**:\n${template}`;
    });
    parts.push(`\n## Available Skills\nWhen executing a task that matches one of these skills, follow the skill's instructions exactly.\n\n${skillSections.join('\n\n')}`);
  }

  return parts.join('\n\n');
}

function appendDelegationInstructions(
  systemPrompt: string,
  agents: Record<string, AgentConfig>,
): string {
  const agentEntries = Object.entries(agents);
  if (agentEntries.length === 0) return systemPrompt;

  const agentList = agentEntries
    .map(([key, config]) => `- **${key}**: ${config.description}`)
    .join('\n');

  const allowedNames = agentEntries.map(([key]) => `"${key}"`).join(', ');

  const delegation = `
## YOU ARE AN ORCHESTRATOR — DELEGATE EVERYTHING

You are a coordinator. You have NO tools except Task. You CANNOT read files, write code, or run commands.
Your ONLY capability is delegating to sub-agents via the Task tool.

### Your Sub-Agents
${agentList}

### How to Delegate
Call the Task tool with:
- \`subagent_type\`: one of ${allowedNames}
- \`prompt\`: detailed instructions for the sub-agent
- \`description\`: short summary (3-5 words)

Example:
\`\`\`json
{"subagent_type": "${agentEntries[0]![0]}", "prompt": "Do X, Y, Z...", "description": "Handle the task"}
\`\`\`

### Rules
1. ONLY use subagent_type values from: ${allowedNames}. No other values are valid.
2. NEVER try to do work directly — you have no tools for it.
3. Delegate to the SINGLE best-matching sub-agent first.
4. After receiving results, synthesize and present the final answer.`;

  return systemPrompt ? `${systemPrompt}\n${delegation}` : delegation.trim();
}

function buildAgentsConfig(
  rootNodeId: string,
  resolvedNodes: Map<string, ResolvedNode>,
  composeOpts?: { skipRules?: boolean; projectPath?: string },
): { agents: Record<string, AgentConfig>; keyToNodeId: Map<string, string> } {
  const agents: Record<string, AgentConfig> = {};
  const keyToNodeId = new Map<string, string>();
  const nodeIdToKey = new Map<string, string>();
  const usedKeys = new Set<string>();
  const visited = new Set<string>();
  const queue = [rootNodeId];

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    if (visited.has(currentId)) continue;
    visited.add(currentId);

    const resolved = resolvedNodes.get(currentId);
    if (!resolved) continue;

    for (const delegate of resolved.delegates) {
      if (nodeIdToKey.has(delegate.id)) continue;

      const delegateResolved = resolvedNodes.get(delegate.id);
      const prompt = composeSystemPrompt(delegateResolved || {
        node: delegate, skills: [], mcps: [], rules: [], delegates: [],
      }, composeOpts);

      const desc = (delegate.data.description as string)
        || (delegate.data.taskDescription as string)
        || (delegate.data.specialty as string)
        || (delegate.data.label as string)
        || delegate.type;

      const label = (delegate.data.label as string) || delegate.type;
      const agentKey = toAgentKey(label, usedKeys);

      let agentPrompt = prompt;
      if (!agentPrompt) {
        const role = label || delegate.type;
        const taskDesc = (delegate.data.taskDescription as string) || '';
        const specialty = (delegate.data.specialty as string) || '';
        const context = taskDesc || specialty || desc;
        agentPrompt = `You are ${role}, a specialized ${delegate.type} agent. Your role: ${context}. Focus exclusively on tasks within your specialty and execute them thoroughly.`;
      }

      const delegateAllowedTools = (delegate.data.allowedTools as string[]) || undefined;
      const defaultLeafTools = ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'TodoWrite', 'WebFetch', 'WebSearch', 'Task'];

      agents[agentKey] = {
        description: desc,
        prompt: agentPrompt,
        tools: delegateAllowedTools || defaultLeafTools,
        model: (delegate.data.model as string) || undefined,
        permissionMode: (delegate.data.permissionMode as string) || 'bypassPermissions',
        maxTurns: (delegate.data.maxTurns as number) || 25,
      };

      keyToNodeId.set(agentKey, delegate.id);
      nodeIdToKey.set(delegate.id, agentKey);

      queue.push(delegate.id);
    }
  }

  // Pass 2: delegation instructions for intermediate orchestrators
  for (const [delegateNodeId, agentKey] of nodeIdToKey) {
    const delegateResolved = resolvedNodes.get(delegateNodeId);
    if (!delegateResolved || delegateResolved.delegates.length === 0) continue;

    const childAgents: Record<string, AgentConfig> = {};
    for (const childDelegate of delegateResolved.delegates) {
      const childKey = nodeIdToKey.get(childDelegate.id);
      if (childKey && agents[childKey]) {
        childAgents[childKey] = agents[childKey];
      }
    }

    if (Object.keys(childAgents).length > 0) {
      agents[agentKey]!.prompt = appendDelegationInstructions(
        agents[agentKey]!.prompt,
        childAgents,
      );
      agents[agentKey]!.tools = ['Task', 'TodoWrite'];
    }
  }

  return { agents, keyToNodeId };
}

// ─── Helper: build graph data quickly ───────────────────────────────────

function makeNode(id: string, type: string, data: Record<string, unknown> = {}): GraphNode {
  return { id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } };
}

function makeEdge(source: string, target: string, edgeType: string): GraphEdge {
  return { id: `e-${source}-${target}`, source, target, data: { edgeType } };
}

// ─── Tests ──────────────────────────────────────────────────────────────

describe('getEdgeType', () => {
  it('returns edgeType from data', () => {
    expect(getEdgeType(makeEdge('a', 'b', 'delegation'))).toBe('delegation');
    expect(getEdgeType(makeEdge('a', 'b', 'skill-usage'))).toBe('skill-usage');
    expect(getEdgeType(makeEdge('a', 'b', 'tool-access'))).toBe('tool-access');
    expect(getEdgeType(makeEdge('a', 'b', 'rule-constraint'))).toBe('rule-constraint');
  });

  it('returns "unknown" when no edgeType in data', () => {
    const edge: GraphEdge = { id: 'e1', source: 'a', target: 'b', data: {} };
    expect(getEdgeType(edge)).toBe('unknown');
  });

  it('returns "unknown" when data is empty object', () => {
    const edge: GraphEdge = { id: 'e1', source: 'a', target: 'b', data: {} };
    expect(getEdgeType(edge)).toBe('unknown');
  });
});

describe('resolveExecutionGraph', () => {
  it('resolves a simple agent → subagent delegation', () => {
    const graphData: GraphData = {
      nodes: [
        makeNode('agent1', 'agent'),
        makeNode('sub1', 'subagent'),
      ],
      edges: [makeEdge('agent1', 'sub1', 'delegation')],
    };

    const resolved = resolveExecutionGraph(graphData);
    expect(resolved.size).toBe(2); // agent and subagent are executable

    const agentRes = resolved.get('agent1')!;
    expect(agentRes.delegates).toHaveLength(1);
    expect(agentRes.delegates[0]!.id).toBe('sub1');
    expect(agentRes.skills).toHaveLength(0);
    expect(agentRes.mcps).toHaveLength(0);
    expect(agentRes.rules).toHaveLength(0);

    const subRes = resolved.get('sub1')!;
    expect(subRes.delegates).toHaveLength(0);
  });

  it('categorizes edges correctly (skill, mcp, rule, delegation)', () => {
    const graphData: GraphData = {
      nodes: [
        makeNode('a', 'agent'),
        makeNode('sub', 'subagent'),
        makeNode('sk', 'skill', { command: '/deploy' }),
        makeNode('mc', 'mcp', { serverType: 'stdio' }),
        makeNode('ru', 'rule', { ruleType: 'deny', ruleText: 'No force push' }),
      ],
      edges: [
        makeEdge('a', 'sub', 'delegation'),
        makeEdge('a', 'sk', 'skill-usage'),
        makeEdge('a', 'mc', 'tool-access'),
        makeEdge('a', 'ru', 'rule-constraint'),
      ],
    };

    const resolved = resolveExecutionGraph(graphData);
    const agentRes = resolved.get('a')!;

    expect(agentRes.delegates).toHaveLength(1);
    expect(agentRes.skills).toHaveLength(1);
    expect(agentRes.mcps).toHaveLength(1);
    expect(agentRes.rules).toHaveLength(1);
  });

  it('only resolves executable types (agent, subagent, expert)', () => {
    const graphData: GraphData = {
      nodes: [
        makeNode('a', 'agent'),
        makeNode('sk', 'skill'),
        makeNode('mc', 'mcp'),
        makeNode('ru', 'rule'),
      ],
      edges: [],
    };

    const resolved = resolveExecutionGraph(graphData);
    expect(resolved.size).toBe(1); // only agent
    expect(resolved.has('a')).toBe(true);
    expect(resolved.has('sk')).toBe(false);
    expect(resolved.has('mc')).toBe(false);
    expect(resolved.has('ru')).toBe(false);
  });

  it('handles edges to nonexistent targets gracefully', () => {
    const graphData: GraphData = {
      nodes: [makeNode('a', 'agent')],
      edges: [makeEdge('a', 'ghost', 'delegation')],
    };

    const resolved = resolveExecutionGraph(graphData);
    const agentRes = resolved.get('a')!;
    expect(agentRes.delegates).toHaveLength(0); // ghost filtered out
  });

  it('handles empty graph', () => {
    const resolved = resolveExecutionGraph({ nodes: [], edges: [] });
    expect(resolved.size).toBe(0);
  });

  it('handles multi-level delegation (agent → subagent → expert)', () => {
    const graphData: GraphData = {
      nodes: [
        makeNode('a', 'agent'),
        makeNode('s', 'subagent'),
        makeNode('e', 'expert'),
        makeNode('sk', 'skill'),
      ],
      edges: [
        makeEdge('a', 's', 'delegation'),
        makeEdge('s', 'e', 'delegation'),
        makeEdge('e', 'sk', 'skill-usage'),
      ],
    };

    const resolved = resolveExecutionGraph(graphData);
    expect(resolved.size).toBe(3); // a, s, e are executable

    expect(resolved.get('a')!.delegates).toHaveLength(1);
    expect(resolved.get('s')!.delegates).toHaveLength(1);
    expect(resolved.get('e')!.delegates).toHaveLength(0);
    expect(resolved.get('e')!.skills).toHaveLength(1);
  });

  it('ignores unknown edge types', () => {
    const graphData: GraphData = {
      nodes: [makeNode('a', 'agent'), makeNode('b', 'subagent')],
      edges: [makeEdge('a', 'b', 'some-custom-type')],
    };

    const resolved = resolveExecutionGraph(graphData);
    const agentRes = resolved.get('a')!;
    expect(agentRes.delegates).toHaveLength(0);
    expect(agentRes.skills).toHaveLength(0);
    expect(agentRes.mcps).toHaveLength(0);
    expect(agentRes.rules).toHaveLength(0);
  });
});

describe('findRootNode', () => {
  it('finds agent as root when it has no incoming delegation', () => {
    const graphData: GraphData = {
      nodes: [makeNode('a', 'agent'), makeNode('s', 'subagent')],
      edges: [makeEdge('a', 's', 'delegation')],
    };
    const resolved = resolveExecutionGraph(graphData);
    const root = findRootNode(graphData, resolved);
    expect(root?.id).toBe('a');
  });

  it('returns null for empty graph', () => {
    const graphData: GraphData = { nodes: [], edges: [] };
    const resolved = resolveExecutionGraph(graphData);
    expect(findRootNode(graphData, resolved)).toBeNull();
  });

  it('prefers agent type over subagent/expert when multiple roots', () => {
    const graphData: GraphData = {
      nodes: [
        makeNode('s', 'subagent'),
        makeNode('a', 'agent'),
        makeNode('e', 'expert'),
      ],
      edges: [],
    };
    const resolved = resolveExecutionGraph(graphData);
    const root = findRootNode(graphData, resolved);
    expect(root?.id).toBe('a');
  });

  it('returns subagent root if no agent exists', () => {
    const graphData: GraphData = {
      nodes: [makeNode('s', 'subagent'), makeNode('e', 'expert')],
      edges: [makeEdge('s', 'e', 'delegation')],
    };
    const resolved = resolveExecutionGraph(graphData);
    const root = findRootNode(graphData, resolved);
    expect(root?.id).toBe('s');
  });

  it('excludes delegation targets from roots', () => {
    const graphData: GraphData = {
      nodes: [
        makeNode('a', 'agent'),
        makeNode('s1', 'subagent'),
        makeNode('s2', 'subagent'),
      ],
      edges: [
        makeEdge('a', 's1', 'delegation'),
        makeEdge('a', 's2', 'delegation'),
      ],
    };
    const resolved = resolveExecutionGraph(graphData);
    const root = findRootNode(graphData, resolved);
    expect(root?.id).toBe('a');
  });

  it('non-delegation edges dont affect root detection', () => {
    const graphData: GraphData = {
      nodes: [
        makeNode('a', 'agent'),
        makeNode('sk', 'skill'),
        makeNode('ru', 'rule'),
      ],
      edges: [
        makeEdge('a', 'sk', 'skill-usage'),
        makeEdge('a', 'ru', 'rule-constraint'),
      ],
    };
    const resolved = resolveExecutionGraph(graphData);
    const root = findRootNode(graphData, resolved);
    expect(root?.id).toBe('a');
  });
});

describe('toAgentKey', () => {
  it('converts simple label to PascalCase', () => {
    const used = new Set<string>();
    expect(toAgentKey('backend developer', used)).toBe('BackendDeveloper');
  });

  it('handles hyphens and underscores as separators', () => {
    const used = new Set<string>();
    expect(toAgentKey('code-reviewer', used)).toBe('CodeReviewer');
    expect(toAgentKey('code_reviewer', used)).toBe('CodeReviewer2'); // second call, deduped
  });

  it('strips special characters', () => {
    const used = new Set<string>();
    expect(toAgentKey('Agent #1 (Beta)', used)).toBe('Agent1Beta');
  });

  it('returns "Agent" for empty/special-only strings', () => {
    const used = new Set<string>();
    expect(toAgentKey('', used)).toBe('Agent');
    expect(toAgentKey('###', new Set())).toBe('Agent');
  });

  it('deduplicates by appending incrementing numbers', () => {
    const used = new Set<string>();
    expect(toAgentKey('Worker', used)).toBe('Worker');
    expect(toAgentKey('Worker', used)).toBe('Worker2');
    expect(toAgentKey('Worker', used)).toBe('Worker3');
  });

  it('adds key to usedKeys set', () => {
    const used = new Set<string>();
    toAgentKey('Test', used);
    expect(used.has('Test')).toBe(true);
  });

  it('handles single-word labels', () => {
    const used = new Set<string>();
    expect(toAgentKey('analyzer', used)).toBe('Analyzer');
  });

  it('handles labels with numbers', () => {
    const used = new Set<string>();
    expect(toAgentKey('agent 3000', used)).toBe('Agent3000');
  });
});

describe('composeSystemPrompt', () => {
  function makeResolved(overrides: Partial<ResolvedNode> = {}): ResolvedNode {
    return {
      node: makeNode('n1', 'agent', { systemPrompt: '' }),
      skills: [],
      mcps: [],
      rules: [],
      delegates: [],
      ...overrides,
    };
  }

  it('returns empty string when no prompt, rules, or skills', () => {
    const result = composeSystemPrompt(makeResolved());
    expect(result).toBe('');
  });

  it('includes system prompt from node data', () => {
    const resolved = makeResolved({
      node: makeNode('n1', 'agent', { systemPrompt: 'You are a helpful assistant.' }),
    });
    const result = composeSystemPrompt(resolved);
    expect(result).toContain('You are a helpful assistant.');
  });

  it('includes project path instruction when provided', () => {
    const result = composeSystemPrompt(makeResolved(), { projectPath: '/home/user/project' });
    expect(result).toContain('/home/user/project');
    expect(result).toContain('absolute paths');
  });

  it('includes rules section', () => {
    const resolved = makeResolved({
      rules: [
        makeNode('r1', 'rule', { ruleType: 'deny', ruleText: 'No force push', label: 'Safety' }),
        makeNode('r2', 'rule', { ruleType: 'guideline', ruleText: 'Use TypeScript', label: 'Code Style' }),
      ],
    });
    const result = composeSystemPrompt(resolved);
    expect(result).toContain('## Rules');
    expect(result).toContain('[DENY] Safety: No force push');
    expect(result).toContain('[GUIDELINE] Code Style: Use TypeScript');
  });

  it('skips rules when opts.skipRules=true', () => {
    const resolved = makeResolved({
      rules: [makeNode('r1', 'rule', { ruleType: 'deny', ruleText: 'No force push' })],
    });
    const result = composeSystemPrompt(resolved, { skipRules: true });
    expect(result).not.toContain('## Rules');
  });

  it('includes skills section with command and template', () => {
    const resolved = makeResolved({
      skills: [
        makeNode('s1', 'skill', { label: 'Deploy', command: '/deploy', promptTemplate: 'Run deployment pipeline.' }),
      ],
    });
    const result = composeSystemPrompt(resolved);
    expect(result).toContain('## Available Skills');
    expect(result).toContain('### Skill: Deploy');
    expect(result).toContain('`/deploy`');
    expect(result).toContain('Run deployment pipeline.');
  });

  it('combines all sections with double newlines', () => {
    const resolved = makeResolved({
      node: makeNode('n1', 'agent', { systemPrompt: 'Base prompt.' }),
      rules: [makeNode('r1', 'rule', { ruleType: 'guideline', ruleText: 'Be concise' })],
      skills: [makeNode('s1', 'skill', { label: 'Lint', command: '/lint', promptTemplate: 'Check code.' })],
    });
    const result = composeSystemPrompt(resolved, { projectPath: '/proj' });
    // All four sections should be present
    expect(result).toContain('/proj');
    expect(result).toContain('Base prompt.');
    expect(result).toContain('## Rules');
    expect(result).toContain('## Available Skills');
  });

  it('defaults ruleType to GUIDELINE when missing', () => {
    const resolved = makeResolved({
      rules: [makeNode('r1', 'rule', { ruleText: 'Some rule' })],
    });
    const result = composeSystemPrompt(resolved);
    expect(result).toContain('[GUIDELINE]');
  });
});

describe('appendDelegationInstructions', () => {
  const testAgents: Record<string, AgentConfig> = {
    BackendDev: { description: 'Handles backend code', prompt: 'Backend prompt' },
    FrontendDev: { description: 'Handles frontend code', prompt: 'Frontend prompt' },
  };

  it('appends orchestrator instructions with agent list', () => {
    const result = appendDelegationInstructions('Base prompt.', testAgents);
    expect(result).toContain('Base prompt.');
    expect(result).toContain('YOU ARE AN ORCHESTRATOR');
    expect(result).toContain('**BackendDev**: Handles backend code');
    expect(result).toContain('**FrontendDev**: Handles frontend code');
  });

  it('includes allowed subagent_type names', () => {
    const result = appendDelegationInstructions('', testAgents);
    expect(result).toContain('"BackendDev"');
    expect(result).toContain('"FrontendDev"');
  });

  it('includes Task tool usage example', () => {
    const result = appendDelegationInstructions('', testAgents);
    expect(result).toContain('subagent_type');
    expect(result).toContain('"BackendDev"'); // example uses first agent
  });

  it('returns original prompt unchanged when no agents', () => {
    const result = appendDelegationInstructions('Original prompt.', {});
    expect(result).toBe('Original prompt.');
  });

  it('trims delegation text when systemPrompt is empty', () => {
    const result = appendDelegationInstructions('', testAgents);
    expect(result).not.toMatch(/^\n/); // should be trimmed
    expect(result).toContain('YOU ARE AN ORCHESTRATOR');
  });

  it('contains explicit orchestrator rules', () => {
    const result = appendDelegationInstructions('', testAgents);
    expect(result).toContain('NEVER try to do work directly');
    expect(result).toContain('you have no tools');
    expect(result).toContain('Delegate to the SINGLE best-matching sub-agent');
  });
});

describe('buildAgentsConfig', () => {
  it('builds config for a single delegate', () => {
    const resolvedNodes = new Map<string, ResolvedNode>();
    resolvedNodes.set('root', {
      node: makeNode('root', 'agent', { systemPrompt: 'Root prompt' }),
      skills: [],
      mcps: [],
      rules: [],
      delegates: [makeNode('sub1', 'subagent', { label: 'Worker', description: 'Does stuff', systemPrompt: 'Work hard' })],
    });
    resolvedNodes.set('sub1', {
      node: makeNode('sub1', 'subagent', { label: 'Worker', description: 'Does stuff', systemPrompt: 'Work hard' }),
      skills: [],
      mcps: [],
      rules: [],
      delegates: [],
    });

    const { agents, keyToNodeId } = buildAgentsConfig('root', resolvedNodes);

    expect(Object.keys(agents)).toHaveLength(1);
    expect(agents['Worker']).toBeDefined();
    expect(agents['Worker']!.description).toBe('Does stuff');
    expect(agents['Worker']!.prompt).toContain('Work hard');
    expect(keyToNodeId.get('Worker')).toBe('sub1');
  });

  it('assigns default tools for leaf agents', () => {
    const resolvedNodes = new Map<string, ResolvedNode>();
    resolvedNodes.set('root', {
      node: makeNode('root', 'agent'),
      skills: [], mcps: [], rules: [],
      delegates: [makeNode('sub1', 'subagent', { label: 'Dev' })],
    });
    resolvedNodes.set('sub1', {
      node: makeNode('sub1', 'subagent', { label: 'Dev' }),
      skills: [], mcps: [], rules: [], delegates: [],
    });

    const { agents } = buildAgentsConfig('root', resolvedNodes);
    expect(agents['Dev']!.tools).toContain('Bash');
    expect(agents['Dev']!.tools).toContain('Read');
    expect(agents['Dev']!.tools).toContain('Write');
    expect(agents['Dev']!.tools).toContain('Task');
  });

  it('restricts intermediate orchestrator tools to Task + TodoWrite', () => {
    const resolvedNodes = new Map<string, ResolvedNode>();
    const expert = makeNode('exp', 'expert', { label: 'Expert', systemPrompt: 'I am expert' });

    resolvedNodes.set('root', {
      node: makeNode('root', 'agent'),
      skills: [], mcps: [], rules: [],
      delegates: [makeNode('mid', 'subagent', { label: 'Middle', systemPrompt: 'I orchestrate' })],
    });
    resolvedNodes.set('mid', {
      node: makeNode('mid', 'subagent', { label: 'Middle', systemPrompt: 'I orchestrate' }),
      skills: [], mcps: [], rules: [],
      delegates: [expert],
    });
    resolvedNodes.set('exp', {
      node: expert,
      skills: [], mcps: [], rules: [], delegates: [],
    });

    const { agents } = buildAgentsConfig('root', resolvedNodes);

    // Middle is an intermediate orchestrator
    expect(agents['Middle']!.tools).toEqual(['Task', 'TodoWrite']);
    // Expert is a leaf
    expect(agents['Expert']!.tools).toContain('Bash');
  });

  it('deduplicates agent keys when labels collide', () => {
    const resolvedNodes = new Map<string, ResolvedNode>();
    resolvedNodes.set('root', {
      node: makeNode('root', 'agent'),
      skills: [], mcps: [], rules: [],
      delegates: [
        makeNode('s1', 'subagent', { label: 'Worker' }),
        makeNode('s2', 'subagent', { label: 'Worker' }),
      ],
    });
    resolvedNodes.set('s1', {
      node: makeNode('s1', 'subagent', { label: 'Worker' }),
      skills: [], mcps: [], rules: [], delegates: [],
    });
    resolvedNodes.set('s2', {
      node: makeNode('s2', 'subagent', { label: 'Worker' }),
      skills: [], mcps: [], rules: [], delegates: [],
    });

    const { agents, keyToNodeId } = buildAgentsConfig('root', resolvedNodes);
    expect(Object.keys(agents)).toHaveLength(2);
    expect(agents['Worker']).toBeDefined();
    expect(agents['Worker2']).toBeDefined();
    expect(keyToNodeId.get('Worker')).toBe('s1');
    expect(keyToNodeId.get('Worker2')).toBe('s2');
  });

  it('generates fallback prompt when systemPrompt is empty', () => {
    const resolvedNodes = new Map<string, ResolvedNode>();
    resolvedNodes.set('root', {
      node: makeNode('root', 'agent'),
      skills: [], mcps: [], rules: [],
      delegates: [makeNode('sub1', 'subagent', { label: 'Analyst', taskDescription: 'Analyze data' })],
    });
    resolvedNodes.set('sub1', {
      node: makeNode('sub1', 'subagent', { label: 'Analyst', taskDescription: 'Analyze data' }),
      skills: [], mcps: [], rules: [], delegates: [],
    });

    const { agents } = buildAgentsConfig('root', resolvedNodes);
    expect(agents['Analyst']!.prompt).toContain('You are Analyst');
    expect(agents['Analyst']!.prompt).toContain('specialized');
    expect(agents['Analyst']!.prompt).toContain('Analyze data');
  });

  it('uses custom allowedTools when specified', () => {
    const resolvedNodes = new Map<string, ResolvedNode>();
    resolvedNodes.set('root', {
      node: makeNode('root', 'agent'),
      skills: [], mcps: [], rules: [],
      delegates: [makeNode('s1', 'subagent', { label: 'Read Only', allowedTools: ['Read', 'Grep', 'Glob'] })],
    });
    resolvedNodes.set('s1', {
      node: makeNode('s1', 'subagent', { label: 'Read Only', allowedTools: ['Read', 'Grep', 'Glob'] }),
      skills: [], mcps: [], rules: [], delegates: [],
    });

    const { agents } = buildAgentsConfig('root', resolvedNodes);
    expect(agents['ReadOnly']!.tools).toEqual(['Read', 'Grep', 'Glob']);
  });

  it('defaults permissionMode to bypassPermissions', () => {
    const resolvedNodes = new Map<string, ResolvedNode>();
    resolvedNodes.set('root', {
      node: makeNode('root', 'agent'),
      skills: [], mcps: [], rules: [],
      delegates: [makeNode('s1', 'subagent', { label: 'Dev' })],
    });
    resolvedNodes.set('s1', {
      node: makeNode('s1', 'subagent', { label: 'Dev' }),
      skills: [], mcps: [], rules: [], delegates: [],
    });

    const { agents } = buildAgentsConfig('root', resolvedNodes);
    expect(agents['Dev']!.permissionMode).toBe('bypassPermissions');
  });

  it('defaults maxTurns to 25', () => {
    const resolvedNodes = new Map<string, ResolvedNode>();
    resolvedNodes.set('root', {
      node: makeNode('root', 'agent'),
      skills: [], mcps: [], rules: [],
      delegates: [makeNode('s1', 'subagent', { label: 'Dev' })],
    });
    resolvedNodes.set('s1', {
      node: makeNode('s1', 'subagent', { label: 'Dev' }),
      skills: [], mcps: [], rules: [], delegates: [],
    });

    const { agents } = buildAgentsConfig('root', resolvedNodes);
    expect(agents['Dev']!.maxTurns).toBe(25);
  });

  it('handles no delegates (returns empty agents)', () => {
    const resolvedNodes = new Map<string, ResolvedNode>();
    resolvedNodes.set('root', {
      node: makeNode('root', 'agent'),
      skills: [], mcps: [], rules: [], delegates: [],
    });

    const { agents } = buildAgentsConfig('root', resolvedNodes);
    expect(Object.keys(agents)).toHaveLength(0);
  });

  it('composes skills into delegate prompt', () => {
    const skill = makeNode('sk', 'skill', { label: 'Deploy', command: '/deploy', promptTemplate: 'Run CI/CD' });
    const resolvedNodes = new Map<string, ResolvedNode>();

    resolvedNodes.set('root', {
      node: makeNode('root', 'agent'),
      skills: [], mcps: [], rules: [],
      delegates: [makeNode('s1', 'subagent', { label: 'Dev Ops', systemPrompt: 'Manage infra' })],
    });
    resolvedNodes.set('s1', {
      node: makeNode('s1', 'subagent', { label: 'Dev Ops', systemPrompt: 'Manage infra' }),
      skills: [skill], mcps: [], rules: [], delegates: [],
    });

    const { agents } = buildAgentsConfig('root', resolvedNodes);
    expect(agents['DevOps']!.prompt).toContain('Manage infra');
    expect(agents['DevOps']!.prompt).toContain('Deploy');
    expect(agents['DevOps']!.prompt).toContain('/deploy');
    expect(agents['DevOps']!.prompt).toContain('Run CI/CD');
  });
});

describe('integration: full graph pipeline', () => {
  it('resolves, finds root, and builds agents for a 3-tier graph', () => {
    // agent → 2 subagents, one subagent → expert
    const graphData: GraphData = {
      nodes: [
        makeNode('a', 'agent', { label: 'Orchestrator', systemPrompt: 'Coordinate all' }),
        makeNode('s1', 'subagent', { label: 'Frontend', systemPrompt: 'Build UI', description: 'UI dev' }),
        makeNode('s2', 'subagent', { label: 'Backend', systemPrompt: 'Build API', description: 'API dev' }),
        makeNode('e1', 'expert', { label: 'DB Expert', systemPrompt: 'Optimize queries', description: 'Database specialist', specialty: 'PostgreSQL' }),
        makeNode('sk1', 'skill', { label: 'Lint', command: '/lint', promptTemplate: 'Run linter' }),
        makeNode('r1', 'rule', { ruleType: 'deny', ruleText: 'No eval()', label: 'Security' }),
      ],
      edges: [
        makeEdge('a', 's1', 'delegation'),
        makeEdge('a', 's2', 'delegation'),
        makeEdge('s2', 'e1', 'delegation'),
        makeEdge('s1', 'sk1', 'skill-usage'),
        makeEdge('a', 'r1', 'rule-constraint'),
      ],
    };

    // 1. Resolve
    const resolved = resolveExecutionGraph(graphData);
    expect(resolved.size).toBe(4); // a, s1, s2, e1

    // 2. Find root
    const root = findRootNode(graphData, resolved);
    expect(root?.id).toBe('a');

    // 3. Build agents config
    const { agents, keyToNodeId } = buildAgentsConfig('a', resolved);

    // Should have 3 agents: Frontend, Backend, DbExpert
    expect(Object.keys(agents)).toHaveLength(3);
    expect(agents['Frontend']).toBeDefined();
    expect(agents['Backend']).toBeDefined();
    expect(agents['DbExpert']).toBeDefined();

    // Backend is an intermediate orchestrator (delegates to expert)
    expect(agents['Backend']!.tools).toEqual(['Task', 'TodoWrite']);
    expect(agents['Backend']!.prompt).toContain('ORCHESTRATOR');

    // Frontend is a leaf (has skill, but no delegates)
    expect(agents['Frontend']!.tools).toContain('Bash');
    // Frontend prompt should include the Lint skill
    expect(agents['Frontend']!.prompt).toContain('Lint');
    expect(agents['Frontend']!.prompt).toContain('/lint');

    // DB Expert is a leaf
    expect(agents['DbExpert']!.tools).toContain('Bash');
    expect(agents['DbExpert']!.prompt).toContain('Optimize queries');

    // Key mappings
    expect(keyToNodeId.get('Frontend')).toBe('s1');
    expect(keyToNodeId.get('Backend')).toBe('s2');
    expect(keyToNodeId.get('DbExpert')).toBe('e1');
  });
});
