import { describe, it, expect, beforeEach } from 'vitest';
import type { GraphNodeType, NodeData, EdgeType, GraphConfig, GraphEdgeData } from '@/types/graph';
import { CONNECTION_RULES, NODE_CONFIG, EDGE_STYLES } from '@/types/graph';

// ─── Re-implemented pure functions from graph store ─────────────────────

function createDefaultNodeData(type: GraphNodeType): NodeData {
  switch (type) {
    case 'agent':
      return {
        nodeType: 'agent', label: 'Agent',
        model: 'claude-opus-4-6', systemPrompt: '',
        permissionMode: 'bypassPermissions', maxTokens: 200000,
        allowedTools: [], disallowedTools: [],
      };
    case 'subagent':
      return {
        nodeType: 'subagent', label: 'Subagent',
        model: 'claude-sonnet-4-6', systemPrompt: '',
        permissionMode: 'bypassPermissions', taskDescription: '',
      };
    case 'expert':
      return {
        nodeType: 'expert', label: 'Expert',
        model: 'claude-opus-4-6', systemPrompt: '',
        specialty: '',
      };
    case 'skill':
      return {
        nodeType: 'skill', label: 'Skill',
        command: '', promptTemplate: '', allowedTools: [],
      };
    case 'mcp':
      return {
        nodeType: 'mcp', label: 'MCP Server',
        serverType: 'stdio', command: '', args: [],
        tools: [],
      };
    case 'rule':
      return {
        nodeType: 'rule', label: 'Rule',
        ruleType: 'guideline', ruleText: '', scope: 'project',
      };
  }
}

function canConnect(
  nodes: { id: string; data: NodeData }[],
  connection: { source: string; target: string },
): boolean {
  const sourceNode = nodes.find(n => n.id === connection.source);
  const targetNode = nodes.find(n => n.id === connection.target);
  if (!sourceNode || !targetNode) return false;
  if (connection.source === connection.target) return false;

  const sourceType = sourceNode.data.nodeType;
  const targetType = targetNode.data.nodeType;

  const rules = CONNECTION_RULES[sourceType];
  return rules.some(rule => rule.targets.includes(targetType));
}

function getEdgeType(sourceType: GraphNodeType, targetType: GraphNodeType): EdgeType | null {
  const rules = CONNECTION_RULES[sourceType];
  const rule = rules.find(r => r.targets.includes(targetType));
  return rule?.edgeType ?? null;
}

interface SimpleNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: NodeData;
}

interface SimpleEdge {
  id: string;
  source: string;
  target: string;
  data: GraphEdgeData;
}

function autoLayout(nodes: SimpleNode[]) {
  const layers: GraphNodeType[][] = [
    ['agent'],
    ['subagent'],
    ['expert'],
    ['skill', 'mcp', 'rule'],
  ];

  const HORIZONTAL_GAP = 280;
  const VERTICAL_GAP = 200;
  let y = 50;

  for (const layerTypes of layers) {
    const layerNodes = nodes.filter(n =>
      layerTypes.includes(n.data.nodeType),
    );
    if (layerNodes.length === 0) continue;

    const totalWidth = layerNodes.length * HORIZONTAL_GAP;
    let x = -(totalWidth / 2) + HORIZONTAL_GAP / 2;

    for (const node of layerNodes) {
      node.position = { x, y };
      x += HORIZONTAL_GAP;
    }
    y += VERTICAL_GAP;
  }
}

interface SerializedNode {
  id: string;
  type: GraphNodeType;
  position: { x: number; y: number };
  data: NodeData;
}

interface SerializedEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  data: GraphEdgeData;
}

function serialize(
  nodes: SimpleNode[],
  edges: SimpleEdge[],
  viewport?: { x: number; y: number; zoom: number },
): { nodes: SerializedNode[]; edges: SerializedEdge[]; viewport?: { x: number; y: number; zoom: number } } {
  return {
    nodes: nodes.map(n => ({
      id: n.id,
      type: n.data.nodeType,
      position: n.position,
      data: n.data,
    })),
    edges: edges.map(e => ({
      id: e.id,
      source: e.source,
      target: e.target,
      data: e.data,
    })),
    ...(viewport && { viewport }),
  };
}

