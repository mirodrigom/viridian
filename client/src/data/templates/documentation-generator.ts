import type { SerializedNode, SerializedEdge } from '@/types/graph';
import type { GraphTemplate } from './types';
import { edge } from './utils';

const docGenNodes: SerializedNode[] = [
  {
    id: 'agent-docs',
    type: 'agent',
    position: { x: 400, y: 0 },
    data: {
      nodeType: 'agent', label: 'Documentation Lead', description: 'Technical documentation lead coordinating API docs, architecture docs, and user guides with cross-reference verification.',
      model: 'claude-opus-4-6',
      systemPrompt: `You are a technical documentation lead generating comprehensive project documentation. Every claim must be verified against actual source code. Include runnable examples and curl commands for APIs. Use Mermaid diagrams for architecture and data flow. Keep documentation DRY — single source of truth, linked from other locations.`,
      permissionMode: 'bypassPermissions', maxTokens: 2000000,
      allowedTools: [], disallowedTools: [],
    },
  },
  {
    id: 'sub-api-docs',
    type: 'subagent',
    position: { x: 50, y: 300 },
    data: {
      nodeType: 'subagent', label: 'API Docs Generator', description: 'Generates API documentation from route handlers with schemas, auth requirements, and curl examples.',
      model: 'claude-sonnet-4-6',
      systemPrompt: `You generate comprehensive API documentation by reading the actual route handlers and service code.

## For Each Endpoint Document
- HTTP method and path
- Authentication requirements
- Request body schema with types, required fields, and constraints
- Response schema for success and all error cases
- Query parameters and path parameters
- Example curl command with realistic data
- Rate limiting and pagination details if applicable

Search for route definitions using Grep for router patterns (app.get, app.post, router.get, etc.) and trace through to understand the full request/response cycle.`,
      permissionMode: 'bypassPermissions',
      taskDescription: 'Generate API documentation from source code',
    },
  },
  {
    id: 'sub-arch-docs',
    type: 'subagent',
    position: { x: 400, y: 300 },
    data: {
      nodeType: 'subagent', label: 'Architecture Docs', description: 'Generates architecture documentation with system overviews, dependency graphs, and ER diagrams in Mermaid.',
      model: 'claude-sonnet-4-6',
      systemPrompt: `You generate architecture documentation by analyzing the project's structure, modules, and data flow.

## Deliverables
- High-level system overview diagram (Mermaid)
- Module dependency graph showing how packages/directories relate
- Data flow diagrams for key features (user auth, main CRUD operations)
- Database schema documentation with table relationships (ER diagram in Mermaid)
- Key design decisions with rationale (ADR format: context, decision, consequences)
- Technology stack summary with version requirements

Read the source code thoroughly — every diagram and description must reflect the actual implementation, not assumptions.`,
      permissionMode: 'bypassPermissions',
      taskDescription: 'Generate architecture and design documentation',
    },
  },
  {
    id: 'sub-user-guide',
    type: 'subagent',
    position: { x: 750, y: 300 },
    data: {
      nodeType: 'subagent', label: 'User Guide Writer', description: 'Writes user-facing documentation including README, getting started guides, and configuration references.',
      model: 'claude-sonnet-4-6',
      systemPrompt: `You write user-facing documentation: README, getting started guides, contributing guides, and configuration references.

## README Structure
1. Project name and one-line description
2. Features list
3. Quick start (3-5 steps from clone to running)
4. Configuration reference (all env vars with descriptions and defaults)
5. Development workflow (how to run tests, lint, build)
6. Deployment instructions
7. Contributing guide link

## Standards
- Test every setup instruction against the actual project structure
- Include exact commands — not "install dependencies" but "npm install"
- Note prerequisites (Node.js version, system dependencies)
- Add troubleshooting section for common issues`,
      permissionMode: 'bypassPermissions',
      taskDescription: 'Write README, getting started, and user guides',
    },
  },
  {
    id: 'exp-mermaid',
    type: 'expert',
    position: { x: 250, y: 570 },
    data: {
      nodeType: 'expert', label: 'Expert Mermaid', description: 'Mermaid diagram expert for flowcharts, sequence diagrams, ER diagrams, and class diagrams.', model: 'claude-sonnet-4-6',
      systemPrompt: 'You are a Mermaid diagram expert. You create clear, well-structured diagrams: flowcharts for processes, sequence diagrams for API interactions, ER diagrams for database schemas, and class diagrams for module relationships. You use proper Mermaid syntax, meaningful labels, and keep diagrams focused on one concept each.',
      specialty: 'Mermaid diagrams and visual documentation',
    },
  },
  {
    id: 'exp-openapi-docs',
    type: 'expert',
    position: { x: 600, y: 570 },
    data: {
      nodeType: 'expert', label: 'Expert OpenAPI', description: 'OpenAPI 3.x expert for machine-readable API specs with proper schemas, validations, and examples.', model: 'claude-sonnet-4-6',
      systemPrompt: 'You are an OpenAPI 3.x specification expert. You create accurate, machine-readable API specs from source code. You define proper schemas with types, validations, examples, and descriptions. You ensure the spec can generate both documentation and client SDKs.',
      specialty: 'OpenAPI specifications',
    },
  },
  {
    id: 'skill-gen-readme',
    type: 'skill',
    position: { x: 750, y: 570 },
    data: { nodeType: 'skill', label: 'Skill Generate README', description: 'Generates a comprehensive README with features, quick start, config reference, and dev workflow.', command: '/gen-readme', promptTemplate: 'Generate a comprehensive README.md by analyzing the actual project structure. Include: (1) Project name and one-line description, (2) Features list extracted from the codebase, (3) Quick start in 3-5 steps from clone to running, (4) Configuration reference — all environment variables with descriptions and defaults, (5) Development workflow — how to run tests, lint, and build, (6) Tech stack summary. Test every setup instruction against the actual project files.', allowedTools: ['Read', 'Write', 'Glob', 'Grep', 'Bash'] },
  },
  {
    id: 'skill-gen-api-spec',
    type: 'skill',
    position: { x: 50, y: 570 },
    data: { nodeType: 'skill', label: 'Skill Generate API Spec', description: 'Generates an OpenAPI 3.x spec from route handlers with paths, schemas, and curl examples.', command: '/gen-api-spec', promptTemplate: 'Generate an OpenAPI 3.x specification from the project\'s route handlers. Scan for Express router definitions (app.get, router.post, etc.), extract path parameters, query parameters, request body schemas, and response shapes. For each endpoint document: method, path, auth requirements, request/response schemas with TypeScript types mapped to JSON Schema, and example curl commands.', allowedTools: ['Read', 'Glob', 'Grep'] },
  },
];

const docGenEdges: SerializedEdge[] = [
  edge('agent-docs', 'sub-api-docs', 'delegation'),
  edge('agent-docs', 'sub-arch-docs', 'delegation'),
  edge('agent-docs', 'sub-user-guide', 'delegation'),
  edge('sub-arch-docs', 'exp-mermaid', 'delegation'),
  edge('sub-api-docs', 'exp-openapi-docs', 'delegation'),
  edge('sub-user-guide', 'skill-gen-readme', 'skill-usage'),
  edge('sub-api-docs', 'skill-gen-api-spec', 'skill-usage'),
];

export const documentationGenerator: GraphTemplate = {
  id: 'documentation-generator',
  name: 'Documentation Generator',
  description: 'Documentation lead with API docs, architecture docs, and user guide subagents — generates comprehensive project documentation from source code.',
  category: 'automation',
  nodes: docGenNodes,
  edges: docGenEdges,
};
