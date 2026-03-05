/**
 * Graph Execution Runner — orchestrates multi-agent graph execution.
 *
 * Uses a tree-based recursive architecture: each executable node (agent,
 * subagent, expert) gets its own Claude CLI process. Nodes with children
 * use a two-phase approach:
 *   Phase 1 (Planning): Ask the node to analyze the task and assign subtasks
 *   Phase 2 (Synthesis): Feed children's results back for final answer
 *
 * Leaf nodes (no delegates) run a single pass.
 *
 * This file is the orchestrator entry point. Implementation details are
 * split into focused modules:
 *   - graph-utils.ts       — shared debug logging and session tracking
 *   - graph-resolver.ts    — graph resolution and root-finding
 *   - graph-prompts.ts     — system/planning/synthesis prompt composition
 *   - graph-execution.ts   — single-pass and recursive node execution
 *   - graph-environment.ts — per-node and per-run sandbox setup
 */

import { EventEmitter } from 'events';
import { v4 as uuid } from 'uuid';

// ─── Re-exports from graph-utils (preserve public API) ──────────────────

export { debugLog, isGraphRunnerSession, addGraphRunnerSessionId, deleteGraphRunnerSessionId } from './graph-utils.js';

// ─── Re-exports from sub-modules (preserve public API) ──────────────────

export { resolveExecutionGraph, findRootNode, getEdgeType } from './graph-resolver.js';
export type { GraphNode, GraphEdge, GraphData, ResolvedNode } from './graph-resolver.js';

export { composeSystemPrompt, buildPlanningPrompt, parseDelegationPlan, buildSynthesisPrompt, toAgentKey, buildChildDescriptions } from './graph-prompts.js';
export type { ChildAssignment } from './graph-prompts.js';

export { executeSinglePass, executeNode, checkTokenBudget } from './graph-execution.js';
export type { ExecutionContext } from './graph-execution.js';

export { prepareNodeEnvironment, prepareRunSandbox } from './graph-environment.js';
export type { NodeEnvironment, RunSandbox } from './graph-environment.js';

// ─── Internal imports (used by runGraph/previewGraph) ────────────────────

import { debugLog, deleteGraphRunnerSessionId } from './graph-utils.js';
import { resolveExecutionGraph, findRootNode } from './graph-resolver.js';
import { executeNode, type ExecutionContext } from './graph-execution.js';
import { prepareRunSandbox } from './graph-environment.js';

// ─── Constants ──────────────────────────────────────────────────────────

/** Default token budget for a graph run (if root node doesn't specify maxTokens) */
const DEFAULT_TOKEN_BUDGET = 1_000_000;

// ─── Execution Preview (Dry Run) ────────────────────────────────────────

export interface PreviewNode {
  nodeId: string;
  label: string;
  type: string;
  model: string;
  hasSystemPrompt: boolean;
  skills: { id: string; label: string; command: string }[];
  mcps: { id: string; label: string; serverType: string }[];
  rules: { id: string; label: string; ruleType: string }[];
  delegates: { id: string; label: string; type: string }[];
  isLeaf: boolean;
  depth: number;
}

export interface ExecutionPreview {
  rootNodeId: string;
  nodes: PreviewNode[];
  executionOrder: string[];
  tokenBudget: number;
  estimatedNodes: number;
}

/**
 * Resolve a graph into an execution preview without spawning any Claude CLI.
 * Returns the full execution tree with skills/MCP/rules per node.
 */
export function previewGraph(graphData: { nodes: Array<{ id: string; type: string; position: { x: number; y: number }; data: Record<string, unknown> }>; edges: Array<{ id: string; source: string; target: string; sourceHandle?: string; targetHandle?: string; data: Record<string, unknown> }> }): ExecutionPreview {
  const resolved = resolveExecutionGraph(graphData);
  const rootNode = findRootNode(graphData, resolved);

  if (!rootNode) {
    throw new Error('No root agent node found in graph');
  }

  const previewNodes: PreviewNode[] = [];
  const executionOrder: string[] = [];

  function walkNode(nodeId: string, depth: number) {
    const res = resolved.get(nodeId);
    if (!res) return;

    const node = res.node;
    previewNodes.push({
      nodeId: node.id,
      label: (node.data.label as string) || node.id,
      type: node.type,
      model: (node.data.model as string) || 'default',
      hasSystemPrompt: !!((node.data.systemPrompt as string) || '').trim(),
      skills: res.skills.map(s => ({
        id: s.id,
        label: (s.data.label as string) || s.id,
        command: (s.data.command as string) || '',
      })),
      mcps: res.mcps.map(m => ({
        id: m.id,
        label: (m.data.label as string) || m.id,
        serverType: (m.data.serverType as string) || 'stdio',
      })),
      rules: res.rules.map(r => ({
        id: r.id,
        label: (r.data.label as string) || r.id,
        ruleType: (r.data.ruleType as string) || 'guideline',
      })),
      delegates: res.delegates.map(d => ({
        id: d.id,
        label: (d.data.label as string) || d.id,
        type: d.type,
      })),
      isLeaf: res.delegates.length === 0,
      depth,
    });

    executionOrder.push(nodeId);

    for (const delegate of res.delegates) {
      walkNode(delegate.id, depth + 1);
    }
  }

  walkNode(rootNode.id, 0);

  const rootMaxTokens = rootNode.data.maxTokens as number | undefined;
  const tokenBudget = rootMaxTokens && rootMaxTokens > 0 ? rootMaxTokens : DEFAULT_TOKEN_BUDGET;

  return {
    rootNodeId: rootNode.id,
    nodes: previewNodes,
    executionOrder,
    tokenBudget,
    estimatedNodes: previewNodes.length,
  };
}