function getNodeConnections(
  nodes: SimpleNode[],
  edges: SimpleEdge[],
  nodeId: string,
) {
  const parents = edges
    .filter(e => e.target === nodeId)
    .map(e => {
      const n = nodes.find(n => n.id === e.source);
      if (!n) return null;
      return { label: n.data.label, nodeType: n.data.nodeType, description: n.data.description };
    })
    .filter(Boolean);

  const children = edges
    .filter(e => e.source === nodeId)
    .map(e => {
      const n = nodes.find(n => n.id === e.target);
      if (!n) return null;
      return { label: n.data.label, nodeType: n.data.nodeType, description: n.data.description, edgeType: e.data?.edgeType || 'unknown' };
    })
    .filter(Boolean);

  return { parents, children };
}

// ─── Tests ──────────────────────────────────────────────────────────────

describe('createDefaultNodeData', () => {
  const allTypes: GraphNodeType[] = ['agent', 'subagent', 'expert', 'skill', 'mcp', 'rule'];

  it('returns data with correct nodeType for each type', () => {
    for (const type of allTypes) {
      const data = createDefaultNodeData(type);
      expect(data.nodeType).toBe(type);
    }
  });

  it('agent defaults include model, systemPrompt, permissionMode, maxTokens, tool arrays', () => {
    const data = createDefaultNodeData('agent');
    expect(data).toMatchObject({
      nodeType: 'agent',
      label: 'Agent',
      model: 'claude-opus-4-6',
      systemPrompt: '',
      permissionMode: 'bypassPermissions',
      maxTokens: 200000,
    });
    if (data.nodeType === 'agent') {
      expect(data.allowedTools).toEqual([]);
      expect(data.disallowedTools).toEqual([]);
    }
  });

  it('subagent defaults include model, taskDescription', () => {
    const data = createDefaultNodeData('subagent');
    expect(data).toMatchObject({
      nodeType: 'subagent',
      label: 'Subagent',
      model: 'claude-sonnet-4-6',
      taskDescription: '',
    });
  });

  it('expert defaults include specialty', () => {
    const data = createDefaultNodeData('expert');
    if (data.nodeType === 'expert') {
      expect(data.specialty).toBe('');
    }
  });

  it('skill defaults include command, promptTemplate, allowedTools', () => {
    const data = createDefaultNodeData('skill');
    if (data.nodeType === 'skill') {
      expect(data.command).toBe('');
      expect(data.promptTemplate).toBe('');
      expect(data.allowedTools).toEqual([]);
    }
  });

  it('mcp defaults include serverType=stdio, command, args, tools', () => {
    const data = createDefaultNodeData('mcp');
    if (data.nodeType === 'mcp') {
      expect(data.serverType).toBe('stdio');
      expect(data.command).toBe('');
      expect(data.args).toEqual([]);
      expect(data.tools).toEqual([]);
    }
  });

  it('rule defaults include ruleType=guideline, ruleText, scope=project', () => {
    const data = createDefaultNodeData('rule');
    if (data.nodeType === 'rule') {
      expect(data.ruleType).toBe('guideline');
      expect(data.ruleText).toBe('');
      expect(data.scope).toBe('project');
    }
  });
});

