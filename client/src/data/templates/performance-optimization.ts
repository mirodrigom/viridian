import type { SerializedNode, SerializedEdge } from '@/types/graph';
import type { GraphTemplate } from './types';
import { edge } from './utils';

const perfOptNodes: SerializedNode[] = [
  {
    id: 'agent-perf',
    type: 'agent',
    position: { x: 400, y: 0 },
    data: {
      nodeType: 'agent', label: 'Performance Lead', description: 'Performance engineering lead coordinating frontend, backend, and database optimizations prioritized by user impact.',
      model: 'claude-opus-4-6',
      systemPrompt: `You are a performance engineering lead coordinating optimization across the entire application stack. Prioritize findings by user-visible impact.

P0 (fix now): User-visible latency >3s, memory crashes, blocking event loop. P1 (this sprint): Slow APIs >500ms, bundles >500KB, N+1 queries. P2 (next sprint): Sub-optimal caching, minor re-renders. P3 (backlog): Micro-optimizations.`,
      permissionMode: 'bypassPermissions', maxTokens: 2000000,
      allowedTools: [], disallowedTools: [],
    },
  },
  {
    id: 'sub-frontend-perf',
    type: 'subagent',
    position: { x: 50, y: 300 },
    data: {
      nodeType: 'subagent', label: 'Frontend Profiler', description: 'Profiles frontend for bundle size, rendering bottlenecks, lazy loading, and network waterfall issues.',
      model: 'claude-sonnet-4-6',
      systemPrompt: `You profile frontend applications for rendering performance, bundle size, and loading speed.

## Analysis Areas
1. **Bundle size:** Look for large imports, missing tree-shaking, entire libraries imported for one function
2. **Rendering:** Unnecessary re-renders from unstable object references, missing memoization, computed values recalculating on every render
3. **Loading:** Routes and heavy components not lazy-loaded, images without lazy loading, missing preload hints for critical resources
4. **Runtime:** Expensive computations in render/template, DOM manipulation in tight loops, missing virtual scrolling for long lists
5. **Network:** Sequential API calls that could be parallel, missing request deduplication, no caching of stable responses

For each finding: estimated impact, exact file:line, and specific optimization with before/after comparison.`,
      permissionMode: 'bypassPermissions',
      taskDescription: 'Profile frontend for rendering, bundle, and loading performance',
    },
  },
  {
    id: 'sub-backend-perf',
    type: 'subagent',
    position: { x: 400, y: 300 },
    data: {
      nodeType: 'subagent', label: 'Backend Profiler', description: 'Profiles backend for API latency, memory leaks, event loop blocking, and caching opportunities.',
      model: 'claude-sonnet-4-6',
      systemPrompt: `You profile backend applications for API latency, throughput, and resource efficiency.

## Analysis Areas
1. **API latency:** Endpoints doing unnecessary work, missing early returns, sequential operations that could be parallel
2. **Memory:** Event listener leaks, growing Maps/Sets/arrays never pruned, large objects in closures, buffering entire files when streaming would work
3. **Concurrency:** Synchronous operations blocking the event loop, missing worker threads for CPU-intensive tasks, connection pool exhaustion
4. **Caching:** Missing caching for expensive or stable computations, no cache invalidation strategy, redundant file system reads
5. **I/O patterns:** Missing compression for responses, no streaming for large payloads, connection reuse not configured

For each finding: severity, quantified impact estimate, and specific fix.`,
      permissionMode: 'bypassPermissions',
      taskDescription: 'Profile backend for API latency and resource efficiency',
    },
  },
  {
    id: 'sub-db-perf',
    type: 'subagent',
    position: { x: 750, y: 300 },
    data: {
      nodeType: 'subagent', label: 'Database Optimizer', description: 'Optimizes database performance including N+1 queries, missing indexes, unbounded queries, and write patterns.',
      model: 'claude-sonnet-4-6',
      systemPrompt: `You optimize database performance: queries, indexes, schema design, and data access patterns.

## Analysis Areas
1. **N+1 queries:** Any loop executing a query per iteration — fix with JOINs or batch IN queries
2. **Missing indexes:** Columns in WHERE, JOIN, ORDER BY without indexes; composite index column order
3. **Unbounded queries:** SELECT without LIMIT, SELECT * when specific columns suffice
4. **Write patterns:** Single-row INSERTs in loops (use batch), missing transactions for multi-step mutations
5. **Schema issues:** Wrong data types, missing NOT NULL constraints, redundant denormalized columns
6. **Connection management:** Missing connection pooling, connections not released, long-held transactions

For each finding: quantified impact (e.g., "reduces O(n) queries to O(1)"), exact code location, and SQL/code fix.`,
      permissionMode: 'bypassPermissions',
      taskDescription: 'Optimize database queries, indexes, and access patterns',
    },
  },
  {
    id: 'exp-bundle',
    type: 'expert',
    position: { x: 50, y: 570 },
    data: {
      nodeType: 'expert', label: 'Expert Bundle Size', description: 'JavaScript bundle optimization expert for tree-shaking, code splitting, and lighter dependency alternatives.', model: 'claude-sonnet-4-6',
      systemPrompt: 'You are a JavaScript bundle optimization expert. You analyze import trees to find oversized dependencies, recommend lighter alternatives (date-fns vs moment, preact vs react for small apps), configure code splitting and dynamic imports, and ensure tree-shaking is working correctly. You know build tool configurations for Vite, Webpack, and esbuild.',
      specialty: 'JavaScript bundle size optimization',
    },
  },
  {
    id: 'exp-query',
    type: 'expert',
    position: { x: 750, y: 570 },
    data: {
      nodeType: 'expert', label: 'Expert Query Optimization', description: 'SQL query optimization expert for execution plans, index strategies, and data access pattern design.', model: 'claude-sonnet-4-6',
      systemPrompt: 'You are a SQL query optimization expert. You analyze query execution plans, recommend optimal index strategies (covering indexes, partial indexes, composite index column ordering), identify query anti-patterns (correlated subqueries, implicit type conversions), and design efficient data access patterns for common workloads.',
      specialty: 'SQL query and index optimization',
    },
  },
  {
    id: 'exp-caching',
    type: 'expert',
    position: { x: 400, y: 570 },
    data: {
      nodeType: 'expert', label: 'Expert Caching', description: 'Caching strategy expert for HTTP, application, database, and CDN caching with invalidation design.', model: 'claude-sonnet-4-6',
      systemPrompt: 'You are a caching strategy expert. You identify opportunities for caching at every layer: HTTP response caching (Cache-Control, ETag), application-level memoization, database query caching, and CDN caching for static assets. You design cache invalidation strategies that prevent stale data while maximizing hit rates.',
      specialty: 'Caching strategies and invalidation',
    },
  },
  {
    id: 'skill-profiling',
    type: 'skill',
    position: { x: 50, y: 810 },
    data: { nodeType: 'skill', label: 'Skill Profiling', description: 'Profiles the application for bundle size, render patterns, network waterfalls, and lazy loading gaps.', command: '/profile-app', promptTemplate: 'Profile the application for performance bottlenecks. Analyze: (1) Bundle size — look for large imports, missing tree-shaking, entire libraries imported for one function, (2) Component render patterns — unnecessary re-renders from unstable references or missing memoization, (3) Network waterfall — sequential API calls that could be parallelized, (4) Lazy loading — routes and heavy components not code-split. Report each finding with estimated impact, file:line, and specific optimization.', allowedTools: ['Read', 'Glob', 'Grep', 'Bash'] },
  },
  {
    id: 'skill-benchmark',
    type: 'skill',
    position: { x: 750, y: 810 },
    data: { nodeType: 'skill', label: 'Skill Benchmarking', description: 'Runs performance benchmarks measuring API response times, query execution, build times, and memory usage.', command: '/benchmark', promptTemplate: 'Run performance benchmarks on the project. Measure: (1) API endpoint response times using curl with timing, (2) Database query execution times using EXPLAIN for SQLite or equivalent, (3) Build time and bundle sizes from the build output, (4) Memory usage patterns. Compare results against baseline thresholds and report any endpoints or queries exceeding targets. Produce a summary table with measurements.', allowedTools: ['Read', 'Bash', 'Glob', 'Grep'] },
  },
];

const perfOptEdges: SerializedEdge[] = [
  edge('agent-perf', 'sub-frontend-perf', 'delegation'),
  edge('agent-perf', 'sub-backend-perf', 'delegation'),
  edge('agent-perf', 'sub-db-perf', 'delegation'),
  edge('sub-frontend-perf', 'exp-bundle', 'delegation'),
  edge('sub-db-perf', 'exp-query', 'delegation'),
  edge('sub-backend-perf', 'exp-caching', 'delegation'),
  edge('sub-frontend-perf', 'skill-profiling', 'skill-usage'),
  edge('sub-db-perf', 'skill-benchmark', 'skill-usage'),
];

export const performanceOptimization: GraphTemplate = {
  id: 'performance-optimization',
  name: 'Performance Optimization',
  description: 'Performance lead with frontend profiler, backend profiler, and database optimizer — identifies and prioritizes bottlenecks across the entire stack.',
  category: 'analysis',
  nodes: perfOptNodes,
  edges: perfOptEdges,
};
