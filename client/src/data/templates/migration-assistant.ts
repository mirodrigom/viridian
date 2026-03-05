import type { SerializedNode, SerializedEdge } from '@/types/graph';
import type { GraphTemplate } from './types';
import { edge } from './utils';

const migrationNodes: SerializedNode[] = [
  {
    id: 'agent-migration',
    type: 'agent',
    position: { x: 400, y: 0 },
    data: {
      nodeType: 'agent', label: 'Migration Coordinator', description: 'Codebase migration coordinator for framework upgrades and large-scale refactoring with incremental, testable steps.',
      model: 'claude-opus-4-6',
      systemPrompt: `You are a codebase migration coordinator managing framework upgrades, language migrations, and large-scale refactoring. Never do a big-bang migration — break into incremental, testable steps. Maintain backward compatibility at each step. Create adapter/shim layers for gradual migration. Run the full test suite after each transformation. Document breaking changes.`,
      permissionMode: 'bypassPermissions', maxTokens: 2000000,
      allowedTools: [], disallowedTools: [],
    },
  },
  {
    id: 'sub-dep-analysis',
    type: 'subagent',
    position: { x: 50, y: 300 },
    data: {
      nodeType: 'subagent', label: 'Dependency Analyzer', description: 'Analyzes codebases to map migration scope, dependency chains, and recommended migration order.',
      model: 'claude-sonnet-4-6',
      systemPrompt: `You analyze codebases to map the full scope of a migration.

## Analysis Tasks
- Identify all files that import or use the target library/framework
- Map dependency chains: which modules depend on the code being migrated
- Detect breaking API changes between the current and target versions
- List all configuration files that need updating
- Identify test files that need migration
- Estimate the scope: number of files, lines of code affected, and complexity
- Produce a dependency graph showing migration order (leaf dependencies first)

Output a structured migration scope report with file counts, risk areas, and recommended migration order.`,
      permissionMode: 'bypassPermissions',
      taskDescription: 'Analyze dependencies and map migration scope',
    },
  },
  {
    id: 'sub-transformer',
    type: 'subagent',
    position: { x: 400, y: 300 },
    data: {
      nodeType: 'subagent', label: 'Code Transformer', description: 'Performs behavior-preserving code transformations for API upgrades, syntax changes, and import rewrites.',
      model: 'claude-sonnet-4-6',
      systemPrompt: `You perform code transformations for migrations: API upgrades, syntax changes, pattern replacements, and import rewrites.

## Transformation Rules
1. Read the migration guide for the target version to understand all changes
2. Transform one pattern at a time across the codebase (e.g., all deprecated API calls first)
3. Preserve existing functionality exactly — migration should be behavior-preserving
4. Update imports, type definitions, and configuration files
5. Add adapter/compatibility layers where a direct replacement isn't possible
6. Leave clear TODO comments for manual review where automated transformation is ambiguous

After each transformation batch, list all files modified and the specific pattern changed.`,
      permissionMode: 'bypassPermissions',
      taskDescription: 'Perform code transformations and pattern replacements',
    },
  },
  {
    id: 'sub-migration-test',
    type: 'subagent',
    position: { x: 750, y: 300 },
    data: {
      nodeType: 'subagent', label: 'Migration Tester', description: 'Verifies migration correctness by running tests, checking for type errors, and detecting remaining old-version references.',
      model: 'claude-sonnet-4-6',
      systemPrompt: `You verify migrations are correct by running tests, checking for regressions, and validating behavior preservation.

## Verification Tasks
1. Run the existing test suite — all tests should pass after migration
2. Check for type errors introduced by API changes
3. Verify runtime behavior: key user flows still work correctly
4. Look for deprecation warnings in test output
5. Check that no old imports or API usage remains (grep for deprecated patterns)
6. Verify configuration files are valid for the new version

Report: pass/fail status, new type errors, deprecation warnings, and any remaining old-version references.`,
      permissionMode: 'bypassPermissions',
      taskDescription: 'Verify migration correctness and test for regressions',
    },
  },
  {
    id: 'exp-frameworks',
    type: 'expert',
    position: { x: 50, y: 570 },
    data: {
      nodeType: 'expert', label: 'Expert Frameworks', description: 'Framework migration expert for Vue 2-3, React class-hooks, Webpack-Vite, and JS-TypeScript upgrades.', model: 'claude-sonnet-4-6',
      systemPrompt: 'You are a framework migration expert familiar with major upgrade paths: Vue 2→3, React class→hooks, Express 4→5, Webpack→Vite, Jest→Vitest, JavaScript→TypeScript. You know the exact API changes, deprecations, and recommended replacement patterns for each migration path.',
      specialty: 'Framework upgrade paths and patterns',
    },
  },
  {
    id: 'exp-compat',
    type: 'expert',
    position: { x: 750, y: 570 },
    data: {
      nodeType: 'expert', label: 'Expert Compatibility', description: 'Backward compatibility expert for adapter layers, shims, and gradual migration using Strangler Fig patterns.', model: 'claude-sonnet-4-6',
      systemPrompt: 'You are a backward compatibility expert. You design adapter layers, shims, and compatibility wrappers that allow gradual migration. You know when to use the Strangler Fig pattern (wrap old code, redirect to new implementation) vs. Branch by Abstraction (introduce interface, swap implementation).',
      specialty: 'Backward compatibility and adapter patterns',
    },
  },
  {
    id: 'rule-no-breaking',
    type: 'rule',
    position: { x: 800, y: 100 },
    data: { nodeType: 'rule', label: 'No Breaking Changes', description: 'Ensures each migration step leaves the codebase in a working, testable state without breaking builds.', ruleType: 'constraint', ruleText: 'Each migration step must leave the codebase in a working, testable state. Never commit a half-migrated state that breaks the build or tests.', scope: 'global' },
  },
  {
    id: 'skill-codemods',
    type: 'skill',
    position: { x: 300, y: 570 },
    data: { nodeType: 'skill', label: 'Skill Codemods', description: 'Applies automated code transformations across the codebase for API renames, import rewrites, and syntax upgrades.', command: '/run-codemod', promptTemplate: 'Apply automated code transformations across the codebase for migration. Steps: (1) Identify all files matching the target pattern using glob, (2) For each file, apply the transformation (API rename, import rewrite, syntax upgrade), (3) Preserve existing functionality — migration must be behavior-preserving, (4) Add TODO comments where automated transformation is ambiguous, (5) List all modified files and the specific patterns changed.', allowedTools: ['Read', 'Write', 'Edit', 'Glob', 'Grep'] },
  },
  {
    id: 'skill-test-run',
    type: 'skill',
    position: { x: 750, y: 810 },
    data: { nodeType: 'skill', label: 'Skill Run Tests', description: 'Runs the full test suite to verify migration correctness and detect remaining old-version references.', command: '/run-tests', promptTemplate: 'Run the full test suite to verify migration correctness. Execute tests, check for: (1) Newly failing tests — likely caused by the migration, (2) Type errors from API changes, (3) Deprecation warnings in output, (4) Remaining references to old API patterns (grep for deprecated imports/calls). Report pass/fail status, new errors, and any old-version references that still need migration.', allowedTools: ['Read', 'Bash', 'Glob', 'Grep'] },
  },
];

const migrationEdges: SerializedEdge[] = [
  edge('agent-migration', 'sub-dep-analysis', 'delegation'),
  edge('agent-migration', 'sub-transformer', 'delegation'),
  edge('agent-migration', 'sub-migration-test', 'delegation'),
  edge('sub-dep-analysis', 'exp-frameworks', 'delegation'),
  edge('sub-migration-test', 'exp-compat', 'delegation'),
  edge('sub-transformer', 'skill-codemods', 'skill-usage'),
  edge('sub-migration-test', 'skill-test-run', 'skill-usage'),
  edge('agent-migration', 'rule-no-breaking', 'rule-constraint'),
];

export const migrationAssistant: GraphTemplate = {
  id: 'migration-assistant',
  name: 'Migration Assistant',
  description: 'Migration coordinator with dependency analyzer, code transformer, and migration tester — manages framework upgrades and large-scale refactoring.',
  category: 'development',
  nodes: migrationNodes,
  edges: migrationEdges,
};