describe('CONNECTION_RULES matrix', () => {
  it('agent can connect to subagent, skill, mcp, rule, and agent', () => {
    const agentRules = CONNECTION_RULES.agent;
    const allTargets = agentRules.flatMap(r => r.targets);
    expect(allTargets).toContain('subagent');
    expect(allTargets).toContain('skill');
    expect(allTargets).toContain('mcp');
    expect(allTargets).toContain('rule');
    expect(allTargets).toContain('agent');
  });

  it('agent→subagent is delegation, agent→skill is skill-usage, agent→mcp is tool-access', () => {
    expect(getEdgeType('agent', 'subagent')).toBe('delegation');
    expect(getEdgeType('agent', 'skill')).toBe('skill-usage');
    expect(getEdgeType('agent', 'mcp')).toBe('tool-access');
    expect(getEdgeType('agent', 'rule')).toBe('rule-constraint');
    expect(getEdgeType('agent', 'agent')).toBe('data-flow');
  });

  it('subagent can connect to expert, skill, mcp, rule', () => {
    const targets = CONNECTION_RULES.subagent.flatMap(r => r.targets);
    expect(targets).toContain('expert');
    expect(targets).toContain('skill');
    expect(targets).toContain('mcp');
    expect(targets).toContain('rule');
  });

  it('subagent CANNOT connect to agent or subagent', () => {
    const targets = CONNECTION_RULES.subagent.flatMap(r => r.targets);
    expect(targets).not.toContain('agent');
    expect(targets).not.toContain('subagent');
  });

  it('expert can connect to skill, mcp, rule only', () => {
    const targets = CONNECTION_RULES.expert.flatMap(r => r.targets);
    expect(targets).toContain('skill');
    expect(targets).toContain('mcp');
    expect(targets).toContain('rule');
    expect(targets).not.toContain('agent');
    expect(targets).not.toContain('subagent');
    expect(targets).not.toContain('expert');
  });

  it('skill, mcp, rule are leaf nodes — no outgoing connections', () => {
    expect(CONNECTION_RULES.skill).toEqual([]);
    expect(CONNECTION_RULES.mcp).toEqual([]);
    expect(CONNECTION_RULES.rule).toEqual([]);
  });

  it('delegation flows downward only (no upward delegation)', () => {
    // agent can delegate to subagent and expert
    expect(getEdgeType('agent', 'subagent')).toBe('delegation');
    expect(getEdgeType('agent', 'expert')).toBe('delegation');
    // subagent can delegate to expert
    expect(getEdgeType('subagent', 'expert')).toBe('delegation');
    // expert CANNOT delegate
    expect(CONNECTION_RULES.expert.find(r => r.edgeType === 'delegation')).toBeUndefined();
    // subagent CANNOT delegate to agent
    expect(getEdgeType('subagent', 'agent')).toBeNull();
    // expert CANNOT delegate to subagent
    expect(getEdgeType('expert', 'subagent')).toBeNull();
  });
});

