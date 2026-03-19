/**
 * Autopilot Agent Runner — Claude CLI spawn and streaming setup.
 *
 * Handles individual agent execution with streaming, token tracking, and budget management.
 */

import { getProvider } from '../providers/registry.js';
import { db } from '../db/database.js';
import { type AutopilotContext } from './autopilot-run-manager.js';
import { isOverTokenBudget } from './autopilot-validators.js';

// ─── Types ────────────────────────────────────────────────────────────────

export interface AgentResult {
  response: string;
  tokens: { inputTokens: number; outputTokens: number };
}

// ─── Agent Execution ──────────────────────────────────────────────────────

export async function runAgent(
  ctx: AutopilotContext,
  agent: 'a' | 'b',
  prompt: string,
  cycleNumber: number,
): Promise<AgentResult> {
  const profile = agent === 'a' ? ctx.agentAProfile : ctx.agentBProfile;
  const model = agent === 'a' ? ctx.agentAModel : ctx.agentBModel;
  const sessionId = agent === 'a' ? ctx.agentASessionId : ctx.agentBSessionId;
  const providerId = agent === 'a' ? ctx.agentAProvider : ctx.agentBProvider;
  const provider = getProvider(providerId || 'claude');

  const scopeInstructions = ctx.allowedPaths.length > 0
    ? `\n\n## SCOPE RESTRICTION\nYou may ONLY read and modify files within these paths:\n${ctx.allowedPaths.map(p => `- ${p}`).join('\n')}\nDo NOT access files outside this scope.`
    : '';

  let appendPrompt = (profile.appendSystemPrompt || '') + scopeInstructions + '\n\nYou are working autonomously as part of an autopilot system. Be concise and action-oriented.';

  // Build MCP awareness into system prompt
  if (profile.mcpServers && profile.mcpServers.length > 0) {
    const mcpSection = profile.mcpServers.map((mcp: { name: string; requiredTools?: string[] }) => {
      const toolsNote = mcp.requiredTools?.length
        ? ` (specifically: ${mcp.requiredTools.join(', ')})`
        : '';
      return `- ${mcp.name}${toolsNote}`;
    }).join('\n');
    appendPrompt += `\n\n## MCP Servers Available\nYou have access to tools from these MCP servers:\n${mcpSection}\nUse these tools when they match the task requirements.`;
  }

  // Build agents config from profile's subagents
  const agents: Record<string, {
    description: string;
    prompt: string;
    tools?: string[];
    disallowedTools?: string[];
    model?: string;
    permissionMode?: string;
    maxTurns?: number;
  }> = {};

  if (profile.subagents && profile.subagents.length > 0) {
    for (const sa of profile.subagents) {
      agents[sa.key] = {
        description: sa.description,
        prompt: sa.prompt,
        tools: sa.tools,
        disallowedTools: sa.disallowedTools,
        model: sa.model,
        permissionMode: sa.permissionMode || 'bypassPermissions',
        maxTurns: sa.maxTurns,
      };
    }
  }

  let response = '';
  let inputTokens = 0;
  let outputTokens = 0;

  // Event names for streaming
  const deltaEvent = agent === 'a' ? 'agent_a_delta' : 'agent_b_delta';
  const thinkStartEvent = agent === 'a' ? 'agent_a_thinking_start' : 'agent_b_thinking_start';
  const thinkDeltaEvent = agent === 'a' ? 'agent_a_thinking_delta' : 'agent_b_thinking_delta';
  const thinkEndEvent = agent === 'a' ? 'agent_a_thinking_end' : 'agent_b_thinking_end';
  const toolUseEvent = agent === 'a' ? 'agent_a_tool_use' : 'agent_b_tool_use';

  // Stream provider CLI execution
  for await (const msg of provider.query({
    prompt,
    cwd: ctx.cwd,
    model,
    systemPrompt: profile.systemPrompt,
    appendSystemPrompt: appendPrompt,
    allowedTools: profile.allowedTools.length > 0 ? profile.allowedTools : undefined,
    disallowedTools: profile.disallowedTools.length > 0 ? profile.disallowedTools : undefined,
    agents: provider.capabilities.supportsSubagents && Object.keys(agents).length > 0 ? agents : undefined,
    sessionId: provider.capabilities.supportsResume ? (sessionId || undefined) : undefined,
    abortSignal: ctx.abortController.signal,
    permissionMode: profile.permissionMode || 'bypassPermissions',
  })) {
    switch (msg.type) {
      case 'text_delta':
        if (!msg.parentToolUseId) {
          response += msg.text;
          ctx.emitter.emit(deltaEvent, {
            runId: ctx.runId,
            cycleNumber,
            text: msg.text,
          });
        }
        break;

      case 'thinking_start':
        if (!msg.parentToolUseId) {
          ctx.emitter.emit(thinkStartEvent, { runId: ctx.runId, cycleNumber });
        }
        break;

      case 'thinking_delta':
        if (!msg.parentToolUseId) {
          ctx.emitter.emit(thinkDeltaEvent, {
            runId: ctx.runId,
            cycleNumber,
            text: msg.text,
          });
        }
        break;

      case 'thinking_end':
        if (!msg.parentToolUseId) {
          ctx.emitter.emit(thinkEndEvent, { runId: ctx.runId, cycleNumber });
        }
        break;

      case 'tool_use':
        if (!msg.parentToolUseId) {
          ctx.emitter.emit(toolUseEvent, {
            runId: ctx.runId,
            cycleNumber,
            tool: msg.tool,
            input: msg.input,
            requestId: msg.requestId,
          });
        }
        break;

      case 'message_start':
        if (msg.inputTokens) inputTokens = msg.inputTokens;
        if (msg.cacheCreationInputTokens) inputTokens += msg.cacheCreationInputTokens;
        if (msg.cacheReadInputTokens) inputTokens += msg.cacheReadInputTokens;
        break;

      case 'message_delta':
        if (msg.outputTokens) outputTokens = msg.outputTokens;
        break;

      case 'result':
        // Capture session ID for --resume (only meaningful for providers that support it)
        if (msg.sessionId && provider.capabilities.supportsResume) {
          if (agent === 'a') {
            ctx.agentASessionId = msg.sessionId;
            await db('autopilot_runs').where({ id: ctx.runId }).update({
              agent_a_claude_session_id: msg.sessionId,
              agent_a_provider_session_id: msg.sessionId,
            });
          } else {
            ctx.agentBSessionId = msg.sessionId;
            await db('autopilot_runs').where({ id: ctx.runId }).update({
              agent_b_claude_session_id: msg.sessionId,
              agent_b_provider_session_id: msg.sessionId,
            });
          }
        }
        break;

      case 'error':
        throw new Error(msg.error);
    }
  }

  // Accumulate tokens
  if (agent === 'a') {
    ctx.totalTokens.agentA.inputTokens += inputTokens;
    ctx.totalTokens.agentA.outputTokens += outputTokens;
  } else {
    ctx.totalTokens.agentB.inputTokens += inputTokens;
    ctx.totalTokens.agentB.outputTokens += outputTokens;
  }

  return { response, tokens: { inputTokens, outputTokens } };
}

// ─── Token Budget Validation ──────────────────────────────────────────────

export function checkTokenBudget(ctx: AutopilotContext): { withinBudget: boolean; totalTokens: number } {
  const totalTokens =
    ctx.totalTokens.agentA.inputTokens + ctx.totalTokens.agentA.outputTokens +
    ctx.totalTokens.agentB.inputTokens + ctx.totalTokens.agentB.outputTokens;

  return {
    withinBudget: totalTokens < ctx.maxTokens,
    totalTokens,
  };
}
