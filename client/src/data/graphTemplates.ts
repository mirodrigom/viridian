import type { SerializedNode, SerializedEdge, GraphEdgeData } from '@/types/graph';

export interface GraphTemplate {
  id: string;
  name: string;
  description: string;
  category: 'development' | 'analysis' | 'automation';
  nodes: SerializedNode[];
  edges: SerializedEdge[];
}

// ─── Helper: create edge with proper handles & data ───────────────────────
function edge(
  source: string,
  target: string,
  type: GraphEdgeData['edgeType'],
): SerializedEdge {
  return {
    id: `e-${source}-${target}`,
    source,
    target,
    sourceHandle: `${type}-out`,
    targetHandle: `${type}-in`,
    data: {
      edgeType: type,
      label: type.replace(/-/g, ' '),
      animated: type === 'delegation' || type === 'data-flow',
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  TEMPLATE 1 — Full-Stack Dev Team
// ═══════════════════════════════════════════════════════════════════════════

const fullStackNodes: SerializedNode[] = [
  // ── Central Agent ──
  {
    id: 'agent-main',
    type: 'agent',
    position: { x: 0, y: 0 },
    data: {
      nodeType: 'agent', label: 'Agent',
      model: 'claude-opus-4-6', systemPrompt: '',
      permissionMode: 'bypassPermissions', maxTokens: 200000,
      allowedTools: [], disallowedTools: [],
    },
  },

  // ── Subagent: Infrastructure ──
  {
    id: 'sub-infra',
    type: 'subagent',
    position: { x: -500, y: -400 },
    data: {
      nodeType: 'subagent', label: 'Subagent Infrastructure',
      model: 'claude-sonnet-4-5-20250929', systemPrompt: '',
      permissionMode: 'bypassPermissions',
      taskDescription: 'Handle infrastructure, CI/CD, Docker, deployment configs',
    },
  },
  {
    id: 'exp-cli',
    type: 'expert',
    position: { x: -700, y: -550 },
    data: { nodeType: 'expert', label: 'Expert CLI', model: 'claude-sonnet-4-5-20250929', systemPrompt: '', specialty: 'CLI tools and shell scripting' },
  },
  {
    id: 'exp-devops-infra',
    type: 'expert',
    position: { x: -500, y: -580 },
    data: { nodeType: 'expert', label: 'Expert DevOps', model: 'claude-sonnet-4-5-20250929', systemPrompt: '', specialty: 'DevOps practices and tooling' },
  },
  {
    id: 'skill-cicd',
    type: 'skill',
    position: { x: -780, y: -420 },
    data: { nodeType: 'skill', label: 'Skill CI/CD', command: '', promptTemplate: '', allowedTools: [] },
  },
  {
    id: 'skill-deploy',
    type: 'skill',
    position: { x: -700, y: -340 },
    data: { nodeType: 'skill', label: 'Skill Deploy', command: '', promptTemplate: '', allowedTools: [] },
  },

  // ── Subagent: Frontend ──
  {
    id: 'sub-frontend',
    type: 'subagent',
    position: { x: -550, y: -100 },
    data: {
      nodeType: 'subagent', label: 'Subagent Frontend',
      model: 'claude-sonnet-4-5-20250929', systemPrompt: '',
      permissionMode: 'bypassPermissions',
      taskDescription: 'Handle frontend development: Vue/React components, styling, accessibility',
    },
  },
  {
    id: 'exp-vuejs',
    type: 'expert',
    position: { x: -800, y: -200 },
    data: { nodeType: 'expert', label: 'Expert Vue/JS', model: 'claude-sonnet-4-5-20250929', systemPrompt: '', specialty: 'Vue.js and JavaScript/TypeScript' },
  },
  {
    id: 'exp-a11y',
    type: 'expert',
    position: { x: -750, y: -70 },
    data: { nodeType: 'expert', label: 'Expert Accessibility', model: 'claude-sonnet-4-5-20250929', systemPrompt: '', specialty: 'Web accessibility (WCAG, ARIA)' },
  },
  {
    id: 'skill-components',
    type: 'skill',
    position: { x: -850, y: -290 },
    data: { nodeType: 'skill', label: 'Skill Building Components', command: '', promptTemplate: '', allowedTools: [] },
  },
  {
    id: 'skill-lint',
    type: 'skill',
    position: { x: -850, y: -130 },
    data: { nodeType: 'skill', label: 'Skill Linting', command: '', promptTemplate: '', allowedTools: [] },
  },

  // ── Subagent: Backend ──
  {
    id: 'sub-backend',
    type: 'subagent',
    position: { x: -500, y: 200 },
    data: {
      nodeType: 'subagent', label: 'Subagent Backend',
      model: 'claude-sonnet-4-5-20250929', systemPrompt: '',
      permissionMode: 'bypassPermissions',
      taskDescription: 'Handle backend development: APIs, databases, server logic',
    },
  },
  {
    id: 'exp-db',
    type: 'expert',
    position: { x: -800, y: 130 },
    data: { nodeType: 'expert', label: 'Expert Database', model: 'claude-sonnet-4-5-20250929', systemPrompt: '', specialty: 'Database design and SQL' },
  },
  {
    id: 'exp-ts-node',
    type: 'expert',
    position: { x: -800, y: 230 },
    data: { nodeType: 'expert', label: 'Expert TypeScript/Node.js', model: 'claude-sonnet-4-5-20250929', systemPrompt: '', specialty: 'TypeScript and Node.js backend' },
  },
  {
    id: 'exp-api',
    type: 'expert',
    position: { x: -750, y: 330 },
    data: { nodeType: 'expert', label: 'Expert API', model: 'claude-sonnet-4-5-20250929', systemPrompt: '', specialty: 'REST/GraphQL API design' },
  },
  {
    id: 'skill-migrate',
    type: 'skill',
    position: { x: -850, y: 380 },
    data: { nodeType: 'skill', label: 'Skill Migrate', command: '', promptTemplate: '', allowedTools: [] },
  },
  {
    id: 'skill-test-backend',
    type: 'skill',
    position: { x: -700, y: 420 },
    data: { nodeType: 'skill', label: 'Skill Test', command: '', promptTemplate: '', allowedTools: [] },
  },

  // ── Subagent: Documentation ──
  {
    id: 'sub-docs',
    type: 'subagent',
    position: { x: -200, y: 400 },
    data: {
      nodeType: 'subagent', label: 'Subagent Documentation',
      model: 'claude-sonnet-4-5-20250929', systemPrompt: '',
      permissionMode: 'bypassPermissions',
      taskDescription: 'Handle documentation: READMEs, API docs, guides',
    },
  },
  {
    id: 'exp-mdx',
    type: 'expert',
    position: { x: -350, y: 550 },
    data: { nodeType: 'expert', label: 'Expert MDX/Docs', model: 'claude-sonnet-4-5-20250929', systemPrompt: '', specialty: 'MDX and documentation writing' },
  },
  {
    id: 'exp-openapi',
    type: 'expert',
    position: { x: -100, y: 570 },
    data: { nodeType: 'expert', label: 'Expert Design/OpenAPI', model: 'claude-sonnet-4-5-20250929', systemPrompt: '', specialty: 'OpenAPI spec and API documentation' },
  },
  {
    id: 'skill-gen-docs',
    type: 'skill',
    position: { x: -250, y: 620 },
    data: { nodeType: 'skill', label: 'Skill Generate Docs', command: '', promptTemplate: '', allowedTools: [] },
  },

  // ── Subagent: Conventions ──
  {
    id: 'sub-conventions',
    type: 'subagent',
    position: { x: 150, y: 400 },
    data: {
      nodeType: 'subagent', label: 'Subagent Conventions',
      model: 'claude-sonnet-4-5-20250929', systemPrompt: '',
      permissionMode: 'bypassPermissions',
      taskDescription: 'Enforce coding conventions, naming standards, and best practices',
    },
  },
  {
    id: 'exp-naming',
    type: 'expert',
    position: { x: 100, y: 560 },
    data: { nodeType: 'expert', label: 'Expert Naming', model: 'claude-sonnet-4-5-20250929', systemPrompt: '', specialty: 'Naming conventions and code style' },
  },
  {
    id: 'skill-trade-issues',
    type: 'skill',
    position: { x: 250, y: 570 },
    data: { nodeType: 'skill', label: 'Skill Trade Issues', command: '', promptTemplate: '', allowedTools: [] },
  },

  // ── Subagent: GitHub ──
  {
    id: 'sub-github',
    type: 'subagent',
    position: { x: 500, y: 300 },
    data: {
      nodeType: 'subagent', label: 'Subagent GitHub',
      model: 'claude-sonnet-4-5-20250929', systemPrompt: '',
      permissionMode: 'bypassPermissions',
      taskDescription: 'Manage GitHub workflows: PRs, issues, branches, reviews',
    },
  },
  {
    id: 'exp-branches',
    type: 'expert',
    position: { x: 500, y: 480 },
    data: { nodeType: 'expert', label: 'Expert Branches', model: 'claude-sonnet-4-5-20250929', systemPrompt: '', specialty: 'Git branching strategies' },
  },
  {
    id: 'exp-prs',
    type: 'expert',
    position: { x: 700, y: 450 },
    data: { nodeType: 'expert', label: 'Expert Pull Requests', model: 'claude-sonnet-4-5-20250929', systemPrompt: '', specialty: 'PR review and management' },
  },
  {
    id: 'skill-pull-requests',
    type: 'skill',
    position: { x: 400, y: 550 },
    data: { nodeType: 'skill', label: 'Skill Pull Requests', command: '', promptTemplate: '', allowedTools: [] },
  },
  {
    id: 'skill-create-issues',
    type: 'skill',
    position: { x: 600, y: 550 },
    data: { nodeType: 'skill', label: 'Skill Create Issues', command: '', promptTemplate: '', allowedTools: [] },
  },
  {
    id: 'skill-create-pull-request',
    type: 'skill',
    position: { x: 780, y: 520 },
    data: { nodeType: 'skill', label: 'Skill Create Pull Request', command: '', promptTemplate: '', allowedTools: [] },
  },

  // ── Subagent: QA ──
  {
    id: 'sub-qa',
    type: 'subagent',
    position: { x: 550, y: -100 },
    data: {
      nodeType: 'subagent', label: 'Subagent QA',
      model: 'claude-sonnet-4-5-20250929', systemPrompt: '',
      permissionMode: 'bypassPermissions',
      taskDescription: 'Quality assurance: testing, integration tests, E2E tests',
    },
  },
  {
    id: 'exp-integration',
    type: 'expert',
    position: { x: 750, y: -200 },
    data: { nodeType: 'expert', label: 'Expert Integration', model: 'claude-sonnet-4-5-20250929', systemPrompt: '', specialty: 'Integration testing' },
  },
  {
    id: 'exp-sanity',
    type: 'expert',
    position: { x: 800, y: -80 },
    data: { nodeType: 'expert', label: 'Expert Sanity', model: 'claude-sonnet-4-5-20250929', systemPrompt: '', specialty: 'Sanity and smoke testing' },
  },
  {
    id: 'skill-gen-tests',
    type: 'skill',
    position: { x: 800, y: -280 },
    data: { nodeType: 'skill', label: 'Skill Generate Tests', command: '', promptTemplate: '', allowedTools: [] },
  },
  {
    id: 'skill-playwright',
    type: 'skill',
    position: { x: 900, y: -150 },
    data: { nodeType: 'skill', label: 'Skill Playwright', command: '', promptTemplate: '', allowedTools: [] },
  },

  // ── Subagent: DEV-OPS ──
  {
    id: 'sub-devops',
    type: 'subagent',
    position: { x: 400, y: -400 },
    data: {
      nodeType: 'subagent', label: 'Subagent DEV-OPS',
      model: 'claude-sonnet-4-5-20250929', systemPrompt: '',
      permissionMode: 'bypassPermissions',
      taskDescription: 'DevOps: CI/CD pipelines, deployment, monitoring',
    },
  },
  {
    id: 'exp-devops-main',
    type: 'expert',
    position: { x: 350, y: -570 },
    data: { nodeType: 'expert', label: 'Expert DevOps', model: 'claude-sonnet-4-5-20250929', systemPrompt: '', specialty: 'DevOps engineering and automation' },
  },
  {
    id: 'skill-cicd-devops',
    type: 'skill',
    position: { x: 550, y: -560 },
    data: { nodeType: 'skill', label: 'Skill CI/CD', command: '', promptTemplate: '', allowedTools: [] },
  },
  {
    id: 'skill-deploy-devops',
    type: 'skill',
    position: { x: 500, y: -490 },
    data: { nodeType: 'skill', label: 'Skill Deploy', command: '', promptTemplate: '', allowedTools: [] },
  },

  // ── Subagent: Region/Integration ──
  {
    id: 'sub-region',
    type: 'subagent',
    position: { x: 550, y: -350 },
    data: {
      nodeType: 'subagent', label: 'Subagent Region/Integration',
      model: 'claude-sonnet-4-5-20250929', systemPrompt: '',
      permissionMode: 'bypassPermissions',
      taskDescription: 'Handle region-specific integrations and external services',
    },
  },
  {
    id: 'mcp-region-1',
    type: 'mcp',
    position: { x: 700, y: -450 },
    data: { nodeType: 'mcp', label: 'MCP', serverType: 'stdio', command: '', args: [], tools: [] },
  },
  {
    id: 'mcp-region-2',
    type: 'mcp',
    position: { x: 800, y: -400 },
    data: { nodeType: 'mcp', label: 'MCP', serverType: 'stdio', command: '', args: [], tools: [] },
  },
  {
    id: 'exp-integrations',
    type: 'expert',
    position: { x: 780, y: -300 },
    data: { nodeType: 'expert', label: 'Expert Integrations', model: 'claude-sonnet-4-5-20250929', systemPrompt: '', specialty: 'External service integrations' },
  },
];

const fullStackEdges: SerializedEdge[] = [
  // Agent → Subagents (delegation)
  edge('agent-main', 'sub-infra', 'delegation'),
  edge('agent-main', 'sub-frontend', 'delegation'),
  edge('agent-main', 'sub-backend', 'delegation'),
  edge('agent-main', 'sub-docs', 'delegation'),
  edge('agent-main', 'sub-conventions', 'delegation'),
  edge('agent-main', 'sub-github', 'delegation'),
  edge('agent-main', 'sub-qa', 'delegation'),
  edge('agent-main', 'sub-devops', 'delegation'),
  edge('agent-main', 'sub-region', 'delegation'),

  // Infrastructure → Experts & Skills
  edge('sub-infra', 'exp-cli', 'delegation'),
  edge('sub-infra', 'exp-devops-infra', 'delegation'),
  edge('sub-infra', 'skill-cicd', 'skill-usage'),
  edge('sub-infra', 'skill-deploy', 'skill-usage'),

  // Frontend → Experts & Skills
  edge('sub-frontend', 'exp-vuejs', 'delegation'),
  edge('sub-frontend', 'exp-a11y', 'delegation'),
  edge('sub-frontend', 'skill-components', 'skill-usage'),
  edge('sub-frontend', 'skill-lint', 'skill-usage'),

  // Backend → Experts & Skills
  edge('sub-backend', 'exp-db', 'delegation'),
  edge('sub-backend', 'exp-ts-node', 'delegation'),
  edge('sub-backend', 'exp-api', 'delegation'),
  edge('sub-backend', 'skill-migrate', 'skill-usage'),
  edge('sub-backend', 'skill-test-backend', 'skill-usage'),

  // Documentation → Experts & Skills
  edge('sub-docs', 'exp-mdx', 'delegation'),
  edge('sub-docs', 'exp-openapi', 'delegation'),
  edge('sub-docs', 'skill-gen-docs', 'skill-usage'),

  // Conventions → Experts & Skills
  edge('sub-conventions', 'exp-naming', 'delegation'),
  edge('sub-conventions', 'skill-trade-issues', 'skill-usage'),

  // GitHub → Experts & Skills
  edge('sub-github', 'exp-branches', 'delegation'),
  edge('sub-github', 'exp-prs', 'delegation'),
  edge('sub-github', 'skill-pull-requests', 'skill-usage'),
  edge('sub-github', 'skill-create-issues', 'skill-usage'),
  edge('sub-github', 'skill-create-pull-request', 'skill-usage'),

  // QA → Experts & Skills
  edge('sub-qa', 'exp-integration', 'delegation'),
  edge('sub-qa', 'exp-sanity', 'delegation'),
  edge('sub-qa', 'skill-gen-tests', 'skill-usage'),
  edge('sub-qa', 'skill-playwright', 'skill-usage'),

  // DEV-OPS → Experts & Skills
  edge('sub-devops', 'exp-devops-main', 'delegation'),
  edge('sub-devops', 'skill-cicd-devops', 'skill-usage'),
  edge('sub-devops', 'skill-deploy-devops', 'skill-usage'),

  // Region/Integration → MCP & Expert
  edge('sub-region', 'mcp-region-1', 'tool-access'),
  edge('sub-region', 'mcp-region-2', 'tool-access'),
  edge('sub-region', 'exp-integrations', 'delegation'),
];

// ═══════════════════════════════════════════════════════════════════════════
//  TEMPLATE 2 — Code Review Pipeline
// ═══════════════════════════════════════════════════════════════════════════

const codeReviewNodes: SerializedNode[] = [
  {
    id: 'agent-reviewer',
    type: 'agent',
    position: { x: 0, y: 0 },
    data: {
      nodeType: 'agent', label: 'Code Review Agent',
      model: 'claude-opus-4-6', systemPrompt: '',
      permissionMode: 'bypassPermissions', maxTokens: 200000,
      allowedTools: [], disallowedTools: [],
    },
  },
  {
    id: 'sub-review',
    type: 'subagent',
    position: { x: 0, y: 200 },
    data: {
      nodeType: 'subagent', label: 'Subagent Review',
      model: 'claude-sonnet-4-5-20250929', systemPrompt: '',
      permissionMode: 'bypassPermissions',
      taskDescription: 'Perform comprehensive code review across multiple dimensions',
    },
  },
  {
    id: 'exp-security',
    type: 'expert',
    position: { x: -300, y: 400 },
    data: { nodeType: 'expert', label: 'Expert Security', model: 'claude-opus-4-6', systemPrompt: '', specialty: 'Security vulnerabilities and OWASP' },
  },
  {
    id: 'exp-perf',
    type: 'expert',
    position: { x: 0, y: 400 },
    data: { nodeType: 'expert', label: 'Expert Performance', model: 'claude-sonnet-4-5-20250929', systemPrompt: '', specialty: 'Performance optimization and profiling' },
  },
  {
    id: 'exp-style',
    type: 'expert',
    position: { x: 300, y: 400 },
    data: { nodeType: 'expert', label: 'Expert Code Style', model: 'claude-sonnet-4-5-20250929', systemPrompt: '', specialty: 'Code style, readability, best practices' },
  },
  {
    id: 'skill-lint-review',
    type: 'skill',
    position: { x: -200, y: 600 },
    data: { nodeType: 'skill', label: 'Skill Lint Check', command: '', promptTemplate: '', allowedTools: [] },
  },
  {
    id: 'skill-test-review',
    type: 'skill',
    position: { x: 100, y: 600 },
    data: { nodeType: 'skill', label: 'Skill Run Tests', command: '', promptTemplate: '', allowedTools: [] },
  },
  {
    id: 'rule-no-secrets',
    type: 'rule',
    position: { x: -450, y: 250 },
    data: { nodeType: 'rule', label: 'No Secrets in Code', ruleType: 'deny', ruleText: 'Never allow hardcoded secrets, API keys, or credentials in source code', scope: 'global' },
  },
];

const codeReviewEdges: SerializedEdge[] = [
  edge('agent-reviewer', 'sub-review', 'delegation'),
  edge('sub-review', 'exp-security', 'delegation'),
  edge('sub-review', 'exp-perf', 'delegation'),
  edge('sub-review', 'exp-style', 'delegation'),
  edge('exp-security', 'skill-lint-review', 'skill-usage'),
  edge('exp-perf', 'skill-test-review', 'skill-usage'),
  edge('agent-reviewer', 'rule-no-secrets', 'rule-constraint'),
];

// ═══════════════════════════════════════════════════════════════════════════
//  TEMPLATE 3 — Simple Starter Agent
// ═══════════════════════════════════════════════════════════════════════════

const simpleNodes: SerializedNode[] = [
  {
    id: 'agent-starter',
    type: 'agent',
    position: { x: 0, y: 0 },
    data: {
      nodeType: 'agent', label: 'Agent',
      model: 'claude-opus-4-6', systemPrompt: '',
      permissionMode: 'bypassPermissions', maxTokens: 200000,
      allowedTools: [], disallowedTools: [],
    },
  },
  {
    id: 'skill-search',
    type: 'skill',
    position: { x: -200, y: 250 },
    data: { nodeType: 'skill', label: 'Skill Search', command: '', promptTemplate: '', allowedTools: [] },
  },
  {
    id: 'skill-write',
    type: 'skill',
    position: { x: 100, y: 250 },
    data: { nodeType: 'skill', label: 'Skill Write', command: '', promptTemplate: '', allowedTools: [] },
  },
  {
    id: 'mcp-starter',
    type: 'mcp',
    position: { x: -50, y: 300 },
    data: { nodeType: 'mcp', label: 'MCP Server', serverType: 'stdio', command: '', args: [], tools: [] },
  },
  {
    id: 'rule-starter',
    type: 'rule',
    position: { x: 300, y: 100 },
    data: { nodeType: 'rule', label: 'Guidelines', ruleType: 'guideline', ruleText: '', scope: 'project' },
  },
];

const simpleEdges: SerializedEdge[] = [
  edge('agent-starter', 'skill-search', 'skill-usage'),
  edge('agent-starter', 'skill-write', 'skill-usage'),
  edge('agent-starter', 'mcp-starter', 'tool-access'),
  edge('agent-starter', 'rule-starter', 'rule-constraint'),
];

// ═══════════════════════════════════════════════════════════════════════════
//  Export all templates
// ═══════════════════════════════════════════════════════════════════════════

export const GRAPH_TEMPLATES: GraphTemplate[] = [
  {
    id: 'full-stack-dev-team',
    name: 'Full-Stack Dev Team',
    description: 'Central agent orchestrating 9 specialized subagents for infrastructure, frontend, backend, docs, conventions, GitHub, QA, DevOps, and integrations — each with dedicated experts and skills.',
    category: 'development',
    nodes: fullStackNodes,
    edges: fullStackEdges,
  },
  {
    id: 'code-review-pipeline',
    name: 'Code Review Pipeline',
    description: 'Agent with review subagent delegating to security, performance, and code style experts with linting and testing skills.',
    category: 'development',
    nodes: codeReviewNodes,
    edges: codeReviewEdges,
  },
  {
    id: 'simple-starter',
    name: 'Simple Starter',
    description: 'Minimal agent with a couple of skills, an MCP server, and a rule — a starting point to build upon.',
    category: 'automation',
    nodes: simpleNodes,
    edges: simpleEdges,
  },
];
