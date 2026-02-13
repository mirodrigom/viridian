/**
 * Graph Execution Runner — orchestrates multi-agent graph execution.
 *
 * Resolves the graph into an execution tree, composes system prompts per node,
 * and uses Claude CLI's native --agents flag for sub-agent delegation.
 * All delegation happens through Claude's built-in Task tool — no XML parsing.
 */

import { EventEmitter } from 'events';
import { v4 as uuid } from 'uuid';
import { appendFileSync } from 'fs';
import { claudeQuery, type SDKMessage } from './claude-sdk.js';

// Debug log to file for tracing delegation flow
const DEBUG_LOG = '/tmp/graph-runner-debug.log';
function debugLog(msg: string) {
  const ts = new Date().toISOString().slice(11, 23);
  const line = `[${ts}] ${msg}\n`;
  try { appendFileSync(DEBUG_LOG, line); } catch { /* ignore */ }
  console.log(msg);
}

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
  taskToolUseToNodeId: Map<string, string>; // Task tool_use requestId → child nodeId (for routing sub-agent events)
  sessionIds: Map<string, string>; // nodeId → Claude session ID (for --resume)
  outputTexts: Map<string, string>; // nodeId → accumulated output
  usages: Map<string, { inputTokens: number; outputTokens: number }>;
  pendingNodes: Set<string>; // nodes delegated-to but not yet producing output
  pendingNodeParents: Map<string, string>; // nodeId → callerNodeId for deferred activation
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
    const nodeLabel = (node.data.label as string) || node.id;
    debugLog(`[GraphRunner] Resolved "${nodeLabel}" (${node.type}): delegates=[${delegates.map(d => d.data.label || d.id).join(', ')}], skills=[${skills.map(s => s.data.label || s.id).join(', ')}], rules=[${rules.map(r => r.data.label || r.id).join(', ')}]`);
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
 * nodes into a flat agents config. The Claude CLI's --agents flag creates a
 * flat agent pool — any agent can Task-delegate to any other. We flatten the
 * graph hierarchy but add delegation instructions to intermediate orchestrators
 * so they know which sub-agents to delegate to (instead of doing work directly).
 *
 * Two-pass approach:
 *   Pass 1: BFS to register all delegates and build nodeIdToKey mapping
 *   Pass 2: For intermediate orchestrators (delegates with their own delegates),
 *           append delegation instructions and restrict tools to [Task, TodoWrite]
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

  // ── Pass 1: Register all delegates via BFS ──
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

      // Build a meaningful prompt for the sub-agent even if systemPrompt is empty
      let agentPrompt = prompt;
      if (!agentPrompt) {
        const role = label || delegate.type;
        const taskDesc = (delegate.data.taskDescription as string) || '';
        const specialty = (delegate.data.specialty as string) || '';
        const context = taskDesc || specialty || desc;
        agentPrompt = `You are ${role}, a specialized ${delegate.type} agent. Your role: ${context}. Focus exclusively on tasks within your specialty and execute them thoroughly.`;
      }

      // Explicitly set tools for every sub-agent. The root uses --tools to restrict
      // its own toolset, and sub-agents in --agents JSON need their own tools field
      // to ensure they have the right capabilities.
      // Default: full tool set for leaf agents. Pass 2 overrides this for orchestrators.
      const delegateAllowedTools = (delegate.data.allowedTools as string[]) || undefined;
      const defaultLeafTools = ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'TodoWrite', 'WebFetch', 'WebSearch', 'Task'];

      agents[agentKey] = {
        description: desc,
        prompt: agentPrompt,
        tools: delegateAllowedTools || defaultLeafTools,
        model: (delegate.data.model as string) || undefined,
        permissionMode: (delegate.data.permissionMode as string) || 'bypassPermissions',
      };

      keyToNodeId.set(agentKey, delegate.id);
      nodeIdToKey.set(delegate.id, agentKey);

      // Enqueue delegate's own delegates for flattening
      queue.push(delegate.id);
    }
  }

  // ── Pass 2: Add delegation instructions to intermediate orchestrators ──
  // An intermediate orchestrator is a delegate that has its OWN delegates
  // (e.g. SubagentGitHub has Expert delegates). These need:
  //   1. Delegation instructions in their prompt (so they know to use Task tool)
  //   2. Tool restrictions: only Task + TodoWrite (so they don't do work directly)
  for (const [delegateNodeId, agentKey] of nodeIdToKey) {
    const delegateResolved = resolvedNodes.get(delegateNodeId);
    if (!delegateResolved || delegateResolved.delegates.length === 0) continue;

    // This delegate has its own delegates — it's an intermediate orchestrator
    // Collect its child agents from the flat pool
    const childAgents: Record<string, AgentConfig> = {};
    for (const childDelegate of delegateResolved.delegates) {
      const childKey = nodeIdToKey.get(childDelegate.id);
      if (childKey && agents[childKey]) {
        childAgents[childKey] = agents[childKey];
      }
    }

    if (Object.keys(childAgents).length > 0) {
      // Append delegation instructions to this agent's prompt
      agents[agentKey]!.prompt = appendDelegationInstructions(
        agents[agentKey]!.prompt,
        childAgents,
      );
      // Restrict tools to force delegation
      agents[agentKey]!.tools = ['Task', 'TodoWrite'];

      const childLabel = (delegateResolved.node.data.label as string) || delegateNodeId;
      debugLog(`[GraphRunner] Intermediate orchestrator "${childLabel}" → delegates to: [${Object.keys(childAgents).join(', ')}], tools restricted to Task+TodoWrite`);
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

  // 3. Available Skills section — include full prompt templates so agents
  // can follow the skill's instructions when executing matching tasks
  if (resolved.skills.length > 0) {
    const skillSections = resolved.skills.map(s => {
      const command = s.data.command as string || '';
      const template = s.data.promptTemplate as string || '';
      const label = s.data.label as string || 'Skill';
      return `### Skill: ${label}\n**Command**: \`${command}\`\n**Instructions**:\n${template}`;
    });
    parts.push(`\n## Available Skills\nWhen executing a task that matches one of these skills, follow the skill's instructions exactly.\n\n${skillSections.join('\n\n')}`);
  }

  return parts.join('\n\n');
}

/**
 * Append explicit delegation instructions to a parent agent's system prompt.
 * Without these, Claude tends to do all work itself instead of using the Task tool
 * to delegate to its configured sub-agents.
 */
function appendDelegationInstructions(
  systemPrompt: string,
  agents: Record<string, AgentConfig>,
): string {
  const agentEntries = Object.entries(agents);
  if (agentEntries.length === 0) return systemPrompt;

  const agentList = agentEntries
    .map(([key, config]) => `- **${key}**: ${config.description}`)
    .join('\n');

  // Build an explicit whitelist of allowed subagent_type values
  const allowedNames = agentEntries.map(([key]) => `"${key}"`).join(', ');

  const delegation = `
## CRITICAL: You are an ORCHESTRATOR — you MUST delegate ALL work

You are a principal orchestrator agent. Your ONLY job is to coordinate and delegate tasks to your specialized sub-agents using the Task tool.

### Your Available Sub-Agents — ONLY use these
${agentList}

### How to Delegate
Use the Task tool with these EXACT values for \`subagent_type\`: ${allowedNames}
- Set \`subagent_type\` to one of the names above (e.g. "${agentEntries[0]![0]}")
- Set \`prompt\` to a detailed description of what the sub-agent should do
- Set \`description\` to a short summary (3-5 words)

### Rules — MANDATORY — NEVER VIOLATE
1. You MUST ONLY delegate to the sub-agents listed above: ${allowedNames}.
2. NEVER set subagent_type to "Bash", "general-purpose", "Explore", "Plan", or any agent NOT listed above. Built-in agents are FORBIDDEN.
3. NEVER execute tasks yourself. NEVER use any tool other than Task.
4. Even for simple tasks like git commits, shell commands, or file operations — you MUST delegate to the closest matching sub-agent above.
5. ALWAYS delegate to the SINGLE most relevant sub-agent first. Only delegate to additional sub-agents if the first agent's result is insufficient or the task explicitly requires multiple distinct domains.
6. For simple, focused tasks, delegate to exactly ONE sub-agent — the best match. Do NOT speculatively delegate to multiple agents in parallel.
7. After receiving results from sub-agents, synthesize and present the final answer to the user.`;

  return systemPrompt ? `${systemPrompt}\n${delegation}` : delegation.trim();
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

  // Build agents config from delegation edges (flattened)
  const { agents, keyToNodeId } = buildAgentsConfig(nodeId, ctx.resolvedNodes);

  // Merge key→nodeId mapping into context for delegation detection
  for (const [key, nid] of keyToNodeId) {
    ctx.agentKeyToNodeId.set(key, nid);
  }

  // Compose system prompt (appended to Claude defaults, not replacing)
  // Include delegation instructions if this node has sub-agents
  let systemPrompt = composeSystemPrompt(resolved);
  if (Object.keys(agents).length > 0) {
    systemPrompt = appendDelegationInstructions(systemPrompt, agents);
    debugLog(`[GraphRunner] Node "${nodeLabel}" has ${Object.keys(agents).length} agents: [${Object.keys(agents).join(', ')}]`);
  } else {
    debugLog(`[GraphRunner] Node "${nodeLabel}" has NO agents (delegates: ${resolved.delegates.length})`);
  }

  // Build query options
  const model = resolved.node.data.model as string || undefined;
  const permissionMode = resolved.node.data.permissionMode as string || 'bypassPermissions';
  const hasAgents = Object.keys(agents).length > 0;

  // Orchestrator nodes (those with sub-agents) get restricted via --tools flag
  // which REPLACES the available tool set (unlike --allowedTools which is a permission filter).
  // --tools "Task" means ONLY Task is available — no Bash, Read, etc.
  // Also disable built-in slash commands to prevent Skill tool interference.
  let tools: string[] | undefined;
  let allowedTools: string[] | undefined;
  let disallowedTools: string[] | undefined;
  if (hasAgents) {
    tools = ['Task'];
    debugLog(`[GraphRunner] Node "${nodeLabel}" is orchestrator — --tools restricted to: ${tools.join(', ')}`);
  } else {
    allowedTools = resolved.node.data.allowedTools as string[] | undefined;
    disallowedTools = resolved.node.data.disallowedTools as string[] | undefined;
  }

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
      tools,
      allowedTools,
      disallowedTools,
      disableSlashCommands: hasAgents, // prevent built-in Skill tool from interfering
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

/**
 * Resolve which graph node an SDK message belongs to.
 * Events from the root agent (parentToolUseId=null) go to `nodeId`.
 * Events from sub-agents (parentToolUseId set) go to the mapped child node.
 */
function resolveEventNodeId(
  ctx: ExecutionContext,
  rootNodeId: string,
  msg: SDKMessage,
): string {
  const ptui = 'parentToolUseId' in msg ? msg.parentToolUseId : null;
  if (!ptui) return rootNodeId;
  const childNodeId = ctx.taskToolUseToNodeId.get(ptui);
  if (!childNodeId) {
    debugLog(`[GraphRunner] WARN: parentToolUseId="${ptui}" not found in taskToolUseToNodeId (map size=${ctx.taskToolUseToNodeId.size}, keys=[${[...ctx.taskToolUseToNodeId.keys()].join(', ')}]). Falling back to root.`);
  }
  return childNodeId || rootNodeId;
}

/**
 * If a node is in the pendingNodes set (delegated but not yet activated),
 * promote it to fully active by emitting node_started and cascading downstream.
 * Returns true if the node was pending and is now activated.
 */
function activateNodeIfPending(ctx: ExecutionContext, nodeId: string): boolean {
  if (!ctx.pendingNodes.has(nodeId)) return false;
  ctx.pendingNodes.delete(nodeId);

  const resolved = ctx.resolvedNodes.get(nodeId);
  if (!resolved) return false;

  const nodeLabel = (resolved.node.data.label as string) || nodeId;
  const parentNodeId = ctx.pendingNodeParents.get(nodeId) || null;
  ctx.pendingNodeParents.delete(nodeId);

  debugLog(`[GraphRunner] Lazy activation: node "${nodeLabel}" (${nodeId}) is now active.`);

  ctx.emitter.emit('node_started', {
    nodeId,
    nodeLabel,
    nodeType: resolved.node.type,
    inputPrompt: '',
    parentNodeId,
  });

  emitDownstreamActivation(ctx, nodeId, resolved, 'started');
  return true;
}

/** Delay between each cascaded node activation (ms) */
const CASCADE_START_DELAY = 800;  // visible progression when starting
const CASCADE_COMPLETE_DELAY = 400; // faster wrap-up when completing

/**
 * Recursively activate ALL downstream nodes (delegates, skills) when a
 * sub-agent starts or completes. The Claude CLI's --agents flat pool only
 * streams first-level delegation events — deeper delegations happen opaquely.
 * So we "cascade" activation to make the entire subtree visible in the timeline.
 *
 * Uses staggered delays so the timeline shows a visible progression instead
 * of all nodes appearing at the same timestamp.
 *
 * For starts:  delegates first → recurse into their subtrees → skills last
 * For completions: skills first → recurse into subtrees → delegates last
 *                  (leaves complete before parents — natural bottom-up order)
 *
 * Returns the total number of steps scheduled (for computing final delay).
 */
function emitDownstreamActivation(
  ctx: ExecutionContext,
  parentNodeId: string,
  resolved: ResolvedNode,
  phase: 'started' | 'completed',
  visited = new Set<string>(),
  step = { value: 0 },
): number {
  const stepDelay = phase === 'started' ? CASCADE_START_DELAY : CASCADE_COMPLETE_DELAY;

  if (phase === 'started') {
    // ── Start order: delegates first, then recurse, then skills ──
    for (const delegate of resolved.delegates) {
      if (visited.has(delegate.id)) continue;
      visited.add(delegate.id);
      const delegateResolved = ctx.resolvedNodes.get(delegate.id);
      const delegateLabel = (delegate.data.label as string) || delegate.type;
      const delay = step.value++ * stepDelay;

      setTimeout(() => {
        if (ctx.abortController.signal.aborted) return;
        ctx.emitter.emit('delegation', {
          parentNodeId,
          childNodeId: delegate.id,
          childLabel: delegateLabel,
          task: '(cascaded from parent delegation)',
        });
        ctx.emitter.emit('node_started', {
          nodeId: delegate.id,
          nodeLabel: delegateLabel,
          nodeType: delegate.type,
          inputPrompt: '',
          parentNodeId,
        });
      }, delay);

      // Recurse into this delegate's subtree
      if (delegateResolved) {
        emitDownstreamActivation(ctx, delegate.id, delegateResolved, phase, visited, step);
      }
    }

    // Skills come after all delegates and their subtrees
    for (const skill of resolved.skills) {
      if (visited.has(skill.id)) continue;
      visited.add(skill.id);
      const skillLabel = (skill.data.label as string) || 'Skill';
      const delay = step.value++ * stepDelay;

      setTimeout(() => {
        if (ctx.abortController.signal.aborted) return;
        ctx.emitter.emit('node_started', {
          nodeId: skill.id,
          nodeLabel: skillLabel,
          nodeType: 'skill',
          inputPrompt: '',
          parentNodeId,
        });
      }, delay);
    }
  } else {
    // ── Complete order: skills first, then recurse into subtrees, then delegates ──
    // (leaves complete before parents — natural bottom-up order)
    for (const skill of resolved.skills) {
      if (visited.has(skill.id)) continue;
      visited.add(skill.id);
      const delay = step.value++ * stepDelay;

      setTimeout(() => {
        if (ctx.abortController.signal.aborted) return;
        ctx.emitter.emit('node_completed', {
          nodeId: skill.id,
          outputText: '',
          usage: { inputTokens: 0, outputTokens: 0 },
        });
      }, delay);
    }

    for (const delegate of resolved.delegates) {
      if (visited.has(delegate.id)) continue;
      visited.add(delegate.id);
      const delegateResolved = ctx.resolvedNodes.get(delegate.id);
      const delegateLabel = (delegate.data.label as string) || delegate.type;

      // Recurse into this delegate's subtree first (children complete before parent)
      if (delegateResolved) {
        emitDownstreamActivation(ctx, delegate.id, delegateResolved, phase, visited, step);
      }

      const delay = step.value++ * stepDelay;
      setTimeout(() => {
        if (ctx.abortController.signal.aborted) return;
        ctx.emitter.emit('node_completed', {
          nodeId: delegate.id,
          outputText: '',
          usage: { inputTokens: 0, outputTokens: 0 },
        });
        ctx.emitter.emit('result_return', {
          parentNodeId,
          childNodeId: delegate.id,
          childLabel: delegateLabel,
          result: '(completed with parent)',
        });
      }, delay);
    }
  }

  return step.value;
}

/**
 * Handle a Task tool call from any agent level — creates the parentToolUseId→nodeId
 * mapping and emits delegation + node_started events.
 * Called from both tool_use (assistant events with full input) and
 * tool_input_complete (streaming events).
 */
function handleTaskDelegation(
  ctx: ExecutionContext,
  rootNodeId: string,
  agentType: string,
  taskPrompt: string,
  requestId: string | null,
  parentToolUseId: string | null,
) {
  let delegateNodeId = ctx.agentKeyToNodeId.get(agentType);
  let delegateResolved = delegateNodeId ? ctx.resolvedNodes.get(delegateNodeId) : null;

  // Fallback: if Claude chose a built-in agent (Bash, general-purpose, etc.)
  // instead of our custom agents, route to the first available custom delegate.
  // This happens when the CLI pool includes both built-in and custom agents.
  if (!delegateResolved || !delegateNodeId) {
    const customKeys = [...ctx.agentKeyToNodeId.keys()];
    debugLog(`[GraphRunner] Task delegation: agentType="${agentType}" not found in agentKeyToNodeId (keys=[${customKeys.join(', ')}]). Attempting fallback...`);

    // Determine the caller node to find its direct delegates
    const callerNodeId = parentToolUseId
      ? (ctx.taskToolUseToNodeId.get(parentToolUseId) || rootNodeId)
      : rootNodeId;
    const callerResolved = ctx.resolvedNodes.get(callerNodeId);

    if (callerResolved && callerResolved.delegates.length > 0) {
      // Route to the first delegate of the caller
      const fallbackDelegate = callerResolved.delegates[0]!;
      const fallbackKey = customKeys.find(k => ctx.agentKeyToNodeId.get(k) === fallbackDelegate.id);
      if (fallbackKey) {
        delegateNodeId = ctx.agentKeyToNodeId.get(fallbackKey)!;
        delegateResolved = ctx.resolvedNodes.get(delegateNodeId) ?? null;
        debugLog(`[GraphRunner] Fallback: routing "${agentType}" → "${fallbackKey}" (${delegateNodeId})`);
      }
    }

    if (!delegateResolved || !delegateNodeId) {
      debugLog(`[GraphRunner] Task delegation: no fallback available, ignoring.`);
      return;
    }
  }

  // Don't double-process if this requestId was already mapped
  if (requestId && ctx.taskToolUseToNodeId.has(requestId)) return;

  const childLabel = delegateResolved.node.data.label as string || agentType;

  // Determine the caller: root Task calls (no parentToolUseId) come from
  // the root node. Nested Task calls come from whatever node owns the parentToolUseId.
  const callerNodeId = parentToolUseId
    ? (ctx.taskToolUseToNodeId.get(parentToolUseId) || rootNodeId)
    : rootNodeId;

  // Map the Task requestId → child nodeId for routing sub-agent stream events
  if (requestId) {
    ctx.taskToolUseToNodeId.set(requestId, delegateNodeId);
    debugLog(`[GraphRunner] Mapped requestId="${requestId}" → nodeId="${delegateNodeId}" (${childLabel}). Map size=${ctx.taskToolUseToNodeId.size}`);
  }

  ctx.emitter.emit('delegation', {
    parentNodeId: callerNodeId,
    childNodeId: delegateNodeId,
    childLabel,
    task: taskPrompt,
  });

  // Lazy activation: don't emit node_started yet. Instead, mark as pending
  // and emit node_delegated. The node will be activated when it produces
  // its first real output (text, tool use, or thinking).
  ctx.emitter.emit('node_delegated', {
    nodeId: delegateNodeId,
    nodeLabel: childLabel,
    nodeType: delegateResolved.node.type,
    parentNodeId: callerNodeId,
    inputPrompt: taskPrompt,
  });
  ctx.pendingNodes.add(delegateNodeId);
  ctx.pendingNodeParents.set(delegateNodeId, callerNodeId);
  debugLog(`[GraphRunner] Node "${childLabel}" (${delegateNodeId}) added to pendingNodes (lazy activation). Will activate on first content.`);
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
  // Resolve which node this event belongs to (root vs sub-agent)
  const effectiveNodeId = resolveEventNodeId(ctx, nodeId, msg);

  // Lazy activation: promote pending node on first real activity from a sub-agent
  if (effectiveNodeId !== nodeId) {
    const activationTriggers = new Set(['text_delta', 'tool_use', 'thinking_start']);
    if (activationTriggers.has(msg.type)) {
      activateNodeIfPending(ctx, effectiveNodeId);
    }
  }

  // Log non-delta messages for debugging delegation flow
  if (msg.type !== 'text_delta' && msg.type !== 'thinking_delta' && msg.type !== 'tool_input_delta') {
    debugLog(`[GraphRunner] processNodeMessage: type="${msg.type}", effectiveNode="${effectiveNodeId}", rootNode="${nodeId}"`);
  }

  switch (msg.type) {
    case 'text_delta':
      if (effectiveNodeId === nodeId) {
        callbacks.onText(msg.text);
      }
      ctx.emitter.emit('node_delta', { nodeId: effectiveNodeId, text: msg.text });
      break;
    case 'thinking_start':
      ctx.emitter.emit('node_thinking_start', { nodeId: effectiveNodeId });
      break;
    case 'thinking_delta':
      ctx.emitter.emit('node_thinking_delta', { nodeId: effectiveNodeId, text: msg.text });
      break;
    case 'thinking_end':
      ctx.emitter.emit('node_thinking_end', { nodeId: effectiveNodeId });
      break;
    case 'tool_use': {
      ctx.emitter.emit('node_tool_use', {
        nodeId: effectiveNodeId,
        tool: msg.tool,
        input: msg.input,
        requestId: msg.requestId,
      });

      // Sub-agent assistant events deliver tool_use with FULL input (not empty).
      // Detect Task calls here too, since assistant events don't emit tool_input_complete.
      if (msg.tool === 'Task') {
        const hasSubagentType = !!msg.input?.subagent_type;
        debugLog(`[GraphRunner] tool_use: tool=Task, requestId="${msg.requestId}", hasSubagentType=${hasSubagentType}, subagent_type="${msg.input?.subagent_type}", ptui=${msg.parentToolUseId ?? 'null'}`);
        if (hasSubagentType) {
          handleTaskDelegation(ctx, nodeId, msg.input.subagent_type as string, msg.input.prompt as string || '', msg.requestId, msg.parentToolUseId ?? null);
        }
      }
      break;
    }
    case 'tool_input_complete': {
      // Detect Task tool calls from streaming events (root or sub-agent).
      // Streaming tool_use has empty input; the full input arrives at tool_input_complete.
      debugLog(`[GraphRunner] tool_input_complete: tool="${msg.tool}", requestId="${msg.requestId}", inputKeys=[${Object.keys(msg.input).join(',')}], subagent_type="${msg.input.subagent_type}", ptui=${msg.parentToolUseId ?? 'null'}`);
      if (msg.tool === 'Task') {
        const agentType = msg.input.subagent_type as string | undefined;
        if (agentType) {
          handleTaskDelegation(ctx, nodeId, agentType, (msg.input.prompt as string) || '', msg.requestId, msg.parentToolUseId ?? null);
        } else {
          debugLog(`[GraphRunner] WARN: Task tool_input_complete but no subagent_type in input!`);
        }
      }
      break;
    }
    case 'subagent_result': {
      // When a sub-agent finishes, complete downstream nodes first (skills → experts),
      // then complete the sub-agent itself — creating a natural bottom-up timeline.
      debugLog(`[GraphRunner] subagent_result: toolUseId="${msg.toolUseId}", mapped=${ctx.taskToolUseToNodeId.has(msg.toolUseId)}, mapKeys=[${[...ctx.taskToolUseToNodeId.keys()].join(', ')}], content="${msg.content.slice(0, 100)}"`);
      const childNodeId = ctx.taskToolUseToNodeId.get(msg.toolUseId);
      if (childNodeId) {
        // Node was never activated — completed without producing content
        if (ctx.pendingNodes.has(childNodeId)) {
          ctx.pendingNodes.delete(childNodeId);
          ctx.pendingNodeParents.delete(childNodeId);
          debugLog(`[GraphRunner] Node "${childNodeId}" completed while still pending (no-op delegation). Emitting node_skipped.`);
          ctx.emitter.emit('node_skipped', {
            nodeId: childNodeId,
            reason: 'no_output',
          });
          break;
        }

        const childResolved = ctx.resolvedNodes.get(childNodeId);
        const childLabel = (childResolved?.node.data.label as string) || childNodeId;

        // First cascade completions to downstream nodes (with staggered delays)
        let totalSteps = 0;
        if (childResolved) {
          totalSteps = emitDownstreamActivation(ctx, childNodeId, childResolved, 'completed');
        }

        // Then complete the sub-agent itself after all downstream completions
        const finalDelay = totalSteps * CASCADE_COMPLETE_DELAY;
        setTimeout(() => {
          if (ctx.abortController.signal.aborted) return;
          ctx.emitter.emit('node_completed', {
            nodeId: childNodeId,
            outputText: msg.content,
            usage: { inputTokens: 0, outputTokens: 0 },
          });
          ctx.emitter.emit('result_return', {
            parentNodeId: nodeId,
            childNodeId,
            childLabel,
            result: msg.content.slice(0, 200),
          });
        }, finalDelay);
      }
      break;
    }
    case 'message_start': {
      const input = (msg.inputTokens || 0)
        + (msg.cacheCreationInputTokens || 0)
        + (msg.cacheReadInputTokens || 0);
      if (effectiveNodeId === nodeId) {
        callbacks.onInputTokens(input);
      }
      break;
    }
    case 'message_delta':
      if (msg.outputTokens && effectiveNodeId === nodeId) {
        callbacks.onOutputTokens(msg.outputTokens);
      }
      break;
    case 'system':
      if (msg.sessionId) callbacks.onSessionId(msg.sessionId);
      break;
    case 'result':
      if (msg.sessionId) callbacks.onSessionId(msg.sessionId);
      break;
    case 'error':
      ctx.emitter.emit('node_error', { nodeId: effectiveNodeId, error: msg.error });
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
  debugLog(`[GraphRunner] runGraph called with ${graphData.nodes.length} nodes, ${graphData.edges.length} edges, prompt="${prompt.slice(0, 100)}"`);
  debugLog(`[GraphRunner] Node types: ${graphData.nodes.map(n => `${n.data.label || n.id}(${n.type})`).join(', ')}`);
  debugLog(`[GraphRunner] Edges: ${graphData.edges.map(e => `${e.source}->${e.target} [${(e.data as Record<string, unknown>)?.edgeType || 'no-type'}]`).join(', ')}`);

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
    taskToolUseToNodeId: new Map(),
    sessionIds: new Map(),
    outputTexts: new Map(),
    usages: new Map(),
    pendingNodes: new Set(),
    pendingNodeParents: new Map(),
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