// ─── Public API ─────────────────────────────────────────────────────────

export interface RunContext {
  runId: string;
  emitter: EventEmitter;
  abortController: AbortController;
}

/**
 * Entry point: run a graph with a given prompt.
 * Returns a RunContext whose emitter streams all events.
 */
export function runGraph(graphData: { nodes: Array<{ id: string; type: string; position: { x: number; y: number }; data: Record<string, unknown> }>; edges: Array<{ id: string; source: string; target: string; sourceHandle?: string; targetHandle?: string; data: Record<string, unknown> }> }, prompt: string, cwd: string, options?: { strictRouting?: boolean }): RunContext {
  debugLog(`[GraphRunner] runGraph called with ${graphData.nodes.length} nodes, ${graphData.edges.length} edges, prompt="${prompt.slice(0, 100)}"`);
  debugLog(`[GraphRunner] Node types: ${graphData.nodes.map(n => `${n.data.label || n.id}(${n.type})`).join(', ')}`);
  debugLog(`[GraphRunner] Edges: ${graphData.edges.map(e => `${e.source}->${e.target} [${(e.data as Record<string, unknown>)?.edgeType || 'no-type'}]`).join(', ')}`);

  const runId = uuid();
  const emitter = new EventEmitter();
  const abortController = new AbortController();

  const resolved = resolveExecutionGraph(graphData, { strictRouting: options?.strictRouting });
  const rootNode = findRootNode(graphData, resolved);

  if (!rootNode) {
    setTimeout(() => {
      emitter.emit('run_failed', { runId, error: 'No root agent node found in graph' });
    }, 0);
    return { runId, emitter, abortController };
  }

  // Create run-level sandbox in /tmp
  const sandbox = prepareRunSandbox(runId, cwd);

  // Extract token budget from root node's maxTokens (or use default)
  const rootMaxTokens = rootNode.data.maxTokens as number | undefined;
  const tokenBudget = rootMaxTokens && rootMaxTokens > 0 ? rootMaxTokens : DEFAULT_TOKEN_BUDGET;
  debugLog(`[GraphRunner] Token budget for run: ${tokenBudget.toLocaleString()} tokens (source: ${rootMaxTokens ? 'root node maxTokens' : 'default'})`);

  const ctx: ExecutionContext = {
    runId,
    cwd: sandbox.projectMirrorDir,
    emitter,
    abortController,
    resolvedNodes: resolved,
    sessionIds: new Map(),
    outputTexts: new Map(),
    usages: new Map(),
    nodeEnvs: new Map(),
    sandbox,
    tokenBudget,
    totalTokensUsed: 0,
    budgetWarningEmitted: false,
  };

  // Emit run_started asynchronously
  setTimeout(() => {
    emitter.emit('run_started', { runId, rootNodeId: rootNode.id });
  }, 0);

  (async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
    try {
      const finalOutput = await executeNode(ctx, rootNode.id, prompt, null);
      emitter.emit('run_completed', { runId, finalOutput });
    } catch (err) {
      if (abortController.signal.aborted) {
        emitter.emit('run_aborted', { runId });
      } else {
        const error = err instanceof Error ? err.message : 'Unknown error';
        emitter.emit('run_failed', { runId, error });
      }
    } finally {
      // Clean up tracked session IDs
      for (const sid of ctx.sessionIds.values()) {
        deleteGraphRunnerSessionId(sid);
      }
      // Clean up all per-node tmpdirs
      for (const env of ctx.nodeEnvs.values()) {
        env.cleanup();
      }
      // Clean up run sandbox
      sandbox.cleanup();
    }
  })();

  return { runId, emitter, abortController };
}
