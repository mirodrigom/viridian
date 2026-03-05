import type { SerializedNode, SerializedEdge } from '@/types/graph';
import type { GraphTemplate } from './types';
import { edge } from './utils';

const simpleNodes: SerializedNode[] = [
  {
    id: 'agent-starter',
    type: 'agent',
    position: { x: 200, y: 0 },
    data: {
      nodeType: 'agent', label: 'Agent', description: 'General-purpose development assistant that reads the codebase, understands patterns, and implements focused changes.',
      model: 'claude-opus-4-6',
      systemPrompt: `You are a general-purpose development assistant. You help with coding tasks by reading the codebase, understanding existing patterns, and implementing changes that follow project conventions.

## Working Principles
1. Read before writing — understand the project structure, patterns, and conventions before making changes
2. Minimal surface area — touch the fewest files necessary, don't refactor unrelated code
3. Production quality — handle errors, validate inputs at boundaries, use meaningful error messages
4. Test awareness — check if related tests exist and verify your changes don't break them

When given a task, first explore the relevant code, then implement with clean, focused changes.`,
      permissionMode: 'bypassPermissions', maxTokens: 2000000,
      allowedTools: [], disallowedTools: [],
    },
  },
  {
    id: 'skill-search',
    type: 'skill',
    position: { x: -100, y: 280 },
    data: { nodeType: 'skill', label: 'Skill Search', description: 'Searches the codebase for code patterns, definitions, and usages with file paths and snippets.', command: '/search-codebase', promptTemplate: 'Search the codebase for relevant code patterns, definitions, and usages. Use glob patterns to find files by name and grep to search file contents. Summarize findings with file paths, line numbers, and code snippets. This skill is for read-only exploration — use it to understand the project structure before making changes.', allowedTools: ['Read', 'Glob', 'Grep'] },
  },
  {
    id: 'skill-write',
    type: 'skill',
    position: { x: 240, y: 280 },
    data: { nodeType: 'skill', label: 'Skill Write', description: 'Implements code changes following existing project conventions with minimal, focused edits.', command: '/write-code', promptTemplate: 'Implement code changes following the project\'s existing conventions. Steps: (1) Read surrounding code to understand patterns, (2) Write or edit files with minimal changes to achieve the goal, (3) Verify the changes are syntactically valid, (4) Check that imports and exports are correct. Prefer editing existing files over creating new ones. Keep changes focused and atomic.', allowedTools: ['Read', 'Write', 'Edit', 'Glob', 'Grep'] },
  },
  {
    id: 'mcp-starter',
    type: 'mcp',
    position: { x: -100, y: 520 },
    data: { nodeType: 'mcp', label: 'Context7 Docs', description: 'Context7 MCP server for library documentation lookup and API reference queries.', serverType: 'stdio', command: 'npx', args: ['-y', '@upstash/context7-mcp'], tools: ['resolve-library-id', 'query-docs'] },
  },
  {
    id: 'rule-starter',
    type: 'rule',
    position: { x: 550, y: 130 },
    data: { nodeType: 'rule', label: 'Guidelines', description: 'Project-level guidelines for following conventions, preferring edits over new files, and keeping changes minimal.', ruleType: 'guideline', ruleText: 'Follow existing project conventions. Prefer editing existing files over creating new ones. Keep changes focused and minimal.', scope: 'project' },
  },
];

const simpleEdges: SerializedEdge[] = [
  edge('agent-starter', 'skill-search', 'skill-usage'),
  edge('agent-starter', 'skill-write', 'skill-usage'),
  edge('agent-starter', 'mcp-starter', 'tool-access'),
  edge('agent-starter', 'rule-starter', 'rule-constraint'),
];

export const simpleStarter: GraphTemplate = {
  id: 'simple-starter',
  name: 'Simple Starter',
  description: 'Minimal agent with a couple of skills, an MCP server, and a rule — a starting point to build upon.',
  category: 'automation',
  nodes: simpleNodes,
  edges: simpleEdges,
};
