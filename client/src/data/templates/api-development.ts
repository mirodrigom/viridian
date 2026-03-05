import type { SerializedNode, SerializedEdge } from '@/types/graph';
import type { GraphTemplate } from './types';
import { edge } from './utils';

const apiDevNodes: SerializedNode[] = [
  {
    id: 'agent-api',
    type: 'agent',
    position: { x: 500, y: 0 },
    data: {
      nodeType: 'agent', label: 'API Architect', description: 'Senior API architect coordinating endpoint design, implementation, documentation, and integration testing.',
      model: 'claude-opus-4-6',
      systemPrompt: `You are a senior API architect coordinating the design, implementation, documentation, and testing of APIs. Review all outputs for consistency between design, implementation, and documentation.

Design principles: Resource-oriented URLs (nouns, proper pluralization). HTTP methods have meaning. Consistent response envelopes. Pagination on every list endpoint. Proper error shapes with status codes and field-level detail.`,
      permissionMode: 'bypassPermissions', maxTokens: 2000000,
      allowedTools: [], disallowedTools: [],
    },
  },
  {
    id: 'sub-api-design',
    type: 'subagent',
    position: { x: 0, y: 300 },
    data: {
      nodeType: 'subagent', label: 'API Designer', description: 'Designs API contracts including resource modeling, endpoint patterns, request/response schemas, and versioning.',
      model: 'claude-sonnet-4-6',
      systemPrompt: `You design API contracts: resources, endpoints, request/response schemas, and error handling patterns.

## Design Process
1. Identify the domain entities and their relationships
2. Map entities to REST resources with proper URL patterns
3. Define CRUD operations plus any custom actions
4. Design request schemas with validation rules (required fields, types, constraints)
5. Design response schemas including pagination envelopes and error shapes
6. Document authentication/authorization requirements per endpoint
7. Plan versioning strategy for backward compatibility

Output: endpoint list with method, path, auth, request schema, response schema, and error cases.`,
      permissionMode: 'bypassPermissions',
      taskDescription: 'Design API endpoints, resources, and contracts',
    },
  },
  {
    id: 'sub-api-impl',
    type: 'subagent',
    position: { x: 350, y: 300 },
    data: {
      nodeType: 'subagent', label: 'API Implementer', description: 'Implements API endpoints with route handlers, service layer, input validation, and proper error handling.',
      model: 'claude-sonnet-4-6',
      systemPrompt: `You implement API endpoints following the designed contracts with production-quality code.

## Implementation Standards
1. Route handlers: parse input, call service, format output — no business logic in handlers
2. Service layer: pure functions with business logic, proper error handling, transaction management
3. Input validation: validate all fields at the route handler level before passing to services
4. Error handling: known errors → 4xx with message, validation → 400 with field detail, unexpected → log + generic 500
5. Always use parameterized database queries
6. Add pagination to all list endpoints: ?limit=N&offset=N
7. Response format: match the contract exactly, consistent field naming (camelCase for JS/TS)

Follow the project's existing patterns for middleware, error handling, and response formatting.`,
      permissionMode: 'bypassPermissions',
      taskDescription: 'Implement API route handlers, services, and validation',
    },
  },
  {
    id: 'sub-api-doc',
    type: 'subagent',
    position: { x: 700, y: 300 },
    data: {
      nodeType: 'subagent', label: 'API Documenter', description: 'Creates OpenAPI specs and human-readable API guides with endpoint references and curl examples.',
      model: 'claude-sonnet-4-6',
      systemPrompt: `You create API documentation from the implemented endpoints — both OpenAPI specs and human-readable guides.

## Documentation Output
1. OpenAPI 3.x spec with accurate schemas, examples, and descriptions
2. Getting started guide: authentication, base URL, first API call
3. Endpoint reference: organized by resource, with curl examples for every endpoint
4. Error reference: all error codes, their meaning, and how to handle them
5. Pagination guide: how to paginate list endpoints, cursor vs offset
6. Rate limiting: limits, headers, and backoff strategy

Read the actual route handlers and service code to ensure documentation matches implementation exactly.`,
      permissionMode: 'bypassPermissions',
      taskDescription: 'Generate OpenAPI specs and API documentation',
    },
  },
  {
    id: 'sub-api-test',
    type: 'subagent',
    position: { x: 1050, y: 300 },
    data: {
      nodeType: 'subagent', label: 'API Tester', description: 'Writes comprehensive API integration tests covering happy paths, validation errors, auth, and edge cases.',
      model: 'claude-sonnet-4-6',
      systemPrompt: `You write comprehensive API integration tests covering happy paths, error cases, and edge conditions.

## Test Coverage
For each endpoint:
1. **Happy path:** Valid request returns correct status code and response shape
2. **Validation errors:** Missing required fields, wrong types, out-of-range values → 400
3. **Auth errors:** Missing token → 401, insufficient permissions → 403
4. **Not found:** Invalid IDs → 404
5. **Conflict:** Duplicate creation → 409
6. **Edge cases:** Empty lists, maximum page size, special characters in input, concurrent modifications
7. **Pagination:** First page, last page, out-of-range offset

Use descriptive test names: "POST /users - should return 400 when email is missing"`,
      permissionMode: 'bypassPermissions',
      taskDescription: 'Write API integration tests with full edge case coverage',
    },
  },
  {
    id: 'exp-rest',
    type: 'expert',
    position: { x: 0, y: 570 },
    data: {
      nodeType: 'expert', label: 'Expert REST', description: 'REST API design expert following the Richardson Maturity Model with proper resource hierarchies and idempotency.', model: 'claude-sonnet-4-6',
      systemPrompt: 'You are a REST API design expert following the Richardson Maturity Model. You design proper resource hierarchies, use HATEOAS links where appropriate, implement content negotiation, and ensure idempotency for PUT/DELETE operations. You know when to use query parameters vs path parameters vs request body.',
      specialty: 'REST API design patterns',
    },
  },
  {
    id: 'exp-auth-api',
    type: 'expert',
    position: { x: 700, y: 570 },
    data: {
      nodeType: 'expert', label: 'Expert Auth', description: 'API authentication and authorization expert for JWT, OAuth 2.0, API keys, and role-based access control.', model: 'claude-sonnet-4-6',
      systemPrompt: 'You are an API authentication and authorization expert. You implement JWT-based auth with proper token rotation, OAuth 2.0 flows for third-party integrations, API key management for machine-to-machine auth, and role-based access control (RBAC) with fine-grained permissions. You ensure tokens have appropriate expiration and refresh flows.',
      specialty: 'API authentication and authorization',
    },
  },
  {
    id: 'rule-api-versioning',
    type: 'rule',
    position: { x: 100, y: 100 },
    data: { nodeType: 'rule', label: 'API Versioning', description: 'Guideline for additive-only field changes with deprecation headers and URL prefix versioning for breaking changes.', ruleType: 'guideline', ruleText: 'Add new fields freely but never remove or rename existing fields. Deprecate endpoints by adding a deprecation header and sunset date. Version via URL prefix (/v1/, /v2/) only for breaking changes.', scope: 'project' },
  },
  {
    id: 'rule-api-validation',
    type: 'rule',
    position: { x: 900, y: 100 },
    data: { nodeType: 'rule', label: 'Input Validation', description: 'Enforces input validation at the API boundary with field-level error details for failures.', ruleType: 'constraint', ruleText: 'Validate all input at the API boundary. Return 400 with field-level error details for validation failures. Never trust client-side validation.', scope: 'global' },
  },
  {
    id: 'skill-api-test',
    type: 'skill',
    position: { x: 1050, y: 570 },
    data: { nodeType: 'skill', label: 'Skill API Testing', description: 'Writes and runs API integration tests covering happy paths, validation, auth, not found, and edge cases.', command: '/test-api', promptTemplate: 'Write and run API integration tests for the project\'s endpoints. For each endpoint cover: (1) Happy path — valid request returns correct status and shape, (2) Validation — missing/invalid fields return 400 with field detail, (3) Auth — missing token returns 401, insufficient role returns 403, (4) Not found — invalid IDs return 404, (5) Edge cases — empty lists, max pagination, special characters. Use descriptive test names like "POST /users - should return 400 when email is missing".', allowedTools: ['Read', 'Write', 'Bash', 'Glob', 'Grep'] },
  },
  {
    id: 'skill-openapi-gen',
    type: 'skill',
    position: { x: 350, y: 570 },
    data: { nodeType: 'skill', label: 'Skill OpenAPI Gen', description: 'Generates an OpenAPI 3.x specification from implemented route handlers with schemas and examples.', command: '/gen-openapi', promptTemplate: 'Generate an OpenAPI 3.x specification from the implemented API. Scan route handlers to extract: (1) All endpoints with HTTP method and path, (2) Request body schemas with types, required fields, and validation constraints, (3) Response schemas for success (200/201) and error cases (400/401/403/404/500), (4) Path and query parameters with types, (5) Authentication requirements per endpoint. Output a valid YAML or JSON OpenAPI spec with example values.', allowedTools: ['Read', 'Write', 'Glob', 'Grep'] },
  },
];

const apiDevEdges: SerializedEdge[] = [
  edge('agent-api', 'sub-api-design', 'delegation'),
  edge('agent-api', 'sub-api-impl', 'delegation'),
  edge('agent-api', 'sub-api-doc', 'delegation'),
  edge('agent-api', 'sub-api-test', 'delegation'),
  edge('sub-api-design', 'exp-rest', 'delegation'),
  edge('sub-api-impl', 'exp-auth-api', 'delegation'),
  edge('sub-api-test', 'skill-api-test', 'skill-usage'),
  edge('sub-api-doc', 'skill-openapi-gen', 'skill-usage'),
  edge('agent-api', 'rule-api-versioning', 'rule-constraint'),
  edge('agent-api', 'rule-api-validation', 'rule-constraint'),
];

export const apiDevelopmentTeam: GraphTemplate = {
  id: 'api-development-team',
  name: 'API Development Team',
  description: 'API architect coordinating designer, implementer, documenter, and tester subagents — full lifecycle API development with REST and auth experts.',
  category: 'development',
  nodes: apiDevNodes,
  edges: apiDevEdges,
};
