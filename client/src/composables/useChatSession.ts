import { ref, computed, watch } from 'vue';

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalCost: number;
}

/**
 * Composable for managing chat session lifecycle and persistence
 */
export function useChatSession() {
  const isLoadingSession = ref(false);
  const isLoadingProject = ref(false);
  const sessionId = ref<string | null>(sessionStorage.getItem('chat-sessionId'));
  const claudeSessionId = ref<string | null>(sessionStorage.getItem('chat-claudeSessionId'));
  const projectPath = ref<string | null>(sessionStorage.getItem('chat-projectPath'));
  const activeProjectDir = ref<string | null>(sessionStorage.getItem('chat-activeProjectDir'));
  const usage = ref<TokenUsage>({ inputTokens: 0, outputTokens: 0, totalCost: 0 });
  const sessionStartedAt = ref<number | null>(null);

  // Set when a session loaded from disk is confirmed not streaming (via check_session)
  const sessionLoadedIdle = ref(false);

  // Pending prompt — set by other tabs (e.g. Tasks "Send to Chat") to pre-fill ChatInput
  const pendingPrompt = ref<string | null>(null);

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

  function setProjectPath(path: string) {
    projectPath.value = path;
  }

  function updateUsage(data: Partial<TokenUsage>) {
    if (data.inputTokens !== undefined) usage.value.inputTokens = data.inputTokens;
    if (data.outputTokens !== undefined) usage.value.outputTokens = data.outputTokens;
    if (data.totalCost !== undefined) usage.value.totalCost = data.totalCost;
  }

  function startSession() {
    if (!sessionStartedAt.value) {
      sessionStartedAt.value = Date.now();
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

  function clearSession() {
    sessionId.value = null;
    claudeSessionId.value = null;
    activeProjectDir.value = null;
    sessionLoadedIdle.value = false;
    usage.value = { inputTokens: 0, outputTokens: 0, totalCost: 0 };
    sessionStartedAt.value = null;
    pendingPrompt.value = null;
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

  return {
    // State
    isLoadingSession,
    isLoadingProject,
    sessionId,
    claudeSessionId,
    projectPath,
    activeProjectDir,
    usage,
    sessionStartedAt,
    sessionLoadedIdle,
    pendingPrompt,

    // Computed
    totalTokens,
    contextPercent,
    sessionDurationMin,
    tokensPerMin,

    // Actions
    setProjectPath,
    updateUsage,
    startSession,
    setPendingPrompt,
    consumePendingPrompt,
    clearSession,
  };
}