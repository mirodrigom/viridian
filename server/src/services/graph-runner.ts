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
 */

import { EventEmitter } from 'events';
import { v4 as uuid } from 'uuid';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { claudeQuery, type SDKMessage } from './claude-sdk.js';
import { validateDelegationRouting as validateRouting } from '../types/agent-metadata.js';
import type { AgentMetadata } from '../types/agent-metadata.js';

// Debug log to file for tracing delegation flow
const DEBUG_LOG = join(tmpdir(), 'graph-runner-debug.log');
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

/** Per-node environment (tmpdir with CLAUDE.md + .mcp.json) */
interface NodeEnvironment {
  tmpDir: string | null;
  effectiveCwd: string;
  realProjectPath: string;
  cleanup: () => void;
}

/** Default token budget for a graph run (if root node doesn't specify maxTokens) */
const DEFAULT_TOKEN_BUDGET = 1_000_000;
/** Emit a budget_warning event at this fraction of the budget */
const BUDGET_WARNING_THRESHOLD = 0.8;
/** Maximum time (ms) a single node execution can run before being considered stuck */
const NODE_EXECUTION_TIMEOUT = 10 * 60 * 1000; // 10 minutes

/** Run-level sandbox directory in /tmp */
interface RunSandbox {
  sandboxDir: string;
  projectMirrorDir: string;
  cleanup: () => void;
}

/** Child assignment from planning phase */
interface ChildAssignment {
  childNodeId: string;
  childLabel: string;
  task: string;
}

interface ExecutionContext {
  runId: string;
  cwd: string;
  emitter: EventEmitter;
  abortController: AbortController;
  resolvedNodes: Map<string, ResolvedNode>;
  sessionIds: Map<string, string>;   // nodeId → Claude session ID (for --resume in synthesis)
  outputTexts: Map<string, string>;  // nodeId → accumulated output
  usages: Map<string, { inputTokens: number; outputTokens: number }>;
  nodeEnvs: Map<string, NodeEnvironment>; // nodeId → per-node tmpdir
  sandbox: RunSandbox | null;        // run-level /tmp sandbox
  // Token budget tracking
  tokenBudget: number;
  totalTokensUsed: number;
  budgetWarningEmitted: boolean;
}

// ─── Per-Node Environment ────────────────────────────────────────────────

/**
 * Create a temporary directory for a specific node with its own CLAUDE.md and
 * .mcp.json. Each node gets isolated rules and MCP servers from its direct
 * connections only (not inherited from parent or siblings).
 */
