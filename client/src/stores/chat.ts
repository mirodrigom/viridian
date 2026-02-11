import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

export interface ToolUseInfo {
  tool: string;
  input: Record<string, unknown>;
  requestId: string;
  status: 'pending' | 'approved' | 'rejected';
  isInputStreaming?: boolean;
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
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalCost: number;
}

export const useChatStore = defineStore('chat', () => {
  const messages = ref<ChatMessage[]>([]);
  const isStreaming = ref(false);
  const sessionId = ref<string | null>(null);
  const projectPath = ref<string | null>(null);
  const usage = ref<TokenUsage>({ inputTokens: 0, outputTokens: 0, totalCost: 0 });
  const streamStartTime = ref<number | null>(null);
  const lastResponseMs = ref(0);
  const sessionStartedAt = ref<number | null>(null);

  const lastMessage = computed(() => messages.value[messages.value.length - 1]);

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

  /** Next rate limit reset: midnight Pacific Time (UTC-8 / UTC-7 DST) */
  const rateLimitReset = computed(() => {
    const now = new Date();
    // Use Pacific Time offset via formatting
    const ptStr = now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' });
    const ptNow = new Date(ptStr);
    const ptMidnight = new Date(ptNow);
    ptMidnight.setDate(ptMidnight.getDate() + 1);
    ptMidnight.setHours(0, 0, 0, 0);
    const diffMs = ptMidnight.getTime() - ptNow.getTime();
    const hours = Math.floor(diffMs / 3600000);
    const mins = Math.floor((diffMs % 3600000) / 60000);
    return `${hours}h ${mins}m`;
  });

  function addMessage(msg: ChatMessage) {
    messages.value.push(msg);
  }

  function updateLastAssistantContent(text: string) {
    const last = messages.value.findLast(m => m.role === 'assistant');
    if (last) {
      last.content += text;
    }
  }

  function finishStreaming() {
    isStreaming.value = false;
    if (streamStartTime.value) {
      lastResponseMs.value = Date.now() - streamStartTime.value;
      streamStartTime.value = null;
    }
    const last = messages.value.findLast(m => m.role === 'assistant');
    if (last) {
      last.isStreaming = false;
    }
  }

  function updateUsage(data: Partial<TokenUsage>) {
    if (data.inputTokens !== undefined) usage.value.inputTokens = data.inputTokens;
    if (data.outputTokens !== undefined) usage.value.outputTokens = data.outputTokens;
    if (data.totalCost !== undefined) usage.value.totalCost = data.totalCost;
  }

  function startStreaming() {
    isStreaming.value = true;
    streamStartTime.value = Date.now();
    if (!sessionStartedAt.value) {
      sessionStartedAt.value = Date.now();
    }
  }

  function clearMessages() {
    messages.value = [];
    sessionId.value = null;
    usage.value = { inputTokens: 0, outputTokens: 0, totalCost: 0 };
    sessionStartedAt.value = null;
  }

  function setProjectPath(path: string) {
    projectPath.value = path;
  }

  function loadMessages(msgs: ChatMessage[]) {
    messages.value = msgs;
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

  return {
    messages, isStreaming, sessionId, projectPath, usage,
    lastMessage, totalTokens, contextPercent, lastResponseMs,
    sessionStartedAt, sessionDurationMin, tokensPerMin, rateLimitReset,
    addMessage, updateLastAssistantContent, finishStreaming,
    updateUsage, startStreaming, clearMessages, setProjectPath,
    loadMessages, startThinking, updateThinking, finishThinking,
    appendToolInputDelta, updateToolInput,
  };
});
