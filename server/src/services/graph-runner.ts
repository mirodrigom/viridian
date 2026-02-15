/**
 * Graph Execution Runner — orchestrates multi-agent graph execution.
 *
 * Resolves the graph into an execution tree, composes system prompts per node,
 * and uses Claude CLI's native --agents flag for sub-agent delegation.
 * All delegation happens through Claude's built-in Task tool — no XML parsing.
 */

import { EventEmitter } from 'events';
import { v4 as uuid } from 'uuid';
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { claudeQuery, type SDKMessage } from './claude-sdk.js';

// Debug log to file for tracing delegation flow
const DEBUG_LOG = '/tmp/graph-runner-debug.log';
function debugLog(msg: string) {
  const ts = new Date().toISOString().slice(11, 23);
  const line = `[${ts}] ${msg}\n`;
  try { appendFileSync(DEBUG_LOG, line); } catch { /* ignore */ }
  console.log(msg);
}

/**
 * Set of Claude CLI session IDs created by graph runner executions.
 * Used to filter these sessions out of the chat sidebar listing.
 */
const graphRunnerSessionIds = new Set<string>();

/** Check if a Claude session ID belongs to a graph runner execution. */
export function isGraphRunnerSession(claudeSessionId: string): boolean {
  return graphRunnerSessionIds.has(claudeSessionId);
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

/** Temporary environment created per graph run for native CLAUDE.md + .mcp.json */
interface RunEnvironment {
  tmpDir: string | null;       // null if no tmpdir needed (no rules/mcps)
  effectiveCwd: string;        // tmpDir or original cwd
  realProjectPath: string;     // original cwd (for project file access)
  cleanup: () => void;
}

/** Default token budget for a graph run (if root node doesn't specify maxTokens) */
const DEFAULT_TOKEN_BUDGET = 500_000;
/** Emit a budget_warning event at this fraction of the budget */
const BUDGET_WARNING_THRESHOLD = 0.8;

interface ExecutionContext {
  runId: string;
  cwd: string;
  env: RunEnvironment;
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
  // Token budget tracking
  tokenBudget: number;           // max total tokens for this run
  totalTokensUsed: number;       // running total across all nodes
  budgetWarningEmitted: boolean; // whether 80% warning was already emitted
}

// ─── Run Environment (tmpdir with CLAUDE.md + .mcp.json) ────────────────

/**
 * Create a temporary directory with CLAUDE.md and .mcp.json generated from
 * the graph's Rule and MCP nodes. Claude CLI auto-discovers these files from
 * its cwd, making rules and MCP servers native instead of text-injected.
 */
function prepareRunEnvironment(
  resolved: Map<string, ResolvedNode>,
  originalCwd: string,
): RunEnvironment {
  // Collect all rules and MCP servers across all resolved nodes
  const allRules: { ruleType: string; label: string; ruleText: string }[] = [];
  const allMcps: { node: GraphNode }[] = [];

  for (const [, res] of resolved) {
    for (const r of res.rules) {
      allRules.push({
        ruleType: (r.data.ruleType as string) || 'guideline',
        label: (r.data.label as string) || 'Rule',
        ruleText: (r.data.ruleText as string) || '',
      });
    }
    for (const m of res.mcps) {
      allMcps.push({ node: m });
    }
  }

  // No rules or MCPs → no tmpdir needed
  if (allRules.length === 0 && allMcps.length === 0) {
    return {
      tmpDir: null,
      effectiveCwd: originalCwd,
      realProjectPath: originalCwd,
      cleanup: () => {},
    };
  }

  const tmpDir = mkdtempSync(join(tmpdir(), 'graph-run-'));
  debugLog(`[GraphRunner] Created tmpdir: ${tmpDir} (rules=${allRules.length}, mcps=${allMcps.length})`);

  // Write CLAUDE.md with rules
  if (allRules.length > 0) {
    const ruleLines = allRules.map(r =>
      `- [${r.ruleType.toUpperCase()}] ${r.label}: ${r.ruleText}`
    );
    const claudeMd = `# Graph Runner Rules\n\n${ruleLines.join('\n')}\n`;
    writeFileSync(join(tmpDir, 'CLAUDE.md'), claudeMd, 'utf8');
    debugLog(`[GraphRunner] Wrote CLAUDE.md with ${allRules.length} rules`);
  }

  // Write .mcp.json with MCP servers
  if (allMcps.length > 0) {
    const mcpServers: Record<string, Record<string, unknown>> = {};
    for (const { node } of allMcps) {
      const name = ((node.data.label as string) || `mcp-${node.id}`)
        .replace(/\s+/g, '-')
        .toLowerCase();
      const serverType = node.data.serverType as string;

      if (serverType === 'stdio') {
        mcpServers[name] = {
          type: 'stdio',
          command: node.data.command as string,
          args: (node.data.args as string[]) || [],
          ...(node.data.env ? { env: node.data.env } : {}),
        };
      } else {
        // 'sse' or 'http'
        mcpServers[name] = {
          type: serverType,
          url: node.data.url as string,
          ...(node.data.headers ? { headers: node.data.headers } : {}),
        };
      }
    }
    writeFileSync(
      join(tmpDir, '.mcp.json'),
      JSON.stringify({ mcpServers }, null, 2),
      'utf8',
    );
    debugLog(`[GraphRunner] Wrote .mcp.json with ${Object.keys(mcpServers).length} servers`);
  }

  return {
    tmpDir,
    effectiveCwd: tmpDir,
    realProjectPath: originalCwd,
    cleanup: () => {
      try {
        rmSync(tmpDir, { recursive: true, force: true });
        debugLog(`[GraphRunner] Cleaned up tmpdir: ${tmpDir}`);
      } catch (err) { console.warn('[GraphRunner] tmpdir cleanup failed:', err); }
    },
  };
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
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
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
  composeOpts?: { skipRules?: boolean; projectPath?: string },
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
      }, composeOpts);

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
      // No Task tool — nested delegation doesn't work in CLI's flat agent pool.
      const defaultLeafTools = ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'TodoWrite', 'WebFetch', 'WebSearch'];
      const delegateAllowedTools = (delegate.data.allowedTools as string[]) || undefined;
      const agentTools = delegateAllowedTools || defaultLeafTools;

      // Add universal instructions for all sub-agents
      agentPrompt += `\n\nIMPORTANT INSTRUCTIONS:
- Focus on the specific task you receive. Only perform work relevant to the user's actual request.
- If your role description mentions "delegating" to other agents, IGNORE that — do the work yourself directly using your tools.
- Your available tools are (case-sensitive, use EXACTLY these names): ${agentTools.join(', ')}
- To read files use Read (NOT cat, read_file, or file_read)
- To run commands use Bash (NOT bash, shell, or execute)
- To search files use Glob and Grep (NOT find or grep)
- Do NOT use tools named: Task, read_file, file_read, cat, bash, shell, execute, run_command, view_file, LS`;

      agents[agentKey] = {
        description: desc,
        prompt: agentPrompt,
        tools: delegateAllowedTools || defaultLeafTools,
        // NOTE: Do NOT pass `model` here — Claude CLI v2.1.x silently fails to
        // register ANY custom agents when the `model` field is present in the
        // --agents JSON. Sub-agents inherit the root's model by default.
        permissionMode: (delegate.data.permissionMode as string) || 'bypassPermissions',
        maxTurns: (delegate.data.maxTurns as number) || 25,
      };

      keyToNodeId.set(agentKey, delegate.id);
      nodeIdToKey.set(delegate.id, agentKey);

      // Enqueue delegate's own delegates for flattening
      queue.push(delegate.id);
    }
  }

  // NOTE: Pass 2 (intermediate orchestrator delegation) is intentionally removed.
  // Claude CLI's flat agent pool does NOT support nested delegation — sub-agents
  // calling Task to invoke other sub-agents always results in "Skipped: no_output".
  // Only the root orchestrator can delegate via Task. All sub-agents should do
  // work directly with their own tools (Read, Bash, Grep, etc.).

  return { agents, keyToNodeId };
}

