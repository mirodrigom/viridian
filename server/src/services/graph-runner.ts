/**
 * Graph Execution Runner — orchestrates multi-agent graph execution.
 *
 * Resolves the graph into an execution tree, composes system prompts per node,
 * spawns Claude CLI sessions, intercepts delegation requests, routes them to
 * child nodes, and streams all events via EventEmitter.
 */

import { EventEmitter } from 'events';
import { v4 as uuid } from 'uuid';
import { claudeQuery, type SDKMessage } from './claude-sdk.js';

// ─── Types ──────────────────────────────────────────────────────────────

interface GraphNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: Record<string, unknown>;
}

interface GraphEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  data: Record<string, unknown>;
}

interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/** Resolved node with all connections pre-computed */
interface ResolvedNode {
  node: GraphNode;
  skills: GraphNode[];
  mcps: GraphNode[];
  rules: GraphNode[];
  delegates: GraphNode[]; // child agents connected via delegation edges
}

interface ExecutionContext {
  runId: string;
  cwd: string;
  emitter: EventEmitter;
  abortController: AbortController;
  resolvedNodes: Map<string, ResolvedNode>;
  sessionIds: Map<string, string>; // nodeId → Claude session ID (for --resume)
  outputTexts: Map<string, string>; // nodeId → accumulated output
  usages: Map<string, { inputTokens: number; outputTokens: number }>;
}

// ─── Graph Resolution ───────────────────────────────────────────────────

function getEdgeType(edge: GraphEdge): string {
  return (edge.data?.edgeType as string) || 'unknown';
}

/**
 * Walk the graph to resolve each executable node's connections.
 * Returns a Map of nodeId → ResolvedNode.
 */
export function resolveExecutionGraph(graphData: GraphData): Map<string, ResolvedNode> {
  const nodesById = new Map<string, GraphNode>();
  for (const node of graphData.nodes) {
    nodesById.set(node.id, node);
  }

  const resolved = new Map<string, ResolvedNode>();

  // Only resolve executable nodes (agent, subagent, expert)
  const executableTypes = new Set(['agent', 'subagent', 'expert']);

  for (const node of graphData.nodes) {
    if (!executableTypes.has(node.type)) continue;

    const skills: GraphNode[] = [];
    const mcps: GraphNode[] = [];
    const rules: GraphNode[] = [];
    const delegates: GraphNode[] = [];

    // Find all outgoing edges from this node
    for (const edge of graphData.edges) {
      if (edge.source !== node.id) continue;
      const target = nodesById.get(edge.target);
      if (!target) continue;

      const edgeType = getEdgeType(edge);
      switch (edgeType) {
        case 'delegation':
          delegates.push(target);
          break;
        case 'skill-usage':
          skills.push(target);
          break;
        case 'tool-access':
          mcps.push(target);
          break;
        case 'rule-constraint':
          rules.push(target);
          break;
      }
    }

    resolved.set(node.id, { node, skills, mcps, rules, delegates });
  }

  return resolved;
}

/**
 * Find the root node: an executable node with no incoming delegation edges.
 */
export function findRootNode(graphData: GraphData, resolved: Map<string, ResolvedNode>): GraphNode | null {
  // Collect all nodes that are delegation targets
  const delegationTargets = new Set<string>();
  for (const edge of graphData.edges) {
    if (getEdgeType(edge) === 'delegation') {
      delegationTargets.add(edge.target);
    }
  }

  // Find executable nodes that are NOT delegation targets
  const roots: GraphNode[] = [];
  for (const [nodeId, res] of resolved) {
    if (!delegationTargets.has(nodeId)) {
      roots.push(res.node);
    }
  }

  // Prefer 'agent' type roots over subagent/expert
  const agentRoot = roots.find(n => n.type === 'agent');
  return agentRoot || roots[0] || null;
}

// ─── System Prompt Composition ──────────────────────────────────────────

function composeSystemPrompt(resolved: ResolvedNode): string {
  const parts: string[] = [];

  // 1. Node's own system prompt
  const ownPrompt = resolved.node.data.systemPrompt as string || '';
  if (ownPrompt) {
    parts.push(ownPrompt);
  }

  // 2. Rules section
  if (resolved.rules.length > 0) {
    const ruleLines = resolved.rules.map(r => {
      const ruleType = (r.data.ruleType as string || 'guideline').toUpperCase();
      const ruleText = r.data.ruleText as string || '';
      return `- [${ruleType}] ${r.data.label || 'Rule'}: ${ruleText}`;
    });
    parts.push(`\n## Rules\n${ruleLines.join('\n')}`);
  }

  // 3. Available Skills section
  if (resolved.skills.length > 0) {
    const skillLines = resolved.skills.map(s => {
      const command = s.data.command as string || '';
      const template = s.data.promptTemplate as string || '';
      return `- **${s.data.label || 'Skill'}** (${command}): ${template.slice(0, 200)}`;
    });
    parts.push(`\n## Available Skills\n${skillLines.join('\n')}`);
  }

  // 4. Delegation section (only if there are delegates)
  if (resolved.delegates.length > 0) {
    const delegateLines = resolved.delegates.map(d => {
      const desc = d.data.description as string || d.data.taskDescription as string || d.data.specialty as string || '';
      return `- **${d.data.label || d.type}** (id: \`${d.id}\`): ${desc || 'No description'}`;
    });

    parts.push(`\n## Available Delegates\nYou can delegate tasks to the following agents:\n${delegateLines.join('\n')}`);

    parts.push(`\n## Delegation Protocol
When you need to delegate a task to one of your available delegates, output a delegation block in this exact format:

<delegate target="nodeId">
Describe the task you want the delegate to perform here.
</delegate>

Rules:
- Replace "nodeId" with the actual id of the delegate (shown above)
- You can delegate to multiple agents in a single response — use one <delegate> block per delegation
- After delegating, STOP your response and wait. The orchestrator will execute the delegate and return results to you
- You will receive the delegate's response and can then continue your work
- Only delegate when the task genuinely requires the delegate's capabilities`);
  }

  return parts.join('\n\n');
}

