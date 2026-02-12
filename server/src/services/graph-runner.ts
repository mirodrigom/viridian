/**
 * Graph Execution Runner — orchestrates multi-agent graph execution.
 *
 * Resolves the graph into an execution tree, composes system prompts per node,
 * and uses Claude CLI's native --agents flag for sub-agent delegation.
 * All delegation happens through Claude's built-in Task tool — no XML parsing.
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
  agentKeyToNodeId: Map<string, string>; // agent label key → nodeId (for delegation detection)
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

// ─── Agents Config (for --agents flag) ──────────────────────────────────

interface AgentConfig {
  description: string;
  prompt: string;
  tools?: string[];
  disallowedTools?: string[];
  model?: string;
  permissionMode?: string;
  maxTurns?: number;
}

/**
 * Sanitize a node label into a valid agent key for Claude CLI's --agents flag.
 * Claude uses this key as the `subagent_type` in Task tool calls, so it must be
 * a clean, readable identifier (e.g. "BackendDev", "CodeReviewer").
 */
function toAgentKey(label: string, usedKeys: Set<string>): string {
  // Remove non-alphanumeric chars (except spaces/hyphens/underscores), then PascalCase
  let key = label
    .replace(/[^a-zA-Z0-9\s_-]/g, '')
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');

  if (!key) key = 'Agent';

  // Deduplicate: append a number if key already exists
  const base = key;
  let counter = 2;
  while (usedKeys.has(key)) {
    key = `${base}${counter++}`;
  }
  usedKeys.add(key);
  return key;
}

/**
 * Walk the delegation tree from a root node and collect ALL reachable delegate
 * nodes into a flat agents config. Sub-agents can't spawn other sub-agents in
 * Claude CLI, so we flatten the hierarchy so the root reaches all delegates.
 *
 * Returns both the agents config (keyed by readable label) and a mapping from
 * agent key → nodeId for delegation detection.
 */
function buildAgentsConfig(
  rootNodeId: string,
  resolvedNodes: Map<string, ResolvedNode>,
): { agents: Record<string, AgentConfig>; keyToNodeId: Map<string, string> } {
  const agents: Record<string, AgentConfig> = {};
  const keyToNodeId = new Map<string, string>();
  const nodeIdToKey = new Map<string, string>();
  const usedKeys = new Set<string>();
  const visited = new Set<string>();
  const queue = [rootNodeId];

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    if (visited.has(currentId)) continue;
    visited.add(currentId);

    const resolved = resolvedNodes.get(currentId);
    if (!resolved) continue;

    for (const delegate of resolved.delegates) {
      if (nodeIdToKey.has(delegate.id)) continue; // already added

      const delegateResolved = resolvedNodes.get(delegate.id);
      const prompt = composeSystemPrompt(delegateResolved || {
        node: delegate, skills: [], mcps: [], rules: [], delegates: [],
      });

      const desc = (delegate.data.description as string)
        || (delegate.data.taskDescription as string)
        || (delegate.data.specialty as string)
        || (delegate.data.label as string)
        || delegate.type;

      const label = (delegate.data.label as string) || delegate.type;
      const agentKey = toAgentKey(label, usedKeys);

      agents[agentKey] = {
        description: desc,
        prompt: prompt || `You are a ${delegate.type} agent.`,
        model: (delegate.data.model as string) || undefined,
        permissionMode: (delegate.data.permissionMode as string) || 'bypassPermissions',
      };

      keyToNodeId.set(agentKey, delegate.id);
      nodeIdToKey.set(delegate.id, agentKey);

      // Enqueue delegate's own delegates for flattening
      queue.push(delegate.id);
    }
  }

  return { agents, keyToNodeId };
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

  // Delegation is now handled by --agents flag, no XML protocol needed

  return parts.join('\n\n');
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

  // Compose system prompt (appended to Claude defaults, not replacing)
  const systemPrompt = composeSystemPrompt(resolved);

  // Build agents config from delegation edges (flattened)
  const { agents, keyToNodeId } = buildAgentsConfig(nodeId, ctx.resolvedNodes);

  // Merge key→nodeId mapping into context for delegation detection
  for (const [key, nid] of keyToNodeId) {
    ctx.agentKeyToNodeId.set(key, nid);
  }

  if (Object.keys(agents).length > 0) {
    console.log(`[GraphRunner] Node "${nodeLabel}" agents:`, JSON.stringify(Object.keys(agents)));
  }

  // Build query options
  const model = resolved.node.data.model as string || undefined;
  const permissionMode = resolved.node.data.permissionMode as string || 'bypassPermissions';
  const allowedTools = resolved.node.data.allowedTools as string[] | undefined;
  const disallowedTools = resolved.node.data.disallowedTools as string[] | undefined;

  // Track usage for this node
  let inputTokens = 0;
  let outputTokens = 0;
  let accumulatedText = '';

  try {
    const stream = claudeQuery({
      prompt,
      cwd: ctx.cwd,
      model,
      permissionMode,
      allowedTools,
      disallowedTools,
      appendSystemPrompt: systemPrompt || undefined,
      agents: Object.keys(agents).length > 0 ? agents : undefined,
      abortSignal: ctx.abortController.signal,
    });

    for await (const msg of stream) {
      if (ctx.abortController.signal.aborted) break;
      processNodeMessage(ctx, nodeId, msg, {
        onText: (text) => { accumulatedText += text; },
        onInputTokens: (t) => { inputTokens = t; },
        onOutputTokens: (t) => { outputTokens = t; },
        onSessionId: (sid) => { ctx.sessionIds.set(nodeId, sid); },
      });
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Unknown error';
    ctx.emitter.emit('node_failed', { nodeId, error });
    throw err;
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
    case 'tool_use': {
      ctx.emitter.emit('node_tool_use', {
        nodeId,
        tool: msg.tool,
        input: msg.input,
        requestId: msg.requestId,
      });
      break;
    }
    case 'tool_input_complete': {
      // Detect Task tool calls that match delegate agent keys → emit delegation event.
      // Must be done here (not in tool_use) because tool_use fires at content_block_start
      // with an empty input — the full input is only available at content_block_stop.
      if (msg.tool === 'Task') {
        const agentType = msg.input.subagent_type as string | undefined;
        if (agentType) {
          // agentType is the readable label key (e.g. "BackendDev"), resolve to nodeId
          const delegateNodeId = ctx.agentKeyToNodeId.get(agentType);
          const delegateResolved = delegateNodeId ? ctx.resolvedNodes.get(delegateNodeId) : null;
          if (delegateResolved && delegateNodeId) {
            const childLabel = delegateResolved.node.data.label as string || agentType;
            ctx.emitter.emit('delegation', {
              parentNodeId: nodeId,
              childNodeId: delegateNodeId,
              childLabel,
              task: (msg.input.prompt as string) || '',
            });
            ctx.emitter.emit('node_started', {
              nodeId: delegateNodeId,
              nodeLabel: childLabel,
              nodeType: delegateResolved.node.type,
              inputPrompt: (msg.input.prompt as string) || '',
              parentNodeId: nodeId,
            });
          }
        }
      }
      break;
    }
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
    agentKeyToNodeId: new Map(),
    sessionIds: new Map(),
    outputTexts: new Map(),
    usages: new Map(),
  };

  // Run asynchronously — defer so callers can wire listeners before events fire
  setTimeout(() => {
    emitter.emit('run_started', { runId, rootNodeId: rootNode.id });
  }, 0);

  (async () => {
    // Wait one tick so run_started is emitted first
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
    }
  })();

  return { runId, emitter, abortController };
}