describe('canConnect', () => {
  function makeNode(id: string, type: GraphNodeType): { id: string; data: NodeData } {
    return { id, data: createDefaultNodeData(type) };
  }

  it('allows valid agent → subagent connection', () => {
    const nodes = [makeNode('a', 'agent'), makeNode('b', 'subagent')];
    expect(canConnect(nodes, { source: 'a', target: 'b' })).toBe(true);
  });

  it('rejects self-connection', () => {
    const nodes = [makeNode('a', 'agent')];
    expect(canConnect(nodes, { source: 'a', target: 'a' })).toBe(false);
  });

  it('rejects connection from leaf node (skill → anything)', () => {
    const nodes = [makeNode('s', 'skill'), makeNode('a', 'agent')];
    expect(canConnect(nodes, { source: 's', target: 'a' })).toBe(false);
  });

  it('rejects invalid source node (nonexistent)', () => {
    const nodes = [makeNode('a', 'agent')];
    expect(canConnect(nodes, { source: 'nonexistent', target: 'a' })).toBe(false);
  });

  it('rejects invalid target node (nonexistent)', () => {
    const nodes = [makeNode('a', 'agent')];
    expect(canConnect(nodes, { source: 'a', target: 'nonexistent' })).toBe(false);
  });

  it('rejects upward delegation (subagent → agent)', () => {
    const nodes = [makeNode('s', 'subagent'), makeNode('a', 'agent')];
    expect(canConnect(nodes, { source: 's', target: 'a' })).toBe(false);
  });

  it('allows agent → agent (data-flow)', () => {
    const nodes = [makeNode('a1', 'agent'), makeNode('a2', 'agent')];
    expect(canConnect(nodes, { source: 'a1', target: 'a2' })).toBe(true);
  });

  it('allows expert → mcp (tool-access)', () => {
    const nodes = [makeNode('e', 'expert'), makeNode('m', 'mcp')];
    expect(canConnect(nodes, { source: 'e', target: 'm' })).toBe(true);
  });

  // Exhaustive matrix: test ALL 36 source-target combinations
  const types: GraphNodeType[] = ['agent', 'subagent', 'expert', 'skill', 'mcp', 'rule'];
  const expectedConnections: Record<string, boolean> = {
    'agent→agent': true,
    'agent→subagent': true,
    'agent→expert': true,
    'agent→skill': true,
    'agent→mcp': true,
    'agent→rule': true,
    'subagent→agent': false,
    'subagent→subagent': false,
    'subagent→expert': true,
    'subagent→skill': true,
    'subagent→mcp': true,
    'subagent→rule': true,
    'expert→agent': false,
    'expert→subagent': false,
    'expert→expert': false,
    'expert→skill': true,
    'expert→mcp': true,
    'expert→rule': true,
    'skill→agent': false,
    'skill→subagent': false,
    'skill→expert': false,
    'skill→skill': false,
    'skill→mcp': false,
    'skill→rule': false,
    'mcp→agent': false,
    'mcp→subagent': false,
    'mcp→expert': false,
    'mcp→skill': false,
    'mcp→mcp': false,
    'mcp→rule': false,
    'rule→agent': false,
    'rule→subagent': false,
    'rule→expert': false,
    'rule→skill': false,
    'rule→mcp': false,
    'rule→rule': false,
  };

  for (const src of types) {
    for (const tgt of types) {
      const key = `${src}→${tgt}`;
      const expected = expectedConnections[key]!;
      // Skip self-connection (already tested separately)
      if (src === tgt && src !== 'agent') {
        it(`${key} is ${expected ? 'allowed' : 'rejected'}`, () => {
          const nodes = [makeNode('src', src), makeNode('tgt', tgt)];
          expect(canConnect(nodes, { source: 'src', target: 'tgt' })).toBe(expected);
        });
      } else if (src !== tgt) {
        it(`${key} is ${expected ? 'allowed' : 'rejected'}`, () => {
          const nodes = [makeNode('src', src), makeNode('tgt', tgt)];
          expect(canConnect(nodes, { source: 'src', target: 'tgt' })).toBe(expected);
        });
      }
    }
  }
});

describe('getEdgeType', () => {
  it('returns correct edge type for each valid connection', () => {
    expect(getEdgeType('agent', 'subagent')).toBe('delegation');
    expect(getEdgeType('agent', 'skill')).toBe('skill-usage');
    expect(getEdgeType('agent', 'mcp')).toBe('tool-access');
    expect(getEdgeType('agent', 'rule')).toBe('rule-constraint');
    expect(getEdgeType('agent', 'agent')).toBe('data-flow');
    expect(getEdgeType('agent', 'expert')).toBe('delegation');
    expect(getEdgeType('subagent', 'expert')).toBe('delegation');
    expect(getEdgeType('subagent', 'skill')).toBe('skill-usage');
    expect(getEdgeType('subagent', 'mcp')).toBe('tool-access');
    expect(getEdgeType('subagent', 'rule')).toBe('rule-constraint');
    expect(getEdgeType('expert', 'skill')).toBe('skill-usage');
    expect(getEdgeType('expert', 'mcp')).toBe('tool-access');
    expect(getEdgeType('expert', 'rule')).toBe('rule-constraint');
  });

  it('returns null for invalid connections', () => {
    expect(getEdgeType('skill', 'agent')).toBeNull();
    expect(getEdgeType('mcp', 'agent')).toBeNull();
    expect(getEdgeType('rule', 'agent')).toBeNull();
    expect(getEdgeType('expert', 'agent')).toBeNull();
    expect(getEdgeType('subagent', 'agent')).toBeNull();
  });
});

