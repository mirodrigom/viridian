import { defineStore } from 'pinia';
import { ref, computed, watch } from 'vue';

export interface ToolUseInfo {
  tool: string;
  input: Record<string, unknown>;
  requestId: string;
  status: 'pending' | 'approved' | 'rejected';
  isInputStreaming?: boolean;
  /** The CLI's control_request ID for responding to permission prompts. */
  controlRequestId?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  toolUse?: ToolUseInfo;
  isStreaming?: boolean;
  thinking?: string;
  isThinking?: boolean;
  images?: { name: string; dataUrl: string }[];
  isContextSummary?: boolean;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalCost: number;
}

export const useChatStore = defineStore('chat', () => {
  const messages = ref<ChatMessage[]>([]);
  const isStreaming = ref(false);
  const isLoadingSession = ref(false);
  const sessionId = ref<string | null>(sessionStorage.getItem('chat-sessionId'));
  const claudeSessionId = ref<string | null>(sessionStorage.getItem('chat-claudeSessionId'));
  const projectPath = ref<string | null>(sessionStorage.getItem('chat-projectPath'));
  const activeProjectDir = ref<string | null>(sessionStorage.getItem('chat-activeProjectDir'));
  const usage = ref<TokenUsage>({ inputTokens: 0, outputTokens: 0, totalCost: 0 });
  const streamStartTime = ref<number | null>(null);
  const lastResponseMs = ref(0);
  const sessionStartedAt = ref<number | null>(null);

  // Set when a session loaded from disk is confirmed not streaming (via check_session)
  const sessionLoadedIdle = ref(false);

  // Pagination state
  const totalMessages = ref(0);
  const hasMoreMessages = ref(false);
  const oldestLoadedIndex = ref(0);
  const isLoadingMore = ref(false);

  // Scroll trigger — incremented after loadMessages to signal MessageList to scroll
  const scrollToBottomRequest = ref(0);

  // Auto-scroll state — shared so status bar can toggle it
  const autoScroll = ref(true);

  // Plan mode — toggled when Claude calls EnterPlanMode / ExitPlanMode
  const inPlanMode = ref(sessionStorage.getItem('chat-inPlanMode') === 'true');

  // Rate limit — timestamp (ms) until which the user is blocked
  const rateLimitedUntil = ref<number | null>(null);
  let rateLimitTimer: ReturnType<typeof setTimeout> | null = null;

  // Plan review — activated when ExitPlanMode captures the plan text
  const planReviewText = ref<string | null>(null);
  const isPlanReviewActive = ref(false);

  // Pending prompt — set by other tabs (e.g. Tasks "Send to Chat") to pre-fill ChatInput
  const pendingPrompt = ref<string | null>(null);

  // Abort callback — set by useClaudeStream so other components can abort without WS access
  let _abortFn: (() => void) | null = null;
  function registerAbort(fn: () => void) { _abortFn = fn; }
  function abortStream() { _abortFn?.(); }

  // Incremented on every content mutation to drive auto-scroll in MessageList
  const contentVersion = ref(0);

  const lastMessage = computed(() => messages.value[messages.value.length - 1]);

  // Latest TodoWrite todos — extracted from the most recent TodoWrite tool call
  // When streaming ends, in_progress tasks are auto-marked as completed
  const latestTodos = computed(() => {
    const lastTodoMsg = messages.value.findLast(m => m.toolUse?.tool === 'TodoWrite');
    if (!lastTodoMsg?.toolUse?.input.todos) return [];
    const todos = lastTodoMsg.toolUse.input.todos;
    if (!Array.isArray(todos)) return [];
    const typed = todos as { content: string; status: 'pending' | 'in_progress' | 'completed'; activeForm?: string }[];
    if (isStreaming.value) return typed;
    return typed.map(t => t.status === 'in_progress' ? { ...t, status: 'completed' as const } : t);
  });

  const totalTokens = computed(() => usage.value.inputTokens + usage.value.outputTokens);

  const contextPercent = computed(() => {
    const maxCtx = 200000;
    return Math.min(100, Math.round((usage.value.inputTokens / maxCtx) * 100));
  });

  const sessionDurationMin = computed(() => {
    if (!sessionStartedAt.value) return 0;
    return Math.max(1, Math.round((Date.now() - sessionStartedAt.value) / 60000));
  });

  const tokensPerMin = computed(() => {
    if (sessionDurationMin.value <= 0) return 0;
    return Math.round(totalTokens.value / sessionDurationMin.value);
  });

  const isRateLimited = computed(() => {
    return rateLimitedUntil.value !== null && Date.now() < rateLimitedUntil.value;
  });

  const rateLimitRemainingMs = computed(() => {
    if (!rateLimitedUntil.value) return 0;
    return Math.max(0, rateLimitedUntil.value - Date.now());
  });

  function setRateLimitedUntil(until: number) {
    rateLimitedUntil.value = until;
    // Auto-clear when timer expires
    if (rateLimitTimer) clearTimeout(rateLimitTimer);
    const remaining = until - Date.now();
    if (remaining > 0) {
      rateLimitTimer = setTimeout(() => {
        rateLimitedUntil.value = null;
      }, remaining);
    }
  }

  function clearRateLimit() {
    rateLimitedUntil.value = null;
    if (rateLimitTimer) {
      clearTimeout(rateLimitTimer);
      rateLimitTimer = null;
    }
  }

  function addMessage(msg: ChatMessage) {
    messages.value.push(msg);
  }

  function updateLastAssistantContent(text: string) {
    const last = messages.value.findLast(m => m.role === 'assistant');
    if (last) {
      last.content += text;
      contentVersion.value++;
    }
  }

  function finishStreaming() {
    isStreaming.value = false;
    if (streamStartTime.value) {
      lastResponseMs.value = Date.now() - streamStartTime.value;
      streamStartTime.value = null;
    }
    // Clear isStreaming on all assistant messages (there may be multiple
    // when text was split around tool_use blocks during streaming)
    for (const msg of messages.value) {
      if (msg.role === 'assistant' && msg.isStreaming) {
        msg.isStreaming = false;
      }
    }
    // Remove trailing empty assistant messages (e.g. from rate limit errors
    // where stream_start created the bubble but no text arrived)
    while (messages.value.length > 0) {
      const last = messages.value[messages.value.length - 1]!;
      if (last.role === 'assistant' && !last.content.trim()) {
        messages.value.pop();
      } else {
        break;
      }
    }
  }

  function updateUsage(data: Partial<TokenUsage>) {
    if (data.inputTokens !== undefined) usage.value.inputTokens = data.inputTokens;
    if (data.outputTokens !== undefined) usage.value.outputTokens = data.outputTokens;
    if (data.totalCost !== undefined) usage.value.totalCost = data.totalCost;
  }

  function startStreaming() {
    isStreaming.value = true;
    sessionLoadedIdle.value = false;
    streamStartTime.value = Date.now();
    if (!sessionStartedAt.value) {
      sessionStartedAt.value = Date.now();
    }
  }

  function clearMessages() {
    messages.value = [];
    isStreaming.value = false;
    streamStartTime.value = null;
    sessionId.value = null;
    claudeSessionId.value = null;
    activeProjectDir.value = null;
    sessionLoadedIdle.value = false;
    totalMessages.value = 0;
    hasMoreMessages.value = false;
    oldestLoadedIndex.value = 0;
    usage.value = { inputTokens: 0, outputTokens: 0, totalCost: 0 };
    sessionStartedAt.value = null;
    inPlanMode.value = false;
    planReviewText.value = null;
    isPlanReviewActive.value = false;
    pendingPrompt.value = null;
    clearRateLimit();
  }

  function setProjectPath(path: string) {
    projectPath.value = path;
  }

  function loadMessages(msgs: ChatMessage[], meta?: { total: number; hasMore: boolean; oldestIndex: number }) {
    messages.value = msgs;
    isLoadingSession.value = false;
    if (meta) {
      totalMessages.value = meta.total;
      hasMoreMessages.value = meta.hasMore;
      oldestLoadedIndex.value = meta.oldestIndex;
    }
    // Restore plan mode state from loaded messages
    restorePlanModeFromMessages(msgs);
    // Signal MessageList to scroll to bottom
    scrollToBottomRequest.value++;
  }

  /** Scan messages for EnterPlanMode / ExitPlanMode tool calls to restore plan mode state. */
  function restorePlanModeFromMessages(msgs: ChatMessage[]) {
    let planMode = false;
    for (const msg of msgs) {
      if (msg.toolUse?.tool === 'EnterPlanMode') {
        planMode = true;
      } else if (msg.toolUse?.tool === 'ExitPlanMode') {
        planMode = false;
      }
    }
    inPlanMode.value = planMode;
  }

  function prependMessages(msgs: ChatMessage[], meta: { hasMore: boolean; oldestIndex: number }) {
    messages.value = [...msgs, ...messages.value];
    hasMoreMessages.value = meta.hasMore;
    oldestLoadedIndex.value = meta.oldestIndex;
  }

  function appendMessages(msgs: ChatMessage[], meta?: { total: number }) {
    messages.value = [...messages.value, ...msgs];
    if (meta) {
      totalMessages.value = meta.total;
    }
    // Re-scan plan mode state since appended messages may contain ExitPlanMode
    restorePlanModeFromMessages(messages.value);
  }

  function startThinking() {
    const last = messages.value.findLast(m => m.role === 'assistant');
    if (last) {
      last.isThinking = true;
      last.thinking = '';
    }
  }

  function updateThinking(text: string) {
    const last = messages.value.findLast(m => m.role === 'assistant');
    if (last) {
      last.thinking = (last.thinking || '') + text;
    }
  }

  function finishThinking() {
    const last = messages.value.findLast(m => m.role === 'assistant');
    if (last) {
      last.isThinking = false;
    }
  }

  function appendToolInputDelta(requestId: string, accumulatedJson: string) {
    const msg = messages.value.find(m => m.toolUse?.requestId === requestId);
    if (msg?.toolUse) {
      msg.toolUse.isInputStreaming = true;
      try {
        msg.toolUse.input = JSON.parse(accumulatedJson);
      } catch {
        // Partial JSON, can't parse yet
      }
    }
  }

  function updateToolInput(requestId: string, input: Record<string, unknown>) {
    const msg = messages.value.find(m => m.toolUse?.requestId === requestId);
    if (msg?.toolUse) {
      msg.toolUse.input = input;
      msg.toolUse.isInputStreaming = false;
    }
  }

  function setPendingPrompt(prompt: string) {
    pendingPrompt.value = prompt;
  }

  function consumePendingPrompt(): string | null {
    const p = pendingPrompt.value;
    pendingPrompt.value = null;
    return p;
  }

  function activatePlanReview(planText: string) {
    planReviewText.value = planText;
    isPlanReviewActive.value = true;
  }

  function dismissPlanReview() {
    planReviewText.value = null;
    isPlanReviewActive.value = false;
  }

  // Persist session identity across page reloads so we can detect active streaming
  watch(sessionId, (v) => {
    if (v) sessionStorage.setItem('chat-sessionId', v);
    else sessionStorage.removeItem('chat-sessionId');
  });
  watch(claudeSessionId, (v) => {
    if (v) sessionStorage.setItem('chat-claudeSessionId', v);
    else sessionStorage.removeItem('chat-claudeSessionId');
  });
  watch(activeProjectDir, (v) => {
    if (v) sessionStorage.setItem('chat-activeProjectDir', v);
    else sessionStorage.removeItem('chat-activeProjectDir');
  });
  watch(projectPath, (v) => {
    if (v) sessionStorage.setItem('chat-projectPath', v);
    else sessionStorage.removeItem('chat-projectPath');
  });
  watch(inPlanMode, (v) => {
    if (v) sessionStorage.setItem('chat-inPlanMode', 'true');
    else sessionStorage.removeItem('chat-inPlanMode');
  });

  return {
    messages, isStreaming, isLoadingSession, sessionId, claudeSessionId, projectPath, activeProjectDir, usage,
    lastMessage, latestTodos, totalTokens, contextPercent, lastResponseMs, streamStartTime, sessionLoadedIdle,
    sessionStartedAt, sessionDurationMin, tokensPerMin, inPlanMode,
    planReviewText, isPlanReviewActive,
    totalMessages, hasMoreMessages, oldestLoadedIndex, isLoadingMore, scrollToBottomRequest, autoScroll, contentVersion,
    rateLimitedUntil, isRateLimited, rateLimitRemainingMs,
    addMessage, updateLastAssistantContent, finishStreaming,
    updateUsage, startStreaming, clearMessages, setProjectPath,
    loadMessages, prependMessages, appendMessages,
    startThinking, updateThinking, finishThinking,
    appendToolInputDelta, updateToolInput,
    activatePlanReview, dismissPlanReview,
    pendingPrompt, setPendingPrompt, consumePendingPrompt,
    setRateLimitedUntil, clearRateLimit,
    registerAbort, abortStream,
  };
});
