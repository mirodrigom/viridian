/**
 * Langfuse observability — traces every agent interaction.
 *
 * Supports nested spans for subagent/skill tool calls:
 *   Trace → Generation → Task/Skill span → subagent tool spans
 *
 * Disabled automatically when LANGFUSE_SECRET_KEY is not set.
 * Self-host with docker-compose.yml at the repo root, then set:
 *   LANGFUSE_SECRET_KEY=sk-lf-...
 *   LANGFUSE_PUBLIC_KEY=pk-lf-...
 *   LANGFUSE_BASE_URL=http://localhost:3001
 */

import Langfuse from 'langfuse';
import { EventEmitter } from 'events';

// Emits 'trace:started' and 'trace:ended' for real-time WS push
export const traceEmitter = new EventEmitter();

// ─── Client singleton ────────────────────────────────────────────────────────

let _client: Langfuse | null = null;

function getClient(): Langfuse | null {
  if (!process.env.LANGFUSE_SECRET_KEY) return null;
  if (!_client) {
    _client = new Langfuse({
      secretKey: process.env.LANGFUSE_SECRET_KEY,
      publicKey: process.env.LANGFUSE_PUBLIC_KEY || '',
      baseUrl: process.env.LANGFUSE_BASE_URL || 'http://localhost:3001',
      flushAt: 10,
      flushInterval: 5000,
    });
  }
  return _client;
}

// ─── Active trace registry ───────────────────────────────────────────────────

interface ActiveTrace {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  trace: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  generation: any;
  /** requestId → span for all tool calls (including agent parent spans). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  toolSpans: Map<string, any>;
  /** Accumulates the full assistant text for this turn. */
  accumulatedOutput: string;
}

const activeTraces = new Map<string, ActiveTrace>();

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Agent-spawning tools whose requestId becomes a parent for subagent calls. */
const AGENT_TOOLS = new Set(['Task', 'Skill']);

/** Build a human-readable span name for a Task/Skill tool invocation. */
function agentSpanName(toolName: string, input: Record<string, unknown>): string {
  if (toolName === 'Task') {
    const desc = input.description as string | undefined;
    const agentType = input.subagent_type as string | undefined;
    const parts = [agentType || 'agent'];
    if (desc) parts.push(desc);
    return parts.join(': ');
  }
  if (toolName === 'Skill') {
    return `skill: ${input.skill || 'unknown'}`;
  }
  return toolName;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/** Call at the start of sendMessage() to begin tracing a turn. */
export function startTrace(params: {
  sessionId: string;
  claudeSessionId?: string;
  providerId: string;
  prompt: string;
  model?: string;
  /** Optional role label shown in Langfuse (e.g. "chat", "autopilot:orchestrator"). */
  role?: string;
}) {
  const lf = getClient();
  if (!lf) return;

  const name = params.role || 'chat';

  const trace = lf.trace({
    name,
    userId: params.claudeSessionId || params.sessionId,
    metadata: {
      claudeSessionId: params.claudeSessionId,
      sessionId: params.sessionId,
      providerId: params.providerId,
    },
    tags: [params.providerId, name],
  });

  const generation = trace.generation({
    name: 'response',
    model: params.model || 'claude-sonnet-4-6',
    input: params.prompt,
  });

  activeTraces.set(params.sessionId, {
    trace,
    generation,
    toolSpans: new Map(),
    accumulatedOutput: '',
  });

  traceEmitter.emit('trace:started', { sessionId: params.sessionId });
}

/**
 * Record a tool_use event as a Langfuse span.
 *
 * - Agent tools (Task, Skill) create a parent span; their requestId is stored
 *   so that subsequent subagent tool calls can be nested under it.
 * - Subagent tool calls (parentToolUseId set) are created as children of
 *   the agent span identified by parentToolUseId.
 * - Top-level tool calls are direct children of the trace.
 */
export function recordToolUse(
  sessionId: string,
  requestId: string,
  toolName: string,
  input: Record<string, unknown>,
  parentToolUseId?: string | null,
) {
  const at = activeTraces.get(sessionId);
  if (!at) return;

  // Determine where to attach this span
  const parentSpan = parentToolUseId ? at.toolSpans.get(parentToolUseId) : null;
  const parent = parentSpan || at.trace;

  if (AGENT_TOOLS.has(toolName)) {
    // Create a named agent span that subagent calls will nest under
    const span = parent.span({
      name: agentSpanName(toolName, input),
      input,
      metadata: { requestId, toolName, isAgent: true },
    });
    at.toolSpans.set(requestId, span);
  } else {
    // Regular tool — attach to parent agent span or trace root
    const span = parent.span({
      name: parentSpan ? `${toolName}` : toolName,
      input,
      metadata: { requestId, isSubagent: !!parentToolUseId },
    });
    at.toolSpans.set(requestId, span);
  }
}

/** Update a tool span's input once streaming is complete. */
export function updateToolInput(sessionId: string, requestId: string, input: Record<string, unknown>) {
  const at = activeTraces.get(sessionId);
  if (!at) return;
  const span = at.toolSpans.get(requestId);
  if (span) span.update({ input });
}

/** Record tool result and close the corresponding span. */
export function recordToolResult(sessionId: string, requestId: string, output: unknown) {
  const at = activeTraces.get(sessionId);
  if (!at) return;

  const span = at.toolSpans.get(requestId);
  if (span) {
    span.end({ output });
    at.toolSpans.delete(requestId);
  }
}

/** Append streaming text to the accumulated output for this turn. */
export function recordTextDelta(sessionId: string, text: string) {
  const at = activeTraces.get(sessionId);
  if (!at) return;
  at.accumulatedOutput += text;
}

/** Close the generation and flush. Call when the stream ends. */
export function endTrace(sessionId: string, usage: { inputTokens: number; outputTokens: number }) {
  const at = activeTraces.get(sessionId);
  if (!at) return;

  // Close any tool spans that never got a result
  for (const span of at.toolSpans.values()) {
    try { span.end(); } catch { /* ignore */ }
  }

  at.generation.end({
    output: at.accumulatedOutput,
    usage: {
      input: usage.inputTokens,
      output: usage.outputTokens,
      unit: 'TOKENS',
    },
  });

  activeTraces.delete(sessionId);

  // Flush to Langfuse, then notify clients so they can fetch fresh data immediately
  const lf = getClient();
  const notifyEnded = () => traceEmitter.emit('trace:ended', { sessionId });
  if (lf) {
    lf.flushAsync().then(notifyEnded).catch(notifyEnded);
  } else {
    notifyEnded();
  }
}

/** Record an error on the active trace. */
export function recordError(sessionId: string, error: string) {
  const at = activeTraces.get(sessionId);
  if (!at) return;

  at.generation.update({ statusMessage: error, level: 'ERROR' });
}

/** Flush all pending events (call on server shutdown). */
export async function flush() {
  const lf = getClient();
  if (lf) await lf.flushAsync();
}