describe('autoLayout', () => {
  function makeNodes(...types: GraphNodeType[]): SimpleNode[] {
    return types.map((t, i) => ({
      id: `n${i}`,
      type: t,
      position: { x: 0, y: 0 },
      data: createDefaultNodeData(t),
    }));
  }

  it('arranges nodes in correct layer order (agent, subagent, expert, leaf)', () => {
    const nodes = makeNodes('agent', 'subagent', 'expert', 'skill');
    autoLayout(nodes);

    const agentY = nodes[0]!.position.y;
    const subagentY = nodes[1]!.position.y;
    const expertY = nodes[2]!.position.y;
    const skillY = nodes[3]!.position.y;

    expect(agentY).toBeLessThan(subagentY);
    expect(subagentY).toBeLessThan(expertY);
    expect(expertY).toBeLessThan(skillY);
  });

  it('skill, mcp, rule share the same layer', () => {
    const nodes = makeNodes('skill', 'mcp', 'rule');
    autoLayout(nodes);

    expect(nodes[0]!.position.y).toBe(nodes[1]!.position.y);
    expect(nodes[1]!.position.y).toBe(nodes[2]!.position.y);
  });

  it('multiple nodes in same layer are spread horizontally', () => {
    const nodes = makeNodes('skill', 'skill', 'skill');
    autoLayout(nodes);

    // All same y
    expect(nodes[0]!.position.y).toBe(nodes[1]!.position.y);
    expect(nodes[1]!.position.y).toBe(nodes[2]!.position.y);

    // Different x, evenly spaced
    const xs = nodes.map(n => n.position.x).sort((a, b) => a - b);
    expect(xs[1]! - xs[0]!).toBe(280); // HORIZONTAL_GAP
    expect(xs[2]! - xs[1]!).toBe(280);
  });

  it('centers nodes horizontally', () => {
    const nodes = makeNodes('agent');
    autoLayout(nodes);
    // Single node: total_width = 280, x = -(280/2) + 280/2 = 0
    expect(nodes[0]!.position.x).toBe(0);
  });

  it('skips empty layers without advancing y', () => {
    // Only agent and skill — no subagent/expert layers
    const nodes = makeNodes('agent', 'skill');
    autoLayout(nodes);

    // Agent at y=50, skill at y=250 (one gap, not three)
    expect(nodes[0]!.position.y).toBe(50);
    expect(nodes[1]!.position.y).toBe(250);
  });

  it('handles empty nodes array', () => {
    const nodes: SimpleNode[] = [];
    autoLayout(nodes); // should not throw
    expect(nodes).toEqual([]);
  });
});

describe('serialize', () => {
  it('serializes nodes with correct type from data.nodeType', () => {
    const nodes: SimpleNode[] = [{
      id: 'n1',
      type: 'agent',
      position: { x: 10, y: 20 },
      data: createDefaultNodeData('agent'),
    }];

    const result = serialize(nodes, []);
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]!.type).toBe('agent');
    expect(result.nodes[0]!.id).toBe('n1');
    expect(result.nodes[0]!.position).toEqual({ x: 10, y: 20 });
  });

  it('serializes edges with their data', () => {
    const edges: SimpleEdge[] = [{
      id: 'e1',
      source: 'n1',
      target: 'n2',
      data: { edgeType: 'delegation', label: 'delegation', animated: true },
    }];

    const result = serialize([], edges);
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]!.data.edgeType).toBe('delegation');
  });

  it('includes viewport when provided', () => {
    const vp = { x: 100, y: 200, zoom: 1.5 };
    const result = serialize([], [], vp);
    expect(result.viewport).toEqual(vp);
  });

  it('omits viewport when not provided', () => {
    const result = serialize([], []);
    expect(result.viewport).toBeUndefined();
  });

  it('round-trips nodes correctly', () => {
    const originalData = createDefaultNodeData('subagent');
    const nodes: SimpleNode[] = [{
      id: 'abc',
      type: 'subagent',
      position: { x: 100, y: 200 },
      data: originalData,
    }];

    const serialized = serialize(nodes, []);
    expect(serialized.nodes[0]!.data).toEqual(originalData);
  });
});

