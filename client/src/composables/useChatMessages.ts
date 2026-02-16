import { ref, computed } from 'vue';

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

/**
 * Composable for managing chat messages and streaming state
 */
export function useChatMessages() {
  const messages = ref<ChatMessage[]>([]);
  const isStreaming = ref(false);
  const streamStartTime = ref<number | null>(null);
  const lastResponseMs = ref(0);
  const contentVersion = ref(0);

  // Abort callback — set by useClaudeStream so other components can abort without WS access
  let _abortFn: (() => void) | null = null;

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

  function startStreaming() {
    isStreaming.value = true;
    streamStartTime.value = Date.now();
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

  function clearMessages() {
    messages.value = [];
    isStreaming.value = false;
    streamStartTime.value = null;
  }

  function registerAbort(fn: () => void) {
    _abortFn = fn;
  }

  function abortStream() {
    _abortFn?.();
  }

  return {
    // State
    messages,
    isStreaming,
    streamStartTime,
    lastResponseMs,
    contentVersion,
    lastMessage,
    latestTodos,

    // Actions
    addMessage,
    updateLastAssistantContent,
    startStreaming,
    finishStreaming,
    startThinking,
    updateThinking,
    finishThinking,
    appendToolInputDelta,
    updateToolInput,
    clearMessages,
    registerAbort,
    abortStream,
  };
}