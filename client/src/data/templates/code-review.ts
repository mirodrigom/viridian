import type { SerializedNode, SerializedEdge } from '@/types/graph';
import type { GraphTemplate } from './types';
import { edge } from './utils';

const codeReviewNodes: SerializedNode[] = [
  {
    id: 'agent-reviewer',
    type: 'agent',
    position: { x: 400, y: 0 },
    data: {
      nodeType: 'agent', label: 'Code Review Agent', description: 'Code review team lead that coordinates security, performance, and style reviews into a prioritized report.',
      model: 'claude-opus-4-6',
      systemPrompt: `You are a code review team lead coordinating multi-dimensional reviews. You deduplicate findings from reviewers, prioritize by severity (Critical > High > Medium > Low), and present a unified report with actionable items, exact file locations, and specific fixes.

Report format: [Severity] [File:line] Description — Recommended fix. Group by severity, then by reviewer domain.`,
      permissionMode: 'bypassPermissions', maxTokens: 2000000,
      allowedTools: [], disallowedTools: [],
    },
  },
  {
    id: 'sub-review',
    type: 'subagent',
    position: { x: 400, y: 280 },
    data: {
      nodeType: 'subagent', label: 'Subagent Review', description: 'Coordinates code reviews across security, performance, and style dimensions with consolidated findings.',
      model: 'claude-sonnet-4-6',
      systemPrompt: `You coordinate code reviews across three dimensions: security, performance, and code style. For each review task:

1. Delegate to the Security expert for injection vulnerabilities, auth issues, and data exposure
2. Delegate to the Performance expert for N+1 queries, memory leaks, and algorithmic inefficiency
3. Delegate to the Style expert for naming consistency, dead code, and pattern adherence
4. Collect all findings, remove duplicates, and return a consolidated list sorted by severity

Always provide exact file paths and line numbers. Only report real, actionable issues — not theoretical concerns.`,
      permissionMode: 'bypassPermissions',
      taskDescription: 'Perform comprehensive code review across multiple dimensions',
    },
  },
  {
    id: 'exp-security',
    type: 'expert',
    position: { x: 50, y: 560 },
    data: {
      nodeType: 'expert', label: 'Expert Security', description: 'Security-focused reviewer for injection, auth, data exposure, input validation, and crypto vulnerabilities.', model: 'claude-sonnet-4-6',
      systemPrompt: `You are a security-focused code reviewer. Analyze code for real, exploitable vulnerabilities:

1. **Injection:** SQL injection (string concatenation in queries), command injection (unsanitized exec/spawn), template injection
2. **Auth/AuthZ:** Missing auth checks on endpoints, broken session management, privilege escalation, missing CSRF protection
3. **Data exposure:** Sensitive data in logs, PII in error messages, secrets in source, overly permissive CORS
4. **Input validation:** Missing validation, path traversal in file operations, unvalidated redirects
5. **Crypto:** Weak hashing (MD5/SHA1 for passwords), insecure random for tokens

For each finding: severity (Critical/High/Medium/Low), exact file:line, proof of concept, and specific remediation code.`,
      specialty: 'Security vulnerabilities and OWASP',
    },
  },
  {
    id: 'exp-perf',
    type: 'expert',
    position: { x: 400, y: 560 },
    data: {
      nodeType: 'expert', label: 'Expert Performance', description: 'Performance-focused reviewer for database N+1s, memory leaks, algorithmic inefficiency, and rendering issues.', model: 'claude-sonnet-4-6',
      systemPrompt: `You are a performance-focused code reviewer. Analyze code for:

1. **Database:** N+1 queries (queries inside loops), missing indexes, unbounded result sets, SELECT * when specific columns suffice
2. **Memory:** Event listener leaks, growing collections never pruned, large objects held in closures, missing cleanup in unmount/exit handlers
3. **Algorithmic:** O(n^2) that could be O(n), Array.find inside loops (use Map/Set), redundant recomputation that should be memoized
4. **I/O:** Sequential API calls that could be parallel (Promise.all), missing debouncing, repeated file reads for stable data
5. **Rendering:** Unnecessary re-renders from unstable references, missing key props, heavy components not lazy-loaded

For each finding: impact (High/Medium/Low), exact file:line, and specific fix with estimated improvement.`,
      specialty: 'Performance optimization and profiling',
    },
  },
  {
    id: 'exp-style',
    type: 'expert',
    position: { x: 750, y: 560 },
    data: {
      nodeType: 'expert', label: 'Expert Code Style', description: 'Code style reviewer for naming consistency, dead code, pattern deviations, and maintainability issues.', model: 'claude-sonnet-4-6',
      systemPrompt: `You are a code style and consistency reviewer. Focus on issues that affect maintainability, not personal preferences:

1. **Naming:** Mixed conventions (camelCase vs snake_case), unclear variable names, inconsistent patterns across files
2. **Dead code:** Unused imports, unreachable branches, commented-out code blocks, unused variables
3. **Pattern deviations:** Not following established project conventions for error handling, data fetching, or state management
4. **Duplication:** Code repeated across files that should be extracted into shared utilities
5. **Complexity:** Functions over 50 lines that should be decomposed, deeply nested conditionals, overly clever patterns

For each finding: severity (High/Medium/Low), exact file:line, description, and specific refactoring suggestion.`,
      specialty: 'Code style, readability, best practices',
    },
  },
  {
    id: 'skill-lint-review',
    type: 'skill',
    position: { x: 150, y: 830 },
    data: { nodeType: 'skill', label: 'Skill Lint Check', description: 'Runs ESLint, Prettier, or equivalent and reports errors grouped by severity with file locations.', command: '/lint-check', promptTemplate: 'Run the project\'s linter and static analysis tools. Execute ESLint, Prettier, or equivalent from package.json scripts. Collect all errors and warnings, group by severity, and report with exact file:line locations. Highlight any rules that are disabled inline and whether the disabling is justified.', allowedTools: ['Read', 'Bash', 'Glob', 'Grep'] },
  },
  {
    id: 'skill-test-review',
    type: 'skill',
    position: { x: 650, y: 830 },
    data: { nodeType: 'skill', label: 'Skill Run Tests', description: 'Runs the full test suite and reports pass/fail counts, regressions, coverage, and slow tests.', command: '/run-tests', promptTemplate: 'Run the full test suite to verify code quality. Execute the test runner, capture output, and analyze results. Report: (1) Total pass/fail/skip counts, (2) Any newly failing tests with stack traces, (3) Coverage percentage if available, (4) Slow tests (>5s) that may need optimization. Focus on regressions — tests that were passing before but fail now.', allowedTools: ['Read', 'Bash', 'Glob', 'Grep'] },
  },
  {
    id: 'rule-no-secrets',
    type: 'rule',
    position: { x: 800, y: 130 },
    data: { nodeType: 'rule', label: 'No Secrets in Code', description: 'Denies hardcoded secrets, API keys, or credentials in source code.', ruleType: 'deny', ruleText: 'Never allow hardcoded secrets, API keys, or credentials in source code. Flag any strings that look like tokens, passwords, or API keys.', scope: 'global' },
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

export const codeReviewPipeline: GraphTemplate = {
  id: 'code-review-pipeline',
  name: 'Code Review Pipeline',
  description: 'Agent with review subagent delegating to security, performance, and code style experts with linting and testing skills.',
  category: 'analysis',
  nodes: codeReviewNodes,
  edges: codeReviewEdges,
};
