/**
 * Graph Execution — single-pass and recursive node execution logic.
 *
 * Exports: executeSinglePass(), executeNode(), checkTokenBudget()
 * Types: ExecutionContext
 */

import { EventEmitter } from 'events';
import { join } from 'path';
import { claudeQuery } from './claude-sdk.js';
import { cwdToHash } from '../utils/platform.js';
import { markSessionInternal } from '../db/database.js';
import type { ResolvedNode } from './graph-resolver.js';
import type { NodeEnvironment, RunSandbox } from './graph-environment.js';
import { prepareNodeEnvironment } from './graph-environment.js';
import { composeSystemPrompt, buildChildDescriptions, buildPlanningPrompt, parseDelegationPlan, buildSynthesisPrompt } from './graph-prompts.js';
import { debugLog, addGraphRunnerSessionId } from './graph-utils.js';

// ─── Constants ──────────────────────────────────────────────────────────

/** Emit a budget_warning event at this fraction of the budget */
const BUDGET_WARNING_THRESHOLD = 0.8;
/** Maximum time (ms) a single node execution can run before being considered stuck */
const NODE_EXECUTION_TIMEOUT = 10 * 60 * 1000; // 10 minutes

// ─── Types ──────────────────────────────────────────────────────────────

export interface ExecutionContext {
  runId: string;
  cwd: string;
  emitter: EventEmitter;
  abortController: AbortController;
  resolvedNodes: Map<string, ResolvedNode>;
  sessionIds: Map<string, string>;   // nodeId -> Claude session ID (for --resume in synthesis)
  outputTexts: Map<string, string>;  // nodeId -> accumulated output
  usages: Map<string, { inputTokens: number; outputTokens: number }>;
  nodeEnvs: Map<string, NodeEnvironment>; // nodeId -> per-node tmpdir
  sandbox: RunSandbox | null;        // run-level /tmp sandbox
  // Token budget tracking
  tokenBudget: number;
  totalTokensUsed: number;
  budgetWarningEmitted: boolean;
}

// ─── Token Budget ────────────────────────────────────────────────────────

export function checkTokenBudget(ctx: ExecutionContext) {
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
export async function executeSinglePass(
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
            addGraphRunnerSessionId(msg.sessionId);
            markSessionInternal(cwdToHash(ctx.cwd), msg.sessionId);
          }
          break;
        case 'result':
          if (msg.sessionId) {
            ctx.sessionIds.set(nodeId, msg.sessionId);
            addGraphRunnerSessionId(msg.sessionId);
            markSessionInternal(cwdToHash(ctx.cwd), msg.sessionId);
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
export async function executeNode(
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
    // LEAF NODE: single-pass execution
    debugLog(`[GraphRunner] "${nodeLabel}" is a leaf node — single-pass execution`);
    result = await executeSinglePass(ctx, nodeId, prompt);
  } else {
    // ORCHESTRATOR NODE: two-phase execution
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

        // Emit result_return for edge flow animation (child->parent)
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