function prepareNodeEnvironment(
  resolved: ResolvedNode,
  originalCwd: string,
  sandbox: RunSandbox | null,
): NodeEnvironment {
  const nodeRules = resolved.rules;
  const nodeMcps = resolved.mcps;
  const nodeSkills = resolved.skills;
  const projectPath = sandbox ? sandbox.projectMirrorDir : originalCwd;

  // No rules, MCPs, or skills → no tmpdir needed, use project path
  if (nodeRules.length === 0 && nodeMcps.length === 0 && nodeSkills.length === 0) {
    return {
      tmpDir: null,
      effectiveCwd: projectPath,
      realProjectPath: projectPath,
      cleanup: () => {},
    };
  }

  const nodeLabel = (resolved.node.data.label as string) || resolved.node.id;
  const parentDir = sandbox ? sandbox.sandboxDir : tmpdir();
  const tmpDir = mkdtempSync(join(parentDir, `graph-node-${resolved.node.id.slice(0, 8)}-`));
  debugLog(`[GraphRunner] Created node tmpdir: ${tmpDir} for "${nodeLabel}" (rules=${nodeRules.length}, mcps=${nodeMcps.length}, skills=${nodeSkills.length})`);

  // Write CLAUDE.md with this node's rules
  if (nodeRules.length > 0) {
    const ruleLines = nodeRules.map(r => {
      const ruleType = ((r.data.ruleType as string) || 'guideline').toUpperCase();
      const ruleText = (r.data.ruleText as string) || '';
      return `- [${ruleType}] ${r.data.label || 'Rule'}: ${ruleText}`;
    });
    const claudeMd = `# Graph Runner Rules\n\n${ruleLines.join('\n')}\n`;
    writeFileSync(join(tmpDir, 'CLAUDE.md'), claudeMd, 'utf8');
  }

  // Write .mcp.json with this node's MCP servers
  if (nodeMcps.length > 0) {
    const mcpServers: Record<string, Record<string, unknown>> = {};
    for (const mcpNode of nodeMcps) {
      const name = ((mcpNode.data.label as string) || `mcp-${mcpNode.id}`)
        .replace(/\s+/g, '-')
        .toLowerCase();
      const serverType = mcpNode.data.serverType as string;

      if (serverType === 'stdio') {
        mcpServers[name] = {
          type: 'stdio',
          command: mcpNode.data.command as string,
          args: (mcpNode.data.args as string[]) || [],
          ...(mcpNode.data.env ? { env: mcpNode.data.env } : {}),
        };
      } else {
        mcpServers[name] = {
          type: serverType,
          url: mcpNode.data.url as string,
          ...(mcpNode.data.headers ? { headers: mcpNode.data.headers } : {}),
        };
      }
    }
    writeFileSync(
      join(tmpDir, '.mcp.json'),
      JSON.stringify({ mcpServers }, null, 2),
      'utf8',
    );
  }

  // Write on-demand skill files (agents read these only when needed)
  if (nodeSkills.length > 0) {
    const skillsDir = join(tmpDir, 'skills');
    mkdirSync(skillsDir, { recursive: true });
    for (const skill of nodeSkills) {
      const commandSlug = ((skill.data.command as string) || 'unnamed')
        .replace(/^\//, '')
        .replace(/[^a-zA-Z0-9-_]/g, '-');
      const label = (skill.data.label as string) || 'Skill';
      const template = (skill.data.promptTemplate as string) || '';
      const tools = (skill.data.allowedTools as string[]) || [];
      const content = `# ${label}\n\nCommand: \`${skill.data.command}\`\nAllowed Tools: ${tools.join(', ') || 'all default tools'}\n\n## Instructions\n\n${template}\n`;
      writeFileSync(join(skillsDir, `${commandSlug}.md`), content, 'utf8');
    }
    debugLog(`[GraphRunner] Wrote ${nodeSkills.length} skill files to ${skillsDir}`);
  }

  return {
    tmpDir,
    effectiveCwd: tmpDir,
    realProjectPath: projectPath,
    cleanup: () => {
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch (err) { console.warn('[GraphRunner] node tmpdir cleanup failed:', err); }
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
export function resolveExecutionGraph(graphData: GraphData, options?: { strictRouting?: boolean }): Map<string, ResolvedNode> {
  const nodesById = new Map<string, GraphNode>();
  for (const node of graphData.nodes) {
    nodesById.set(node.id, node);
  }

  const resolved = new Map<string, ResolvedNode>();
  const executableTypes = new Set(['agent', 'subagent', 'expert']);

  for (const node of graphData.nodes) {
    if (!executableTypes.has(node.type)) continue;

    const skills: GraphNode[] = [];
    const mcps: GraphNode[] = [];
    const rules: GraphNode[] = [];
    const delegates: GraphNode[] = [];

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

    // Validate delegation routing constraints
    const nodeLabel = (node.data.label as string) || node.id;
    const nodeMeta = node.data.metadata as AgentMetadata | undefined;
    for (const del of delegates) {
      const delLabel = (del.data.label as string) || del.id;
      const delMeta = del.data.metadata as AgentMetadata | undefined;
      const check = validateRouting(nodeMeta, nodeLabel, delMeta, delLabel);
      if (!check.valid) {
        if (options?.strictRouting) {
          throw new Error(`Routing violation: ${check.reason}`);
        }
        debugLog(`[GraphRunner] ROUTING WARNING: ${check.reason}`);
      }
    }

    resolved.set(node.id, { node, skills, mcps, rules, delegates });
    debugLog(`[GraphRunner] Resolved "${nodeLabel}" (${node.type}): delegates=[${delegates.map(d => d.data.label || d.id).join(', ')}], skills=[${skills.map(s => s.data.label || s.id).join(', ')}], rules=[${rules.map(r => r.data.label || r.id).join(', ')}], mcps=[${mcps.map(m => m.data.label || m.id).join(', ')}]`);
  }

  return resolved;
}

/**
 * Find the root node: an executable node with no incoming delegation edges.
 */
export function findRootNode(graphData: GraphData, resolved: Map<string, ResolvedNode>): GraphNode | null {
  const delegationTargets = new Set<string>();
  for (const edge of graphData.edges) {
    if (getEdgeType(edge) === 'delegation') {
      delegationTargets.add(edge.target);
    }
  }

  const roots: GraphNode[] = [];
  for (const [nodeId, res] of resolved) {
    if (!delegationTargets.has(nodeId)) {
      roots.push(res.node);
    }
  }

  const agentRoot = roots.find(n => n.type === 'agent');
  return agentRoot || roots[0] || null;
}

// ─── System Prompt Composition ──────────────────────────────────────────

function composeSystemPrompt(
  resolved: ResolvedNode,
  opts?: { skipRules?: boolean; projectPath?: string; skillsDir?: string },
): string {
  const parts: string[] = [];

  // Project path instruction + structure discovery guidance
  if (opts?.projectPath) {
    parts.push(`IMPORTANT: The project you are working on is located at: ${opts.projectPath}
You MUST use absolute paths (starting with ${opts.projectPath}) when reading, editing, creating, or searching project files. Do NOT use relative paths.

## Efficient Codebase Navigation
Before reading files, understand the project structure first:
1. Use \`Glob("${opts.projectPath}/**/*", { maxDepth: 2 })\` to get the top-level directory layout
2. Use \`Grep\` to search for specific patterns, classes, or functions instead of reading entire files
3. Only \`Read\` the specific files relevant to your task — do NOT read every file in the project
4. Check for README.md, CLAUDE.md, or package.json at the project root for project conventions`);
  }

  // Node's own system prompt
  const ownPrompt = resolved.node.data.systemPrompt as string || '';
  if (ownPrompt) {
    parts.push(ownPrompt);
  }

  // Rules section (skipped when rules are in CLAUDE.md via tmpdir)
  if (!opts?.skipRules && resolved.rules.length > 0) {
    const ruleLines = resolved.rules.map(r => {
      const ruleType = (r.data.ruleType as string || 'guideline').toUpperCase();
      const ruleText = r.data.ruleText as string || '';
      return `- [${ruleType}] ${r.data.label || 'Rule'}: ${ruleText}`;
    });
    parts.push(`\n## Rules\n${ruleLines.join('\n')}`);
  }

  // Available Skills — compact index (full instructions loaded on-demand from files)
  if (resolved.skills.length > 0) {
    const skillIndex = resolved.skills.map(s => {
      const command = s.data.command as string || '';
      const description = (s.data.description as string) || (s.data.label as string) || 'Skill';
      const label = s.data.label as string || 'Skill';
      return `- \`${command}\` — **${label}**: ${description}`;
    }).join('\n');

    if (opts?.skillsDir) {
      parts.push(`\n## Available Skills\n${skillIndex}\n\nBefore using a skill, read its full instructions:\n  Read(\`${opts.skillsDir}/<command-name>.md\`)\nOnly load the skill(s) you actually need for the current task.`);
    } else {
      // Fallback: inline full templates (no tmpdir available)
      const skillSections = resolved.skills.map(s => {
        const command = s.data.command as string || '';
        const template = s.data.promptTemplate as string || '';
        const label = s.data.label as string || 'Skill';
        return `### Skill: ${label}\n**Command**: \`${command}\`\n**Instructions**:\n${template}`;
      });
      parts.push(`\n## Available Skills\nWhen executing a task that matches one of these skills, follow the skill's instructions exactly.\n\n${skillSections.join('\n\n')}`);
    }
  }

  return parts.join('\n\n');
}

// ─── Two-Phase Helpers ──────────────────────────────────────────────────

/**
 * Sanitize a node label into a clean identifier.
 */
function toAgentKey(label: string, usedKeys: Set<string>): string {
  let key = label
    .replace(/[^a-zA-Z0-9\s_-]/g, '')
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join('');

  if (!key) key = 'Agent';

  const base = key;
  let counter = 2;
  while (usedKeys.has(key)) {
    key = `${base}${counter++}`;
  }
  usedKeys.add(key);
  return key;
}

/**
 * Build a description map of a node's direct children for the planning prompt.
 */
function buildChildDescriptions(resolved: ResolvedNode): Record<string, { nodeId: string; description: string }> {
  const children: Record<string, { nodeId: string; description: string }> = {};
  const usedKeys = new Set<string>();

  for (const delegate of resolved.delegates) {
    const label = (delegate.data.label as string) || delegate.type;
    const key = toAgentKey(label, usedKeys);
    const description = (delegate.data.description as string)
      || (delegate.data.taskDescription as string)
      || (delegate.data.specialty as string)
      || label;
    children[key] = { nodeId: delegate.id, description };
  }

  return children;
}

/**
 * Build the planning prompt that asks an orchestrator to assign tasks to children.
 */
function buildPlanningPrompt(
  userTask: string,
  children: Record<string, { nodeId: string; description: string }>,
  resolvedNodes?: Map<string, ResolvedNode>,
): string {
  const childList = Object.entries(children)
    .map(([key, { nodeId, description }]) => {
      // Annotate with metadata tags if available
      const res = resolvedNodes?.get(nodeId);
      const meta = res?.node.data.metadata as AgentMetadata | undefined;
      const tags = meta?.tags?.length ? ` [tags: ${meta.tags.join(', ')}]` : '';
      const domain = meta?.domain && meta.domain !== 'general' ? ` (domain: ${meta.domain})` : '';
      return `- **${key}**${domain}: ${description}${tags}`;
    })
    .join('\n');

  return `You are a coordinator. Analyze the task below and assign subtasks to your team members.

## Your Team
${childList}

## Task
${userTask}

## Instructions
- Carefully read the user's task and decide which team members are relevant.
- Only assign to team members whose specialty directly matches what the task requires.
- For simple tasks, one team member may be enough. Do NOT assign to all of them by default.
- Each team member will receive ONLY the task description you provide — make it detailed and self-contained.
- Output a JSON array of assignments:

\`\`\`json
[{"agent": "AgentName", "task": "Detailed task description with all necessary context..."}]
\`\`\`

Output ONLY the JSON block, no other text before or after it.`;
}

/**
 * Parse the planning phase output into child assignments.
 * Handles variations in LLM output (extra text, markdown fences, etc).
 */
function parseDelegationPlan(
  planOutput: string,
  children: Record<string, { nodeId: string; description: string }>,
): ChildAssignment[] {
  const assignments: ChildAssignment[] = [];

  // Extract JSON from potential markdown fences or surrounding text
  let jsonStr = planOutput;
  const fenceMatch = planOutput.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) {
    jsonStr = fenceMatch[1]!;
  } else {
    // Try to find a JSON array directly
    const arrayMatch = planOutput.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      jsonStr = arrayMatch[0];
    }
  }

  let parsed: Array<{ agent: string; task: string }>;
  try {
    parsed = JSON.parse(jsonStr.trim());
  } catch (err) {
    debugLog(`[GraphRunner] Failed to parse delegation plan JSON: ${err}. Raw output:\n${planOutput.slice(0, 500)}`);
    // Fallback: delegate to ALL children with the original prose as context
    for (const [key, { nodeId }] of Object.entries(children)) {
      assignments.push({ childNodeId: nodeId, childLabel: key, task: planOutput });
      debugLog(`[GraphRunner] Fallback assignment: "${key}" (${nodeId})`);
    }
    return assignments;
  }

  if (!Array.isArray(parsed)) {
    debugLog(`[GraphRunner] Delegation plan is not an array: ${typeof parsed}`);
    return assignments;
  }

  const childKeys = Object.keys(children);
  const childKeysLower = childKeys.map(k => k.toLowerCase());

  for (const entry of parsed) {
    if (!entry.agent || !entry.task) continue;

    // Exact match
    let matchedKey = childKeys.find(k => k === entry.agent);

    // Case-insensitive match
    if (!matchedKey) {
      const idx = childKeysLower.indexOf(entry.agent.toLowerCase());
      if (idx >= 0) matchedKey = childKeys[idx];
    }

    // Fuzzy match: normalize and compare
    if (!matchedKey) {
      const normalized = entry.agent.toLowerCase().replace(/[-_\s]/g, '');
      const idx = childKeysLower.findIndex(k => k.replace(/[-_\s]/g, '') === normalized);
      if (idx >= 0) matchedKey = childKeys[idx];
    }

    // Partial match: agent name contains or is contained in a child key
    if (!matchedKey) {
      const normalized = entry.agent.toLowerCase().replace(/[-_\s]/g, '');
      matchedKey = childKeys.find(k => {
        const kn = k.toLowerCase().replace(/[-_\s]/g, '');
        return kn.includes(normalized) || normalized.includes(kn);
      });
    }

    if (matchedKey) {
      const child = children[matchedKey]!;
      assignments.push({
        childNodeId: child.nodeId,
        childLabel: matchedKey,
        task: entry.task,
      });
      debugLog(`[GraphRunner] Plan assignment: "${entry.agent}" → "${matchedKey}" (${child.nodeId})`);
    } else {
      debugLog(`[GraphRunner] Plan assignment: "${entry.agent}" not matched to any child. Available: [${childKeys.join(', ')}]`);
    }
  }

  return assignments;
}

/**
 * Build the synthesis prompt that feeds children's results back to the orchestrator.
 */
function buildSynthesisPrompt(childResults: Map<string, string>): string {
  const sections = [...childResults.entries()]
    .map(([name, result]) => `## Results from ${name}\n\n${result}`)
    .join('\n\n---\n\n');

  return `Your team has completed their assigned tasks. Here are their results:

${sections}

---

Now synthesize these results into a final, cohesive response that addresses the original task. Combine insights, remove redundancy, and present a well-organized answer.`;
}

// ─── Token Budget ────────────────────────────────────────────────────────

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

// ─── Single-Pass Execution ──────────────────────────────────────────────

/**
 * Execute a single Claude CLI process for a node. This is the primitive
 * building block — spawns one CLI, streams events, returns accumulated text.
 * No --agents, no Task interception, no flat pool.
 */
async function executeSinglePass(
  ctx: ExecutionContext,
  nodeId: string,
  prompt: string,
  opts?: {
    sessionId?: string;  // --resume for synthesis phase
    noTools?: boolean;    // disable tools for planning phase
  },
): Promise<string> {
  if (ctx.abortController.signal.aborted) return '';

  const resolved = ctx.resolvedNodes.get(nodeId);
  if (!resolved) throw new Error(`Node ${nodeId} not found in resolved graph`);

  const nodeLabel = (resolved.node.data.label as string) || nodeId;

  // Get or create per-node environment
  let env = ctx.nodeEnvs.get(nodeId);
  if (!env) {
    env = prepareNodeEnvironment(resolved, ctx.cwd, ctx.sandbox);
    ctx.nodeEnvs.set(nodeId, env);
  }

  // Compose system prompt (skills loaded on-demand from files when tmpdir is available)
  const skillsDir = env.tmpDir ? join(env.tmpDir, 'skills') : undefined;
  const composeOpts = {
    skipRules: !!env.tmpDir,
    projectPath: env.realProjectPath,
    skillsDir: resolved.skills.length > 0 ? skillsDir : undefined,
  };
  const systemPrompt = composeSystemPrompt(resolved, composeOpts);

  // Node-level config
  const model = (resolved.node.data.model as string) || undefined;
  const permissionMode = (resolved.node.data.permissionMode as string) || 'bypassPermissions';
  const allowedTools = (resolved.node.data.allowedTools as string[]) || undefined;
  const disallowedTools = (resolved.node.data.disallowedTools as string[]) || undefined;

  let inputTokens = 0;
  let outputTokens = 0;
  let accumulatedText = '';
  let lastActivityAt = Date.now();
  let nodeTimeout: ReturnType<typeof setInterval> | null = null;

  try {
    const stream = claudeQuery({
      prompt,
      cwd: env.effectiveCwd,
      model,
      permissionMode,
      sessionId: opts?.sessionId,
      noTools: opts?.noTools,
      allowedTools: opts?.noTools ? undefined : allowedTools,
      disallowedTools: opts?.noTools ? undefined : disallowedTools,
      appendSystemPrompt: systemPrompt || undefined,
      abortSignal: ctx.abortController.signal,
    });

    // Inactivity timer
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

      // Process message — simple direct handling, no routing
      switch (msg.type) {
        case 'text_delta':
          accumulatedText += msg.text;
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
          inputTokens += input;
          ctx.totalTokensUsed += input;
          checkTokenBudget(ctx);
          break;
        }
        case 'message_delta':
          if (msg.outputTokens) {
            outputTokens += msg.outputTokens;
            ctx.totalTokensUsed += msg.outputTokens;
            checkTokenBudget(ctx);
          }
          break;
        case 'system':
          if (msg.sessionId) {
            ctx.sessionIds.set(nodeId, msg.sessionId);
            graphRunnerSessionIds.add(msg.sessionId);
          }
          break;
        case 'result':
          if (msg.sessionId) {
            ctx.sessionIds.set(nodeId, msg.sessionId);
            graphRunnerSessionIds.add(msg.sessionId);
          }
          break;
        case 'error':
          ctx.emitter.emit('node_error', { nodeId, error: msg.error });
          break;
      }
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Unknown error';
    ctx.emitter.emit('node_error', { nodeId, error });
    throw err;
  } finally {
    if (nodeTimeout) clearInterval(nodeTimeout);
  }

  // Update usage tracking
  const prevUsage = ctx.usages.get(nodeId) || { inputTokens: 0, outputTokens: 0 };
  ctx.usages.set(nodeId, {
    inputTokens: prevUsage.inputTokens + inputTokens,
    outputTokens: prevUsage.outputTokens + outputTokens,
  });

  return accumulatedText;
}

// ─── Recursive Node Execution ───────────────────────────────────────────

/**
 * Execute a node in the graph tree. This is the core recursive function:
 *
 * - Leaf nodes (no delegates): single-pass execution
 * - Orchestrator nodes (has delegates): two-phase execution
 *   1. Planning: ask the node to analyze the task and assign subtasks
 *   2. Execute children recursively (can be parallel for independent children)
 *   3. Synthesis: resume the node with children's results for final answer
 */
async function executeNode(
  ctx: ExecutionContext,
  nodeId: string,
  prompt: string,
  parentNodeId: string | null,
): Promise<string> {
  if (ctx.abortController.signal.aborted) return '';

  const resolved = ctx.resolvedNodes.get(nodeId);
  if (!resolved) throw new Error(`Node ${nodeId} not found in resolved graph`);

  const nodeLabel = (resolved.node.data.label as string) || nodeId;
  const nodeType = resolved.node.type;
  const hasChildren = resolved.delegates.length > 0;

  debugLog(`[GraphRunner] executeNode: "${nodeLabel}" (${nodeType}, ${nodeId}), hasChildren=${hasChildren}, parentNodeId=${parentNodeId}`);

  // Emit node_started
  ctx.emitter.emit('node_started', {
    nodeId,
    nodeLabel,
    nodeType,
    inputPrompt: prompt,
    parentNodeId,
  });

  let result: string;

  if (!hasChildren) {
    // ═══ LEAF NODE: single-pass execution ═══
    debugLog(`[GraphRunner] "${nodeLabel}" is a leaf node — single-pass execution`);
    result = await executeSinglePass(ctx, nodeId, prompt);
  } else {
    // ═══ ORCHESTRATOR NODE: two-phase execution ═══
    const children = buildChildDescriptions(resolved);
    const childCount = Object.keys(children).length;
    debugLog(`[GraphRunner] "${nodeLabel}" is an orchestrator with ${childCount} children: [${Object.keys(children).join(', ')}]`);

    // Phase 1: Planning — ask the orchestrator to assign subtasks
    debugLog(`[GraphRunner] "${nodeLabel}" Phase 1: PLANNING`);
    ctx.emitter.emit('node_phase', { nodeId, phase: 'planning' });

    const planPrompt = buildPlanningPrompt(prompt, children, ctx.resolvedNodes);
    const planResult = await executeSinglePass(ctx, nodeId, planPrompt, { noTools: true });
    const assignments = parseDelegationPlan(planResult, children);

    debugLog(`[GraphRunner] "${nodeLabel}" planning complete: ${assignments.length} assignments`);
    for (const a of assignments) {
      debugLog(`[GraphRunner]   → ${a.childLabel}: "${a.task.slice(0, 100)}..."`);
    }

    // Handle case where planning returned no valid assignments
    if (assignments.length === 0) {
      debugLog(`[GraphRunner] "${nodeLabel}" planning returned 0 assignments. Falling back to leaf execution.`);
      result = await executeSinglePass(ctx, nodeId, prompt);
    } else {
      // Execute children — emit delegation events and run recursively
      const childResults = new Map<string, string>();

      for (const assignment of assignments) {
        if (ctx.abortController.signal.aborted) break;

        ctx.emitter.emit('delegation', {
          parentNodeId: nodeId,
          childNodeId: assignment.childNodeId,
          childLabel: assignment.childLabel,
          task: assignment.task,
        });

        const childResult = await executeNode(
          ctx,
          assignment.childNodeId,
          assignment.task,
          nodeId,
        );
        childResults.set(assignment.childLabel, childResult);

        // Emit result_return for edge flow animation (child→parent)
        ctx.emitter.emit('result_return', {
          parentNodeId: nodeId,
          childNodeId: assignment.childNodeId,
          childLabel: assignment.childLabel,
          result: childResult.slice(0, 200),
        });
      }

      // Phase 2: Synthesis — resume the orchestrator with children's results
      debugLog(`[GraphRunner] "${nodeLabel}" Phase 2: SYNTHESIS (${childResults.size} child results)`);
      ctx.emitter.emit('node_phase', { nodeId, phase: 'synthesis' });

      if (ctx.abortController.signal.aborted && childResults.size > 0) {
        // Budget exceeded — don't spawn another CLI (wastes tokens), just merge child results
        debugLog(`[GraphRunner] "${nodeLabel}" budget exceeded — merging ${childResults.size} child results directly`);
        const merged = [...childResults.entries()]
          .map(([name, text]) => `## ${name}\n\n${text}`)
          .join('\n\n---\n\n');
        result = merged;
      } else {
        const synthesisPrompt = buildSynthesisPrompt(childResults);
        const sessionId = ctx.sessionIds.get(nodeId); // resume planning session for continuity
        result = await executeSinglePass(ctx, nodeId, synthesisPrompt, { sessionId });
      }
    }
  }

  // Store final output
  ctx.outputTexts.set(nodeId, result);

  // Emit node_completed
  const usage = ctx.usages.get(nodeId) || { inputTokens: 0, outputTokens: 0 };
  ctx.emitter.emit('node_completed', {
    nodeId,
    outputText: result,
    usage,
  });

  debugLog(`[GraphRunner] "${nodeLabel}" completed (${result.length} chars, ${usage.inputTokens + usage.outputTokens} tokens)`);

  return result;
}

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
export function previewGraph(graphData: GraphData): ExecutionPreview {
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

// ─── Run Sandbox ────────────────────────────────────────────────────────

/**
 * Create a run-level sandbox directory in /tmp.
 * Symlinks the real project into the sandbox so node environments
 * (CLAUDE.md, .mcp.json) are isolated while agents still access project files.
 */
function prepareRunSandbox(runId: string, projectCwd: string): RunSandbox {
  const sandboxDir = mkdtempSync(join(tmpdir(), `graph-run-${runId.slice(0, 8)}-`));
  const projectMirrorDir = join(sandboxDir, 'project');

  symlinkSync(projectCwd, projectMirrorDir);
  debugLog(`[GraphRunner] Created run sandbox: ${sandboxDir} → ${projectCwd}`);

  return {
    sandboxDir,
    projectMirrorDir,
    cleanup: () => {
      try {
        rmSync(sandboxDir, { recursive: true, force: true });
        debugLog(`[GraphRunner] Cleaned up sandbox: ${sandboxDir}`);
      } catch (err) {
        console.warn('[GraphRunner] sandbox cleanup failed:', err);
      }
    },
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
export function runGraph(graphData: GraphData, prompt: string, cwd: string, options?: { strictRouting?: boolean }): RunContext {
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
        graphRunnerSessionIds.delete(sid);
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
