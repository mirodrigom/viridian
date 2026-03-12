import { reactive } from 'vue';
import type { ChatMessage } from './useChatMessages';
import type { TokenUsage } from './useChatSession';

export interface SessionState {
  // Messages & streaming
  messages: ChatMessage[];
  isStreaming: boolean;
  streamStartTime: number | null;
  lastResponseMs: number;
  contentVersion: number;

  // Session identity
  sessionId: string | null;
  claudeSessionId: string | null;
  activeProjectDir: string | null;

  // Session lifecycle
  isLoadingSession: boolean;
  usage: TokenUsage;
  sessionStartedAt: number | null;
  sessionLoadedIdle: boolean;

  // Pagination
  totalMessages: number;
  hasMoreMessages: boolean;
  oldestLoadedIndex: number;
  isLoadingMore: boolean;

  // UI state
  inPlanMode: boolean;
  planReviewText: string | null;
  isPlanReviewActive: boolean;
  planReviewRequestId: string | null;
  autoScroll: boolean;
}

/**
 * Factory function that creates a new reactive SessionState with sensible defaults.
 */
export function createSessionState(sessionId?: string): SessionState {
  return reactive<SessionState>({
    // Messages & streaming
    messages: [],
    isStreaming: false,
    streamStartTime: null,
    lastResponseMs: 0,
    contentVersion: 0,

    // Session identity
    sessionId: sessionId ?? null,
    claudeSessionId: null,
    activeProjectDir: null,

    // Session lifecycle
    isLoadingSession: false,
    usage: { inputTokens: 0, outputTokens: 0, totalCost: 0 },
    sessionStartedAt: null,
    sessionLoadedIdle: false,

    // Pagination
    totalMessages: 0,
    hasMoreMessages: false,
    oldestLoadedIndex: 0,
    isLoadingMore: false,

    // UI state
    inPlanMode: false,
    planReviewText: null,
    isPlanReviewActive: false,
    planReviewRequestId: null,
    autoScroll: true,
  });
}

// ---------------------------------------------------------------------------
// Mutation helpers — operate on a SessionState instance
// ---------------------------------------------------------------------------

/** Append a message to the session. */
export function addMessage(state: SessionState, msg: ChatMessage) {
  state.messages.push(msg);
}

/** Append text to the last assistant message's content. */
export function updateLastAssistantContent(state: SessionState, text: string) {
  const last = state.messages.findLast(m => m.role === 'assistant');
  if (last) {
    last.content += text;
    state.contentVersion++;
  }
}

/** Mark the session as actively streaming. */
export function startStreaming(state: SessionState) {
  state.isStreaming = true;
  state.streamStartTime = Date.now();
}

/** Mark the session as no longer streaming and clean up assistant messages. */
export function finishStreaming(state: SessionState) {
  state.isStreaming = false;
  if (state.streamStartTime) {
    state.lastResponseMs = Date.now() - state.streamStartTime;
    state.streamStartTime = null;
  }
  // Clear isStreaming on all assistant messages (there may be multiple
  // when text was split around tool_use blocks during streaming)
  for (const msg of state.messages) {
    if (msg.role === 'assistant' && msg.isStreaming) {
      msg.isStreaming = false;
    }
  }
  // Remove trailing empty assistant messages (e.g. from rate limit errors
  // where stream_start created the bubble but no text arrived)
  while (state.messages.length > 0) {
    const last = state.messages[state.messages.length - 1]!;
    if (last.role === 'assistant' && !last.content.trim()) {
      state.messages.pop();
    } else {
      break;
    }
  }
}

/** Begin thinking on the last assistant message. */
export function startThinking(state: SessionState) {
  const last = state.messages.findLast(m => m.role === 'assistant');
  if (last) {
    last.isThinking = true;
    last.thinking = '';
  }
}

/** Append thinking text to the last assistant message. */
export function updateThinking(state: SessionState, text: string) {
  const last = state.messages.findLast(m => m.role === 'assistant');
  if (last) {
    last.thinking = (last.thinking || '') + text;
  }
}

/** Finish thinking on the last assistant message. */
export function finishThinking(state: SessionState) {
  const last = state.messages.findLast(m => m.role === 'assistant');
  if (last) {
    last.isThinking = false;
  }
}

/** Incrementally update tool input as JSON deltas arrive. */
export function appendToolInputDelta(state: SessionState, requestId: string, accumulatedJson: string) {
  const msg = state.messages.find(m => m.toolUse?.requestId === requestId);
  if (msg?.toolUse) {
    msg.toolUse.isInputStreaming = true;
    try {
      msg.toolUse.input = JSON.parse(accumulatedJson);
    } catch {
      // Partial JSON, can't parse yet
    }
  }
}

/** Set the final parsed tool input for a given request. */
export function updateToolInput(state: SessionState, requestId: string, input: Record<string, unknown>) {
  const msg = state.messages.find(m => m.toolUse?.requestId === requestId);
  if (msg?.toolUse) {
    msg.toolUse.input = input;
    msg.toolUse.isInputStreaming = false;
  }
}

/** Reset all fields on a SessionState back to defaults. */
export function clearSessionState(state: SessionState) {
  // Messages & streaming
  state.messages = [];
  state.isStreaming = false;
  state.streamStartTime = null;
  state.lastResponseMs = 0;
  state.contentVersion = 0;

  // Session identity
  state.sessionId = null;
  state.claudeSessionId = null;
  state.activeProjectDir = null;

  // Session lifecycle
  state.isLoadingSession = false;
  state.usage = { inputTokens: 0, outputTokens: 0, totalCost: 0 };
  state.sessionStartedAt = null;
  state.sessionLoadedIdle = false;

  // Pagination
  state.totalMessages = 0;
  state.hasMoreMessages = false;
  state.oldestLoadedIndex = 0;
  state.isLoadingMore = false;

  // UI state
  state.inPlanMode = false;
  state.planReviewText = null;
  state.isPlanReviewActive = false;
  state.planReviewRequestId = null;
  state.autoScroll = true;
}