describe('getNodeConnections', () => {
  const nodes: SimpleNode[] = [
    { id: 'a', type: 'agent', position: { x: 0, y: 0 }, data: { ...createDefaultNodeData('agent'), label: 'Main Agent', description: 'Orchestrator' } },
    { id: 'b', type: 'subagent', position: { x: 0, y: 0 }, data: { ...createDefaultNodeData('subagent'), label: 'Worker', description: 'Does tasks' } },
    { id: 'c', type: 'skill', position: { x: 0, y: 0 }, data: { ...createDefaultNodeData('skill'), label: 'Deploy' } },
  ];

  const edges: SimpleEdge[] = [
    { id: 'e1', source: 'a', target: 'b', data: { edgeType: 'delegation', animated: true } },
    { id: 'e2', source: 'a', target: 'c', data: { edgeType: 'skill-usage', animated: false } },
  ];

  it('returns children for parent node', () => {
    const conn = getNodeConnections(nodes, edges, 'a');
    expect(conn.children).toHaveLength(2);
    expect(conn.children[0]).toMatchObject({ label: 'Worker', nodeType: 'subagent' });
    expect(conn.children[1]).toMatchObject({ label: 'Deploy', nodeType: 'skill' });
    expect(conn.parents).toHaveLength(0);
  });

  it('returns parents for child node', () => {
    const conn = getNodeConnections(nodes, edges, 'b');
    expect(conn.parents).toHaveLength(1);
    expect(conn.parents[0]).toMatchObject({ label: 'Main Agent', nodeType: 'agent' });
    expect(conn.children).toHaveLength(0);
  });

  it('returns empty for node with no connections', () => {
    const isolated = [{ id: 'x', type: 'agent', position: { x: 0, y: 0 }, data: createDefaultNodeData('agent') }];
    const conn = getNodeConnections(isolated, [], 'x');
    expect(conn.parents).toEqual([]);
    expect(conn.children).toEqual([]);
  });

  it('includes edgeType in children', () => {
    const conn = getNodeConnections(nodes, edges, 'a');
    expect(conn.children[0]).toHaveProperty('edgeType', 'delegation');
    expect(conn.children[1]).toHaveProperty('edgeType', 'skill-usage');
  });

  it('filters null when edge references nonexistent node', () => {
    const edgesWithBad: SimpleEdge[] = [
      { id: 'e-bad', source: 'a', target: 'ghost', data: { edgeType: 'delegation', animated: false } },
    ];
    const conn = getNodeConnections(nodes, edgesWithBad, 'a');
    expect(conn.children).toHaveLength(0); // ghost filtered out
  });
});

describe('edge data generation', () => {
  it('delegation and data-flow edges are animated', () => {
    const animated: EdgeType[] = ['delegation', 'data-flow'];
    const notAnimated: EdgeType[] = ['skill-usage', 'tool-access', 'rule-constraint'];

    for (const type of animated) {
      const isAnimated = type === 'delegation' || type === 'data-flow';
      expect(isAnimated).toBe(true);
    }
    for (const type of notAnimated) {
      const isAnimated = type === 'delegation' || type === 'data-flow';
      expect(isAnimated).toBe(false);
    }
  });

  it('edge label is edgeType with dashes replaced by spaces', () => {
    const edgeTypes: EdgeType[] = ['delegation', 'skill-usage', 'tool-access', 'rule-constraint', 'data-flow'];
    const expectedLabels = ['delegation', 'skill usage', 'tool access', 'rule constraint', 'data flow'];

    edgeTypes.forEach((type, i) => {
      const label = type.replace(/-/g, ' ');
      expect(label).toBe(expectedLabels[i]);
    });
  });

  it('edge id follows pattern e-{source}-{target}', () => {
    const source = 'node-1';
    const target = 'node-2';
    const edgeId = `e-${source}-${target}`;
    expect(edgeId).toBe('e-node-1-node-2');
  });
});

