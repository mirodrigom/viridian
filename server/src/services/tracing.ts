/**
 * Built-in tracing — traces every agent interaction to SQLite.
 *
 * Supports nested spans for subagent/skill tool calls:
 *   Trace → Generation → Task/Skill span → subagent tool spans
 *
 * Always enabled — no external service required.
 */

import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';
import { getDb } from '../db/database.js';

// Emits 'trace:started' and 'trace:ended' for real-time WS push
export const traceEmitter = new EventEmitter();

// ─── Active trace registry ───────────────────────────────────────────────────

interface ActiveTrace {
  traceId: string;
  generationId: string;
  /** requestId → observation ID for all tool calls (including agent parent spans). */
  toolSpans: Map<string, string>;
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

function now(): string {
  return new Date().toISOString();
}

function safeJson(val: unknown): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'string') return val;
  try { return JSON.stringify(val); } catch { return ''; }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/** Call at the start of sendMessage() to begin tracing a turn. */
export function startTrace(params: {
  sessionId: string;
  claudeSessionId?: string;
  providerId: string;
  prompt: string;
  model?: string;
  /** Optional role label (e.g. "chat", "autopilot:orchestrator"). */
  role?: string;
}) {
  const db = getDb();
  const traceId = randomUUID();
  const generationId = randomUUID();
  const name = params.role || 'chat';
  const startTime = now();

  db.prepare(`
    INSERT INTO traces (id, name, user_id, session_id, metadata, tags, input, status, start_time)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)
  `).run(
    traceId,
    name,
    params.claudeSessionId || params.sessionId,
    params.sessionId,
    JSON.stringify({
      claudeSessionId: params.claudeSessionId,
      sessionId: params.sessionId,
      providerId: params.providerId,
    }),
    JSON.stringify([params.providerId, name]),
    params.prompt,
    startTime,
  );

  db.prepare(`
    INSERT INTO observations (id, trace_id, type, name, model, input, start_time)
    VALUES (?, ?, 'GENERATION', 'response', ?, ?, ?)
  `).run(generationId, traceId, params.model || 'claude-sonnet-4-6', params.prompt, startTime);

  activeTraces.set(params.sessionId, {
    traceId,
    generationId,
    toolSpans: new Map(),
    accumulatedOutput: '',
  });

  traceEmitter.emit('trace:started', { sessionId: params.sessionId });
}

/**
 * Record a tool_use event as a span.
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

  const db = getDb();
  const obsId = randomUUID();

  // Determine parent observation
  const parentObsId = parentToolUseId ? at.toolSpans.get(parentToolUseId) || null : null;

  const isAgent = AGENT_TOOLS.has(toolName);
  const spanName = isAgent ? agentSpanName(toolName, input) : toolName;
  const metadata = isAgent
    ? { requestId, toolName, isAgent: true }
    : { requestId, isSubagent: !!parentToolUseId };

  db.prepare(`
    INSERT INTO observations (id, trace_id, parent_observation_id, type, name, input, metadata, start_time)
    VALUES (?, ?, ?, 'SPAN', ?, ?, ?, ?)
  `).run(obsId, at.traceId, parentObsId, spanName, safeJson(input), JSON.stringify(metadata), now());

  at.toolSpans.set(requestId, obsId);
}

/** Update a tool span's input once streaming is complete. */
export function updateToolInput(sessionId: string, requestId: string, input: Record<string, unknown>) {
  const at = activeTraces.get(sessionId);
  if (!at) return;
  const obsId = at.toolSpans.get(requestId);
  if (!obsId) return;

  getDb().prepare('UPDATE observations SET input = ? WHERE id = ?').run(safeJson(input), obsId);
}

/** Record tool result and close the corresponding span. */
export function recordToolResult(sessionId: string, requestId: string, output: unknown) {
  const at = activeTraces.get(sessionId);
  if (!at) return;

  const obsId = at.toolSpans.get(requestId);
  if (!obsId) return;

  getDb().prepare('UPDATE observations SET output = ?, end_time = ? WHERE id = ?')
    .run(safeJson(output), now(), obsId);
  at.toolSpans.delete(requestId);
}

/** Update the trace userId once claudeSessionId becomes available (new sessions). */
export function updateTraceUser(sessionId: string, claudeSessionId: string) {
  const at = activeTraces.get(sessionId);
  if (!at) return;
  getDb().prepare('UPDATE traces SET user_id = ? WHERE id = ?').run(claudeSessionId, at.traceId);
}

/** Append streaming text to the accumulated output for this turn. */
export function recordTextDelta(sessionId: string, text: string) {
  const at = activeTraces.get(sessionId);
  if (!at) return;
  at.accumulatedOutput += text;
}

/** Close the generation and finalize the trace. Call when the stream ends. */
export function endTrace(sessionId: string, usage: { inputTokens: number; outputTokens: number }) {
  const at = activeTraces.get(sessionId);
  if (!at) return;

  const db = getDb();
  const endTime = now();

  // Close any tool spans that never got a result
  for (const obsId of at.toolSpans.values()) {
    try {
      db.prepare('UPDATE observations SET end_time = ? WHERE id = ? AND end_time IS NULL')
        .run(endTime, obsId);
    } catch { /* ignore */ }
  }

  // Finalize generation
  db.prepare(`
    UPDATE observations
    SET output = ?, end_time = ?, input_tokens = ?, output_tokens = ?
    WHERE id = ?
  `).run(at.accumulatedOutput, endTime, usage.inputTokens, usage.outputTokens, at.generationId);

  // Finalize trace
  db.prepare(`
    UPDATE traces
    SET output = ?, end_time = ?, status = 'completed', input_tokens = ?, output_tokens = ?
    WHERE id = ?
  `).run(at.accumulatedOutput, endTime, usage.inputTokens, usage.outputTokens, at.traceId);

  activeTraces.delete(sessionId);

  traceEmitter.emit('trace:ended', { sessionId });
}

/** Record an error on the active trace. */
export function recordError(sessionId: string, error: string) {
  const at = activeTraces.get(sessionId);
  if (!at) return;

  getDb().prepare('UPDATE observations SET status_message = ?, level = ? WHERE id = ?')
    .run(error, 'ERROR', at.generationId);
}

/** No-op — writes are synchronous with SQLite. Kept for API compatibility. */
export async function flush() {
  // No-op: better-sqlite3 writes are synchronous
}