// ─── System Prompt Composition ──────────────────────────────────────────

function composeSystemPrompt(
  resolved: ResolvedNode,
  opts?: { skipRules?: boolean; projectPath?: string },
): string {
  const parts: string[] = [];

  // 0. Project path instruction — always included so agents know where files are
  if (opts?.projectPath) {
    parts.push(`IMPORTANT: The project you are working on is located at: ${opts.projectPath}\nYou MUST use absolute paths (starting with ${opts.projectPath}) when reading, editing, creating, or searching project files. Do NOT use relative paths.`);
  }

  // 1. Node's own system prompt
  const ownPrompt = resolved.node.data.systemPrompt as string || '';
  if (ownPrompt) {
    parts.push(ownPrompt);
  }

  // 2. Rules section (skipped when rules are in CLAUDE.md via tmpdir)
  if (!opts?.skipRules && resolved.rules.length > 0) {
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
## YOU ARE AN ORCHESTRATOR — DELEGATE VIA TASK TOOL

You are a coordinator. You have NO tools except Task. You CANNOT read files, write code, or run commands.
Your ONLY capability is delegating to sub-agents via the Task tool.

### Your Sub-Agents
${agentList}

### How to Delegate
Call the Task tool with:
- \`subagent_type\`: one of ${allowedNames}
- \`prompt\`: detailed instructions for the sub-agent
- \`description\`: short summary (3-5 words)

Example:
\`\`\`json
{"subagent_type": "${agentEntries[0]![0]}", "prompt": "Do X, Y, Z...", "description": "Handle the task"}
\`\`\`

### CRITICAL RULES
1. The \`subagent_type\` parameter MUST be EXACTLY one of: ${allowedNames}. These are CASE-SENSITIVE.
2. NEVER use built-in agent types like "general-purpose", "Bash", "Explore", "Plan", etc. Those will FAIL.
3. NEVER try to do work directly — you have no tools for it.
4. Only delegate to sub-agents whose specialty is RELEVANT to the user's request. Do NOT use all agents — only the ones needed.
5. For simple tasks, a single sub-agent may be enough. Do NOT over-delegate.
6. After receiving results, synthesize and present the final answer.`;

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

  // Compose options: skip rules in system prompt when they're in CLAUDE.md (tmpdir),
  // and ALWAYS provide the project path so agents know where to find files.
  // This is critical because sub-agents in the --agents pool may not inherit
  // the correct cwd, and even when they do, explicit paths prevent confusion.
  const composeOpts = {
    skipRules: !!ctx.env.tmpDir,
    projectPath: ctx.env.realProjectPath,
  };

  // Build agents config from delegation edges (flattened)
  const { agents, keyToNodeId } = buildAgentsConfig(nodeId, ctx.resolvedNodes, composeOpts);

  // Merge key→nodeId mapping into context for delegation detection
  for (const [key, nid] of keyToNodeId) {
    ctx.agentKeyToNodeId.set(key, nid);
  }

  // Compose system prompt and configure orchestrator behavior
  let systemPrompt = composeSystemPrompt(resolved, composeOpts);
  const hasAgents = Object.keys(agents).length > 0;

  // Always use --append-system-prompt to augment Claude's defaults (never replace them).
  // Orchestrators and leaf agents both benefit from Claude's built-in instructions.
  let useAppendSystemPrompt: string | undefined;
  let effectivePrompt = prompt;

  if (hasAgents) {
    // Only show the root's DIRECT children in delegation instructions,
    // not the entire flattened pool. This prevents the root from bypassing
    // intermediate orchestrators and delegating directly to leaf experts.
    const directChildAgents: Record<string, AgentConfig> = {};
    for (const delegate of resolved.delegates) {
      const childKey = [...keyToNodeId.entries()].find(([, nid]) => nid === delegate.id)?.[0];
      if (childKey && agents[childKey]) {
        directChildAgents[childKey] = agents[childKey];
      }
    }
    const agentsForPrompt = Object.keys(directChildAgents).length > 0 ? directChildAgents : agents;

    systemPrompt = appendDelegationInstructions(systemPrompt, agentsForPrompt);
    // Use --append-system-prompt (not --system-prompt) to preserve Claude's defaults.
    // Claude needs its built-in tool usage instructions even for orchestrators.
    useAppendSystemPrompt = systemPrompt;
    // Wrap the user prompt so the orchestrator knows it must delegate.
    // Reinforce custom agent names to prevent using built-in types.
    const agentNames = Object.keys(agentsForPrompt).map(k => `"${k}"`).join(', ');
    effectivePrompt = `TASK-DRIVEN DELEGATION: Read the user's task below carefully. Delegate ONLY to sub-agents whose specialty is directly relevant to what the user is asking for. Ignore any fixed process or numbered steps in your system prompt — the user's actual request decides which agents to use and how many. For a simple task, one sub-agent is enough.\n\nYour subagent_type values are EXACTLY: ${agentNames}. Do NOT use "general-purpose" or any other built-in type.\n\nIMPORTANT: Do NOT retry or re-delegate to the same sub-agent. Each sub-agent runs once. Accept the result and synthesize your final answer from it. If a result is incomplete, present what you have — do NOT call the same agent again.\n\n---\n\nUSER TASK: ${prompt}`;
    debugLog(`[GraphRunner] Node "${nodeLabel}" has ${Object.keys(agents).length} agents in pool: [${Object.keys(agents).join(', ')}], direct children for prompt: [${Object.keys(agentsForPrompt).join(', ')}]`);
  } else {
    useAppendSystemPrompt = systemPrompt || undefined;
    debugLog(`[GraphRunner] Node "${nodeLabel}" has NO agents (delegates: ${resolved.delegates.length})`);
  }

  // Build query options
  const model = resolved.node.data.model as string || undefined;
  const permissionMode = resolved.node.data.permissionMode as string || 'bypassPermissions';

  // Orchestrator nodes (those with sub-agents) get restricted via --tools flag
  // which REPLACES the available tool set (unlike --allowedTools which is a permission filter).
  // --tools "Task" means ONLY Task is available — no Bash, Read, etc.
  // Also disable built-in slash commands to prevent Skill tool interference.
  let tools: string[] | undefined;
  let allowedTools: string[] | undefined;
  let disallowedTools: string[] | undefined;
  if (hasAgents) {
    // NOTE: Do NOT use --tools to restrict root to Task,TodoWrite.
    // --tools is a GLOBAL restriction that also applies to sub-agents,
    // preventing them from using Read, Bash, Glob, etc. even if their
    // individual agent config specifies those tools.
    // Instead, rely on the system prompt to make the root only use Task.
    // Sub-agents need full tool access to do their work.
    debugLog(`[GraphRunner] Node "${nodeLabel}" is orchestrator — no --tools restriction (sub-agents need tool access)`);
  } else {
    allowedTools = resolved.node.data.allowedTools as string[] | undefined;
    disallowedTools = resolved.node.data.disallowedTools as string[] | undefined;
  }

  // Track usage for this node
  let inputTokens = 0;
  let outputTokens = 0;
  let accumulatedText = '';

  // Timeout: abort node if it runs longer than NODE_EXECUTION_TIMEOUT
  let nodeTimeout: ReturnType<typeof setTimeout> | null = null;
  let lastActivityAt = Date.now();

  try {
    const stream = claudeQuery({
      prompt: effectivePrompt,
      cwd: ctx.env.effectiveCwd,
      model,
      permissionMode,
      tools,
      allowedTools,
      disallowedTools,
      disableSlashCommands: hasAgents, // prevent built-in Skill tool from interfering
      appendSystemPrompt: useAppendSystemPrompt,
      agents: hasAgents ? agents : undefined,
      abortSignal: ctx.abortController.signal,
    });

    // Start a periodic check for inactivity (every 60s)
    nodeTimeout = setInterval(() => {
      const elapsed = Date.now() - lastActivityAt;
      if (elapsed > NODE_EXECUTION_TIMEOUT) {
        debugLog(`[GraphRunner] Node "${nodeLabel}" (${nodeId}) timed out after ${Math.round(elapsed / 1000)}s of inactivity. Aborting run.`);
        ctx.emitter.emit('node_error', { nodeId, error: `Node timed out after ${Math.round(NODE_EXECUTION_TIMEOUT / 60000)} minutes of inactivity` });
        ctx.abortController.abort();
      }
    }, 60_000);

    for await (const msg of stream) {
      if (ctx.abortController.signal.aborted) break;
      lastActivityAt = Date.now();
      processNodeMessage(ctx, nodeId, msg, {
        onText: (text) => { accumulatedText += text; },
        onInputTokens: (t) => { inputTokens = t; },
        onOutputTokens: (t) => { outputTokens = t; },
        onSessionId: (sid) => {
          ctx.sessionIds.set(nodeId, sid);
          graphRunnerSessionIds.add(sid);
        },
      });
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Unknown error';
    ctx.emitter.emit('node_failed', { nodeId, error });
    throw err;
  } finally {
    if (nodeTimeout) clearInterval(nodeTimeout);
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

  // No cascade — nested delegation doesn't work in CLI's flat agent pool,
  // so downstream nodes (experts, skills) won't actually execute.
  return true;
}

/**
 * Check if the run has exceeded its token budget.
 * Emits a warning at 80% and aborts at 100%.
 */
function checkTokenBudget(ctx: ExecutionContext) {
  const ratio = ctx.totalTokensUsed / ctx.tokenBudget;

  if (!ctx.budgetWarningEmitted && ratio >= BUDGET_WARNING_THRESHOLD) {
    ctx.budgetWarningEmitted = true;
    const pct = Math.round(ratio * 100);
    debugLog(`[GraphRunner] Token budget warning: ${ctx.totalTokensUsed.toLocaleString()} / ${ctx.tokenBudget.toLocaleString()} (${pct}%)`);
    ctx.emitter.emit('budget_warning', {
      totalTokensUsed: ctx.totalTokensUsed,
      tokenBudget: ctx.tokenBudget,
      percentage: pct,
    });
  }

  if (ratio >= 1.0) {
    debugLog(`[GraphRunner] Token budget EXCEEDED: ${ctx.totalTokensUsed.toLocaleString()} / ${ctx.tokenBudget.toLocaleString()}. Aborting run.`);
    ctx.emitter.emit('budget_exceeded', {
      totalTokensUsed: ctx.totalTokensUsed,
      tokenBudget: ctx.tokenBudget,
    });
    ctx.abortController.abort();
  }
}

/** Maximum time (ms) a single node execution can run before being considered stuck */
const NODE_EXECUTION_TIMEOUT = 10 * 60 * 1000; // 10 minutes

// NOTE: Cascade activation (emitDownstreamActivation) was removed because
// nested delegation doesn't work in Claude CLI's flat agent pool. Only the
// root can delegate via Task — sub-agents do work directly with their tools.
// The timeline only shows nodes that actually execute.

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

  // Fallback: if Claude chose a built-in agent name (e.g. "general-purpose",
  // "Bash") instead of one of our custom agent keys, try to match by fuzzy name.
  if (!delegateResolved || !delegateNodeId) {
    const customKeys = [...ctx.agentKeyToNodeId.keys()];
    debugLog(`[GraphRunner] Task delegation: agentType="${agentType}" not found in agentKeyToNodeId (keys=[${customKeys.join(', ')}]). taskPrompt="${taskPrompt.slice(0, 150)}". Attempting fuzzy match...`);

    // Determine the caller node to find its direct delegates
    const callerNodeId = parentToolUseId
      ? (ctx.taskToolUseToNodeId.get(parentToolUseId) || rootNodeId)
      : rootNodeId;
    const callerResolved = ctx.resolvedNodes.get(callerNodeId);

    if (callerResolved && callerResolved.delegates.length > 0) {
      // Try fuzzy match: compare agentType against delegate labels (case-insensitive)
      const agentTypeLower = agentType.toLowerCase().replace(/[-_\s]/g, '');
      let bestMatch: { key: string; nodeId: string } | null = null;

      for (const delegate of callerResolved.delegates) {
        const delegateLabel = ((delegate.data.label as string) || '').toLowerCase().replace(/[-_\s]/g, '');
        const delegateKey = customKeys.find(k => ctx.agentKeyToNodeId.get(k) === delegate.id);
        if (!delegateKey) continue;

        // Exact match on normalized label
        if (delegateLabel === agentTypeLower || delegateKey.toLowerCase() === agentTypeLower) {
          bestMatch = { key: delegateKey, nodeId: delegate.id };
          break;
        }
        // Partial match: agentType contains or is contained in label
        if (delegateLabel.includes(agentTypeLower) || agentTypeLower.includes(delegateLabel)) {
          bestMatch = { key: delegateKey, nodeId: delegate.id };
        }
      }

      // Content-based fallback: when agentType is a built-in (e.g. "general-purpose"),
      // match the task prompt against delegate descriptions to find the best fit.
      if (!bestMatch && taskPrompt) {
        const promptLower = taskPrompt.toLowerCase();
        let bestScore = 0;
        for (const delegate of callerResolved.delegates) {
          const delegateKey = customKeys.find(k => ctx.agentKeyToNodeId.get(k) === delegate.id);
          if (!delegateKey) continue;
          // Score: count how many words from the delegate's description/label appear in the prompt
          const desc = ((delegate.data.taskDescription as string) || (delegate.data.label as string) || '').toLowerCase();
          const words = desc.split(/\s+/).filter(w => w.length > 3);
          const score = words.reduce((s, w) => s + (promptLower.includes(w) ? 1 : 0), 0);
          if (score > bestScore) {
            bestScore = score;
            bestMatch = { key: delegateKey, nodeId: delegate.id };
          }
        }
        if (bestMatch) {
          debugLog(`[GraphRunner] Content-based fallback: routing "${agentType}" → "${bestMatch.key}" (score=${bestScore})`);
        }
      }

      // Last resort: use first delegate only if there's exactly one (unambiguous)
      if (!bestMatch && callerResolved.delegates.length === 1) {
        const onlyDelegate = callerResolved.delegates[0]!;
        const onlyKey = customKeys.find(k => ctx.agentKeyToNodeId.get(k) === onlyDelegate.id);
        if (onlyKey) {
          bestMatch = { key: onlyKey, nodeId: onlyDelegate.id };
          debugLog(`[GraphRunner] Fallback: single delegate available, routing "${agentType}" → "${onlyKey}"`);
        }
      }

      if (bestMatch) {
        delegateNodeId = bestMatch.nodeId;
        delegateResolved = ctx.resolvedNodes.get(delegateNodeId) ?? null;
        debugLog(`[GraphRunner] Fuzzy match: routing "${agentType}" → "${bestMatch.key}" (${delegateNodeId})`);
      }
    }

    if (!delegateResolved || !delegateNodeId) {
      debugLog(`[GraphRunner] Task delegation: no fallback available for "${agentType}", ignoring.`);
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

        // Emit completion immediately — no cascade needed since nested
        // delegation doesn't work in CLI's flat agent pool.
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
      // Track global token budget
      ctx.totalTokensUsed += input;
      checkTokenBudget(ctx);
      break;
    }
    case 'message_delta':
      if (msg.outputTokens && effectiveNodeId === nodeId) {
        callbacks.onOutputTokens(msg.outputTokens);
      }
      // Track global token budget
      if (msg.outputTokens) {
        ctx.totalTokensUsed += msg.outputTokens;
        checkTokenBudget(ctx);
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

  // Prepare tmpdir environment with CLAUDE.md + .mcp.json (if graph has rules/mcps)
  const env = prepareRunEnvironment(resolved, cwd);

  // Extract token budget from root node's maxTokens (or use default)
  const rootMaxTokens = rootNode.data.maxTokens as number | undefined;
  const tokenBudget = rootMaxTokens && rootMaxTokens > 0 ? rootMaxTokens : DEFAULT_TOKEN_BUDGET;
  debugLog(`[GraphRunner] Token budget for run: ${tokenBudget.toLocaleString()} tokens (source: ${rootMaxTokens ? 'root node maxTokens' : 'default'})`);

  const ctx: ExecutionContext = {
    runId,
    cwd,
    env,
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
    tokenBudget,
    totalTokensUsed: 0,
    budgetWarningEmitted: false,
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
    } finally {
      // Clean up tracked session IDs for this run
      for (const sid of ctx.sessionIds.values()) {
        graphRunnerSessionIds.delete(sid);
      }
      env.cleanup();
    }
  })();

  return { runId, emitter, abortController };
}