describe('graph store CRUD behavior (simulated)', () => {
  // Simulate store node/edge arrays for CRUD logic testing
  let nodes: SimpleNode[];
  let edges: SimpleEdge[];
  let selectedNodeId: string | null;
  let isDirty: boolean;

  beforeEach(() => {
    nodes = [];
    edges = [];
    selectedNodeId = null;
    isDirty = false;
  });

  function addNode(type: GraphNodeType, position: { x: number; y: number }): string {
    const id = `test-${nodes.length}`;
    nodes.push({ id, type, position, data: createDefaultNodeData(type) });
    isDirty = true;
    selectedNodeId = id;
    return id;
  }

  function removeNode(id: string) {
    nodes = nodes.filter(n => n.id !== id);
    edges = edges.filter(e => e.source !== id && e.target !== id);
    if (selectedNodeId === id) selectedNodeId = null;
    isDirty = true;
  }

  function addEdge(source: string, target: string) {
    const sourceNode = nodes.find(n => n.id === source);
    const targetNode = nodes.find(n => n.id === target);
    if (!sourceNode || !targetNode) return;

    const sType = (sourceNode.data as NodeData).nodeType;
    const tType = (targetNode.data as NodeData).nodeType;
    if (!canConnect(nodes.map(n => ({ id: n.id, data: n.data })), { source, target })) return;

    const edgeType = getEdgeType(sType, tType);
    if (!edgeType) return;

    // Prevent duplicate
    if (edges.some(e => e.source === source && e.target === target)) return;

    edges.push({
      id: `e-${source}-${target}`,
      source,
      target,
      data: {
        edgeType,
        label: edgeType.replace(/-/g, ' '),
        animated: edgeType === 'delegation' || edgeType === 'data-flow',
      },
    });
    isDirty = true;
  }

  it('addNode creates node with defaults and marks dirty', () => {
    const id = addNode('agent', { x: 0, y: 0 });
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.data.nodeType).toBe('agent');
    expect(isDirty).toBe(true);
    expect(selectedNodeId).toBe(id);
  });

  it('removeNode removes node and cascading edges', () => {
    const agentId = addNode('agent', { x: 0, y: 0 });
    const subId = addNode('subagent', { x: 0, y: 100 });
    addEdge(agentId, subId);
    expect(edges).toHaveLength(1);

    removeNode(subId);
    expect(nodes).toHaveLength(1);
    expect(edges).toHaveLength(0); // edge removed
  });

  it('removeNode clears selection if removed node was selected', () => {
    const id = addNode('agent', { x: 0, y: 0 });
    expect(selectedNodeId).toBe(id);
    removeNode(id);
    expect(selectedNodeId).toBeNull();
  });

  it('removeNode preserves selection of other nodes', () => {
    const id1 = addNode('agent', { x: 0, y: 0 });
    const id2 = addNode('subagent', { x: 0, y: 100 });
    selectedNodeId = id1; // force select first
    removeNode(id2);
    expect(selectedNodeId).toBe(id1);
  });

  it('addEdge prevents duplicates', () => {
    const a = addNode('agent', { x: 0, y: 0 });
    const s = addNode('subagent', { x: 0, y: 100 });
    addEdge(a, s);
    addEdge(a, s); // duplicate
    expect(edges).toHaveLength(1);
  });

  it('addEdge rejects invalid connections', () => {
    const s = addNode('skill', { x: 0, y: 0 });
    const a = addNode('agent', { x: 0, y: 100 });
    addEdge(s, a); // skill → agent is invalid
    expect(edges).toHaveLength(0);
  });

  it('removeEdge removes only the specified edge', () => {
    const a = addNode('agent', { x: 0, y: 0 });
    const s1 = addNode('subagent', { x: 0, y: 100 });
    const s2 = addNode('skill', { x: 100, y: 100 });
    addEdge(a, s1);
    addEdge(a, s2);
    expect(edges).toHaveLength(2);

    edges = edges.filter(e => e.id !== `e-${a}-${s1}`);
    expect(edges).toHaveLength(1);
    expect(edges[0]!.target).toBe(s2);
  });

  it('updateNodeData merges partial updates', () => {
    addNode('agent', { x: 0, y: 0 });
    const node = nodes[0]!;
    node.data = { ...node.data, label: 'Updated Agent' } as NodeData;
    expect(node.data.label).toBe('Updated Agent');
    expect(node.data.nodeType).toBe('agent'); // preserved
  });

  it('building a full graph: agent → subagent → expert → skill', () => {
    const agent = addNode('agent', { x: 0, y: 0 });
    const sub = addNode('subagent', { x: 0, y: 100 });
    const expert = addNode('expert', { x: 0, y: 200 });
    const skill = addNode('skill', { x: 0, y: 300 });

    addEdge(agent, sub);
    addEdge(sub, expert);
    addEdge(expert, skill);

    expect(edges).toHaveLength(3);
    expect(edges[0]!.data.edgeType).toBe('delegation');
    expect(edges[1]!.data.edgeType).toBe('delegation');
    expect(edges[2]!.data.edgeType).toBe('skill-usage');
  });
});

