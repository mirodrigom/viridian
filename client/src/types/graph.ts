// ─── Node Types ─────────────────────────────────────────────────────────
export type GraphNodeType = 'agent' | 'subagent' | 'expert' | 'skill' | 'mcp' | 'rule';

// ─── Port Definitions ───────────────────────────────────────────────────
export type PortType = 'delegation' | 'skill' | 'tool' | 'rule' | 'data';

export interface PortDefinition {
  id: string;
  type: PortType;
  position: 'top' | 'bottom' | 'left' | 'right';
  label: string;
  maxConnections?: number;
}

// ─── Node Data (stored in VueFlow node.data) ────────────────────────────
export interface BaseNodeData {
  nodeType: GraphNodeType;
  label: string;
  description?: string;
}

export interface AgentNodeData extends BaseNodeData {
  nodeType: 'agent';
  model: string;
  systemPrompt: string;
  permissionMode: string;
  maxTokens: number;
  allowedTools: string[];
  disallowedTools: string[];
}

export interface SubagentNodeData extends BaseNodeData {
  nodeType: 'subagent';
  model: string;
  systemPrompt: string;
  permissionMode: string;
  taskDescription: string;
}

export interface ExpertNodeData extends BaseNodeData {
  nodeType: 'expert';
  model: string;
  systemPrompt: string;
  specialty: string;
}

export interface SkillNodeData extends BaseNodeData {
  nodeType: 'skill';
  command: string;
  promptTemplate: string;
  allowedTools: string[];
}

export interface McpNodeData extends BaseNodeData {
  nodeType: 'mcp';
  serverType: 'stdio' | 'sse' | 'http';
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
  tools?: string[];
}

export interface RuleNodeData extends BaseNodeData {
  nodeType: 'rule';
  ruleType: 'allow' | 'deny' | 'guideline' | 'constraint';
  ruleText: string;
  scope: 'global' | 'project';
}

export type NodeData =
  | AgentNodeData
  | SubagentNodeData
  | ExpertNodeData
  | SkillNodeData
  | McpNodeData
  | RuleNodeData;

// ─── Edge Data ──────────────────────────────────────────────────────────
export type EdgeType = 'delegation' | 'skill-usage' | 'tool-access' | 'rule-constraint' | 'data-flow';

export interface GraphEdgeData {
  edgeType: EdgeType;
  label?: string;
  animated?: boolean;
}

// ─── Graph Configuration (persistence) ──────────────────────────────────
export interface GraphConfig {
  id: string;
  name: string;
  description?: string;
  projectPath: string;
  nodes: SerializedNode[];
  edges: SerializedEdge[];
  viewport?: { x: number; y: number; zoom: number };
  createdAt: string;
  updatedAt: string;
}

export interface SerializedNode {
  id: string;
  type: GraphNodeType;
  position: { x: number; y: number };
  data: NodeData;
}

export interface SerializedEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  data: GraphEdgeData;
}

/** Portable graph export format for JSON files.
 * Human-readable: no UUIDs, no positions, no handles.
 * Connections reference nodes by label. */
export interface ExportedNode {
  type: GraphNodeType;
  label: string;
  description?: string;
  // Agent / Subagent / Expert fields
  model?: string;
  systemPrompt?: string;
  permissionMode?: string;
  maxTokens?: number;
  allowedTools?: string[];
  disallowedTools?: string[];
  taskDescription?: string;
  specialty?: string;
  // Skill fields
  command?: string;
  promptTemplate?: string;
  // MCP fields
  serverType?: 'stdio' | 'sse' | 'http';
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
  tools?: string[];
  // Rule fields
  ruleType?: 'allow' | 'deny' | 'guideline' | 'constraint';
  ruleText?: string;
  scope?: 'global' | 'project';
}

export interface ExportedConnection {
  from: string;
  to: string;
  type: EdgeType;
}

export interface GraphExportData {
  formatVersion: 1;
  name: string;
  description?: string;
  exportedAt: string;
  nodes: ExportedNode[];
  connections: ExportedConnection[];
}

// ─── Edge styling config ────────────────────────────────────────────────
export const EDGE_STYLES: Record<EdgeType, { color: string; animated: boolean; strokeWidth: number }> = {
  'delegation':      { color: 'var(--primary)',     animated: true,  strokeWidth: 2.5 },
  'skill-usage':     { color: 'var(--chart-5)',     animated: false, strokeWidth: 1.5 },
  'tool-access':     { color: 'var(--chart-4)',     animated: false, strokeWidth: 1.5 },
  'rule-constraint': { color: 'var(--destructive)', animated: false, strokeWidth: 1.5 },
  'data-flow':       { color: 'var(--chart-2)',     animated: true,  strokeWidth: 2 },
};

// ─── Node visual config ─────────────────────────────────────────────────
export const NODE_CONFIG: Record<GraphNodeType, {
  label: string;
  description: string;
  accentClass: string;
  accentVar: string;
}> = {
  agent:    { label: 'Agent',    description: 'Main orchestrator agent',       accentClass: 'text-primary border-primary/50 bg-primary/5',    accentVar: 'var(--primary)' },
  subagent: { label: 'Subagent', description: 'Delegated worker agent',        accentClass: 'text-chart-2 border-chart-2/50 bg-chart-2/5',    accentVar: 'var(--chart-2)' },
  expert:   { label: 'Expert',   description: 'Deep specialist agent',         accentClass: 'text-chart-3 border-chart-3/50 bg-chart-3/5',    accentVar: 'var(--chart-3)' },
  skill:    { label: 'Skill',    description: 'Reusable prompt/capability',    accentClass: 'text-chart-5 border-chart-5/50 bg-chart-5/5',    accentVar: 'var(--chart-5)' },
  mcp:      { label: 'MCP',      description: 'External MCP tool server',      accentClass: 'text-chart-4 border-chart-4/50 bg-chart-4/5',    accentVar: 'var(--chart-4)' },
  rule:     { label: 'Rule',     description: 'Behavioral constraint/policy',  accentClass: 'text-destructive border-destructive/50 bg-destructive/5', accentVar: 'var(--destructive)' },
};

// ─── Connection rules ───────────────────────────────────────────────────
export const CONNECTION_RULES: Record<GraphNodeType, { targets: GraphNodeType[]; edgeType: EdgeType }[]> = {
  agent: [
    { targets: ['subagent', 'expert'], edgeType: 'delegation' },
    { targets: ['skill'],    edgeType: 'skill-usage' },
    { targets: ['mcp'],      edgeType: 'tool-access' },
    { targets: ['rule'],     edgeType: 'rule-constraint' },
    { targets: ['agent'],    edgeType: 'data-flow' },
  ],
  subagent: [
    { targets: ['expert'], edgeType: 'delegation' },
    { targets: ['skill'],  edgeType: 'skill-usage' },
    { targets: ['mcp'],    edgeType: 'tool-access' },
    { targets: ['rule'],   edgeType: 'rule-constraint' },
  ],
  expert: [
    { targets: ['skill'], edgeType: 'skill-usage' },
    { targets: ['mcp'],   edgeType: 'tool-access' },
    { targets: ['rule'],  edgeType: 'rule-constraint' },
  ],
  skill: [],
  mcp: [],
  rule: [],
};