// ─── Delegation Parsing ─────────────────────────────────────────────────

interface DelegationRequest {
  targetNodeId: string;
  task: string;
}

function parseDelegations(text: string): DelegationRequest[] {
  const delegations: DelegationRequest[] = [];
  const regex = /<delegate\s+target="([^"]+)">([\s\S]*?)<\/delegate>/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    delegations.push({
      targetNodeId: match[1]!,
      task: match[2]!.trim(),
    });
  }
  return delegations;
}

// ─── Node Execution ─────────────────────────────────────────────────────

async function executeNode(
  ctx: ExecutionContext,
  nodeId: string,
  prompt: string,
  parentNodeId: string | null,
): Promise<string> {
  const resolved = ctx.resolvedNodes.get(nodeId);
  if (!resolved) {
    throw new Error(`Node ${nodeId} not found in resolved graph`);
  }

  const nodeLabel = resolved.node.data.label as string || nodeId;
  const nodeType = resolved.node.type;

  // Emit node_started
  ctx.emitter.emit('node_started', {
    nodeId,
    nodeLabel,
    nodeType,
    inputPrompt: prompt,
    parentNodeId,
  });

  // Compose system prompt
  const systemPrompt = composeSystemPrompt(resolved);

  // Build query options
  const model = resolved.node.data.model as string || undefined;
  const permissionMode = resolved.node.data.permissionMode as string || 'bypassPermissions';
  const allowedTools = resolved.node.data.allowedTools as string[] | undefined;
  const disallowedTools = resolved.node.data.disallowedTools as string[] | undefined;

  // Track usage for this node
  let inputTokens = 0;
  let outputTokens = 0;
  let accumulatedText = '';
  let sessionId = ctx.sessionIds.get(nodeId);

  try {
    const stream = claudeQuery({
      prompt,
      cwd: ctx.cwd,
      model,
      permissionMode,
      sessionId,
      allowedTools,
      disallowedTools,
      systemPrompt: systemPrompt || undefined,
      abortSignal: ctx.abortController.signal,
    });

    for await (const msg of stream) {
      if (ctx.abortController.signal.aborted) break;
      processNodeMessage(ctx, nodeId, msg, {
        onText: (text) => { accumulatedText += text; },
        onInputTokens: (t) => { inputTokens = t; },
        onOutputTokens: (t) => { outputTokens = t; },
        onSessionId: (sid) => { ctx.sessionIds.set(nodeId, sid); sessionId = sid; },
      });
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Unknown error';
    ctx.emitter.emit('node_failed', { nodeId, error });
    throw err;
  }

  // Check for delegations in the output
  const delegations = parseDelegations(accumulatedText);

  if (delegations.length > 0) {
    // Execute delegations sequentially
    const delegationResults: { childLabel: string; childId: string; result: string }[] = [];

    for (const delegation of delegations) {
      const childResolved = ctx.resolvedNodes.get(delegation.targetNodeId);
      if (!childResolved) {
        ctx.emitter.emit('node_failed', {
          nodeId: delegation.targetNodeId,
          error: `Delegation target ${delegation.targetNodeId} not found`,
        });
        continue;
      }

      const childLabel = childResolved.node.data.label as string || delegation.targetNodeId;

      // Emit delegation event
      ctx.emitter.emit('delegation', {
        parentNodeId: nodeId,
        childNodeId: delegation.targetNodeId,
        childLabel,
        task: delegation.task,
      });

      try {
        // Recursively execute the child node
        const childResult = await executeNode(ctx, delegation.targetNodeId, delegation.task, nodeId);

        // Emit result_return event
        ctx.emitter.emit('result_return', {
          parentNodeId: nodeId,
          childNodeId: delegation.targetNodeId,
          childLabel,
          result: childResult,
        });

        delegationResults.push({ childLabel, childId: delegation.targetNodeId, result: childResult });
      } catch (err) {
        const error = err instanceof Error ? err.message : 'Delegation failed';
        delegationResults.push({ childLabel, childId: delegation.targetNodeId, result: `[ERROR] ${error}` });
      }
    }

    // Re-prompt the parent with child results using --resume
    const resultsPrompt = delegationResults.map(r =>
      `## Results from ${r.childLabel} (${r.childId})\n\n${r.result}`,
    ).join('\n\n---\n\n');

    const resumePrompt = `The following delegates have completed their tasks. Review their results and continue:\n\n${resultsPrompt}`;

    // Recursive call with resume — the node keeps its session
    try {
      const resumeStream = claudeQuery({
        prompt: resumePrompt,
        cwd: ctx.cwd,
        model,
        permissionMode,
        sessionId,
        allowedTools,
        disallowedTools,
        abortSignal: ctx.abortController.signal,
      });

      let resumeText = '';
      for await (const msg of resumeStream) {
        if (ctx.abortController.signal.aborted) break;
        processNodeMessage(ctx, nodeId, msg, {
          onText: (text) => { resumeText += text; accumulatedText += text; },
          onInputTokens: (t) => { inputTokens += t; },
          onOutputTokens: (t) => { outputTokens += t; },
          onSessionId: (sid) => { ctx.sessionIds.set(nodeId, sid); },
        });
      }

      // Check for further delegations (recursive)
      const furtherDelegations = parseDelegations(resumeText);
      if (furtherDelegations.length > 0) {
        // For safety, limit delegation depth — just log a warning for now
        ctx.emitter.emit('node_delta', {
          nodeId,
          text: '\n\n[Runner: Further delegation detected but skipped to prevent infinite loops]\n',
        });
      }
    } catch (err) {
      // Resume failed, but we already have the initial output
      const error = err instanceof Error ? err.message : 'Resume failed';
      ctx.emitter.emit('node_delta', { nodeId, text: `\n\n[Resume error: ${error}]\n` });
    }
  }

  // Store final output
  ctx.outputTexts.set(nodeId, accumulatedText);
  ctx.usages.set(nodeId, { inputTokens, outputTokens });

  // Emit node_completed
  ctx.emitter.emit('node_completed', {
    nodeId,
    outputText: accumulatedText,
    usage: { inputTokens, outputTokens },
  });

  return accumulatedText;
}

/** Process a single SDK message and emit appropriate events. */
function processNodeMessage(
  ctx: ExecutionContext,
  nodeId: string,
  msg: SDKMessage,
  callbacks: {
    onText: (text: string) => void;
    onInputTokens: (tokens: number) => void;
    onOutputTokens: (tokens: number) => void;
    onSessionId: (sessionId: string) => void;
  },
) {
  switch (msg.type) {
    case 'text_delta':
      callbacks.onText(msg.text);
      ctx.emitter.emit('node_delta', { nodeId, text: msg.text });
      break;
    case 'thinking_start':
      ctx.emitter.emit('node_thinking_start', { nodeId });
      break;
    case 'thinking_delta':
      ctx.emitter.emit('node_thinking_delta', { nodeId, text: msg.text });
      break;
    case 'thinking_end':
      ctx.emitter.emit('node_thinking_end', { nodeId });
      break;
    case 'tool_use':
      ctx.emitter.emit('node_tool_use', {
        nodeId,
        tool: msg.tool,
        input: msg.input,
        requestId: msg.requestId,
      });
      break;
    case 'message_start': {
      const input = (msg.inputTokens || 0)
        + (msg.cacheCreationInputTokens || 0)
        + (msg.cacheReadInputTokens || 0);
      callbacks.onInputTokens(input);
      break;
    }
    case 'message_delta':
      if (msg.outputTokens) callbacks.onOutputTokens(msg.outputTokens);
      break;
    case 'system':
      if (msg.sessionId) callbacks.onSessionId(msg.sessionId);
      break;
    case 'result':
      if (msg.sessionId) callbacks.onSessionId(msg.sessionId);
      break;
    case 'error':
      ctx.emitter.emit('node_error', { nodeId, error: msg.error });
      break;
  }
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
export function runGraph(graphData: GraphData, prompt: string, cwd: string): RunContext {
  const runId = uuid();
  const emitter = new EventEmitter();
  const abortController = new AbortController();

  const resolved = resolveExecutionGraph(graphData);
  const rootNode = findRootNode(graphData, resolved);

  if (!rootNode) {
    // Emit error asynchronously so caller can wire listeners first
    setTimeout(() => {
      emitter.emit('run_failed', { runId, error: 'No root agent node found in graph' });
    }, 0);
    return { runId, emitter, abortController };
  }

  const ctx: ExecutionContext = {
    runId,
    cwd,
    emitter,
    abortController,
    resolvedNodes: resolved,
    sessionIds: new Map(),
    outputTexts: new Map(),
    usages: new Map(),
  };

  // Emit run_started
  emitter.emit('run_started', { runId, rootNodeId: rootNode.id });

  // Run asynchronously
  (async () => {
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
    }
  })();

  return { runId, emitter, abortController };
}