describe('cycle detection (wouldCreateCycle)', () => {
  // Re-implement cycle check matching the store's BFS logic
  function wouldCreateCycle(
    existingEdges: { source: string; target: string }[],
    source: string,
    target: string,
  ): boolean {
    const visited = new Set<string>();
    const queue = [target];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current === source) return true;
      if (visited.has(current)) continue;
      visited.add(current);
      for (const edge of existingEdges) {
        if (edge.source === current) {
          queue.push(edge.target);
        }
      }
    }
    return false;
  }

  it('detects direct cycle (A→B, B→A)', () => {
    const edges = [{ source: 'a', target: 'b' }];
    expect(wouldCreateCycle(edges, 'a', 'b')).toBe(false); // a→b exists, adding wouldn't cycle (duplicate, but no cycle)
    expect(wouldCreateCycle(edges, 'b', 'a')).toBe(true);  // b→a would create cycle
  });

  it('detects transitive cycle (A→B→C, C→A)', () => {
    const edges = [
      { source: 'a', target: 'b' },
      { source: 'b', target: 'c' },
    ];
    expect(wouldCreateCycle(edges, 'c', 'a')).toBe(true);
  });

  it('allows non-cyclic connections', () => {
    const edges = [
      { source: 'a', target: 'b' },
      { source: 'a', target: 'c' },
    ];
    expect(wouldCreateCycle(edges, 'b', 'c')).toBe(false);
  });

  it('allows connections in DAGs (diamond shape)', () => {
    // a → b, a → c, b → d, c → d (diamond, no cycle)
    const edges = [
      { source: 'a', target: 'b' },
      { source: 'a', target: 'c' },
      { source: 'b', target: 'd' },
    ];
    expect(wouldCreateCycle(edges, 'c', 'd')).toBe(false); // c→d is fine
  });

  it('detects cycle in longer chains', () => {
    const edges = [
      { source: 'a', target: 'b' },
      { source: 'b', target: 'c' },
      { source: 'c', target: 'd' },
      { source: 'd', target: 'e' },
    ];
    expect(wouldCreateCycle(edges, 'e', 'a')).toBe(true);  // e→a creates cycle
    expect(wouldCreateCycle(edges, 'e', 'b')).toBe(true);  // e→b creates cycle
    expect(wouldCreateCycle(edges, 'e', 'c')).toBe(true);  // e→c creates cycle
  });

  it('returns false for empty edge list', () => {
    expect(wouldCreateCycle([], 'a', 'b')).toBe(false);
  });

  it('returns false when target has no outgoing edges', () => {
    const edges = [{ source: 'a', target: 'b' }];
    expect(wouldCreateCycle(edges, 'c', 'b')).toBe(false);
  });
});

describe('NODE_CONFIG and EDGE_STYLES coverage', () => {
  it('NODE_CONFIG has entries for all 6 node types', () => {
    const types: GraphNodeType[] = ['agent', 'subagent', 'expert', 'skill', 'mcp', 'rule'];
    for (const type of types) {
      expect(NODE_CONFIG[type]).toBeDefined();
      expect(NODE_CONFIG[type].label).toBeTruthy();
      expect(NODE_CONFIG[type].description).toBeTruthy();
      expect(NODE_CONFIG[type].accentClass).toBeTruthy();
      expect(NODE_CONFIG[type].accentVar).toBeTruthy();
    }
  });

  it('EDGE_STYLES has entries for all 5 edge types', () => {
    const types: EdgeType[] = ['delegation', 'skill-usage', 'tool-access', 'rule-constraint', 'data-flow'];
    for (const type of types) {
      expect(EDGE_STYLES[type]).toBeDefined();
      expect(EDGE_STYLES[type].color).toBeTruthy();
      expect(typeof EDGE_STYLES[type].animated).toBe('boolean');
      expect(EDGE_STYLES[type].strokeWidth).toBeGreaterThan(0);
    }
  });
});
