import { defineStore } from 'pinia';
import { useChatMessages, type ChatMessage } from '../composables/useChatMessages';
import { useChatSession } from '../composables/useChatSession';
import { useChatPagination } from '../composables/useChatPagination';
import { useChatUI } from '../composables/useChatUI';
import { apiFetch } from '../lib/apiFetch';
import { useSessionRegistry } from '../composables/useSessionRegistry';

// Re-export types for external consumers
export type { ToolUseInfo, ChatMessage } from '../composables/useChatMessages';
export type { TokenUsage } from '../composables/useChatSession';

export const useChatStore = defineStore('chat', () => {
  // Initialize composables
  const messages = useChatMessages();
  const session = useChatSession();
  const pagination = useChatPagination();
  const ui = useChatUI();

  // Enhanced functions that coordinate between composables
  function startStreaming() {
    messages.startStreaming();
    session.sessionLoadedIdle.value = false;
    session.startSession();
  }

  function finishStreaming() {
    messages.finishStreaming();
  }

  function clearMessages() {
    messages.clearMessages();
    session.clearSession();
    session.isLoadingSession.value = false;
    pagination.clearPagination();
    ui.clearUI();
  }

  function loadMessages(msgs: ChatMessage[], meta?: { total: number; hasMore: boolean; oldestIndex: number }) {
    // Clear existing messages and load new ones
    messages.messages.value = msgs;
    session.isLoadingSession.value = false;

    if (meta) {
      pagination.loadMessages(msgs, meta);
    } else {
      pagination.triggerScrollToBottom();
    }

    // Restore plan mode state from loaded messages
    ui.restorePlanModeFromMessages(msgs);
  }

  function prependMessages(msgs: ChatMessage[], meta: { hasMore: boolean; oldestIndex: number }) {
    messages.messages.value = [...msgs, ...messages.messages.value];
    pagination.prependMessages(msgs, meta);
  }

  function appendMessages(msgs: ChatMessage[], meta?: { total: number }) {
    messages.messages.value = [...messages.messages.value, ...msgs];
    pagination.appendMessages(msgs, meta);

    // Re-scan plan mode state since appended messages may contain ExitPlanMode
    ui.restorePlanModeFromMessages(messages.messages.value);
  }

  /**
   * Fork the current session up to (not including) the message with forkBeforeId,
   * then truncate the local message list to show only the kept history.
   * Returns the new session ID so the caller can send an edited message.
   */
  async function forkSession(forkBeforeId: string): Promise<string | null> {
    const projectDir = session.activeProjectDir.value;
    const currentSessionId = session.claudeSessionId.value;
    if (!projectDir || !currentSessionId) return null;

    try {
      const res = await apiFetch(`/api/sessions/${currentSessionId}/fork`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectDir, forkBeforeUuid: forkBeforeId }),
      });
      if (!res.ok) {
        console.error('[forkSession] server error', await res.text());
        return null;
      }
      const data = await res.json() as { newSessionId: string };

      // Truncate local messages to everything before the target message
      const cutoffIdx = messages.messages.value.findIndex(m => m.id === forkBeforeId);
      if (cutoffIdx >= 0) {
        messages.messages.value = messages.messages.value.slice(0, cutoffIdx);
      }

      // Switch to the new session (caller is responsible for URL update if needed).
      // Suppress clear_session: the sessionId watcher would fire and send clear_session
      // to the server, which would detach the emitter right after the forked chat
      // message is sent — causing the response to be silently dropped.
      // The caller resets suppressClearSession after nextTick (once the watcher has fired).
      session.suppressClearSession.value = true;
      session.claudeSessionId.value = data.newSessionId;
      session.sessionId.value = data.newSessionId; // known from fork response; prevents handleRoute from triggering loadSessionFromUrl

      return data.newSessionId;
    } catch (err) {
      console.error('[forkSession] error:', err);
      return null;
    }
  }

  const registry = useSessionRegistry();

  /**
   * Save the current store state into the session registry so it can be
   * restored later when the user switches back to this session.
   */
  function saveToRegistry() {
    const sid = session.claudeSessionId.value || session.sessionId.value;
    if (!sid) return;
    const state = registry.getOrCreateSession(sid);
    // Messages & streaming
    state.messages = [...messages.messages.value];
    state.isStreaming = messages.isStreaming.value;
    state.streamStartTime = messages.streamStartTime.value;
    state.lastResponseMs = messages.lastResponseMs.value;
    state.contentVersion = messages.contentVersion.value;
    // Session identity
    state.sessionId = session.sessionId.value;
    state.claudeSessionId = session.claudeSessionId.value;
    state.activeProjectDir = session.activeProjectDir.value;
    // Session lifecycle
    state.isLoadingSession = session.isLoadingSession.value;
    state.usage = { ...session.usage.value };
    state.sessionStartedAt = session.sessionStartedAt.value;
    state.sessionLoadedIdle = session.sessionLoadedIdle.value;
    // Pagination
    state.totalMessages = pagination.totalMessages.value;
    state.hasMoreMessages = pagination.hasMoreMessages.value;
    state.oldestLoadedIndex = pagination.oldestLoadedIndex.value;
    state.isLoadingMore = pagination.isLoadingMore.value;
    // UI
    state.inPlanMode = ui.inPlanMode.value;
    state.planReviewText = ui.planReviewText.value;
    state.isPlanReviewActive = ui.isPlanReviewActive.value;
    state.planReviewRequestId = ui.planReviewRequestId.value;
    state.autoScroll = ui.autoScroll.value;
  }

  /**
   * Restore store state from the session registry.
   * Returns true if the session was found in the registry.
   */
  function restoreFromRegistry(sessionId: string): boolean {
    const state = registry.sessions.get(sessionId);
    if (!state) return false;
    // Messages & streaming
    messages.messages.value = [...state.messages];
    messages.isStreaming.value = state.isStreaming;
    messages.streamStartTime.value = state.streamStartTime;
    messages.lastResponseMs.value = state.lastResponseMs;
    messages.contentVersion.value = state.contentVersion;
    // Session identity
    session.suppressClearSession.value = true;
    session.sessionId.value = state.sessionId;
    session.claudeSessionId.value = state.claudeSessionId;
    session.activeProjectDir.value = state.activeProjectDir;
    // Session lifecycle
    session.isLoadingSession.value = state.isLoadingSession;
    session.usage.value = { ...state.usage };
    session.sessionStartedAt.value = state.sessionStartedAt;
    session.sessionLoadedIdle.value = state.sessionLoadedIdle;
    // Pagination
    pagination.totalMessages.value = state.totalMessages;
    pagination.hasMoreMessages.value = state.hasMoreMessages;
    pagination.oldestLoadedIndex.value = state.oldestLoadedIndex;
    pagination.isLoadingMore.value = state.isLoadingMore;
    // UI
    ui.inPlanMode.value = state.inPlanMode;
    ui.planReviewText.value = state.planReviewText;
    ui.isPlanReviewActive.value = state.isPlanReviewActive;
    ui.planReviewRequestId.value = state.planReviewRequestId;
    ui.autoScroll.value = state.autoScroll;
    return true;
  }

  /**
   * Switch to a different session without aborting the current one.
   * Saves current state to registry, then restores target or returns false
   * if the target needs to be loaded from the API.
   */
  function switchSession(targetSessionId: string): boolean {
    const currentId = session.claudeSessionId.value || session.sessionId.value;
    if (currentId === targetSessionId) return true;
    // Save current session state
    saveToRegistry();
    // Try to restore from registry
    return restoreFromRegistry(targetSessionId);
  }

  return {
    // Messages composable
    ...messages,

    // Session composable
    ...session,

    // Pagination composable
    ...pagination,

    // UI composable
    ...ui,

    // Enhanced coordinating functions
    startStreaming,
    finishStreaming,
    clearMessages,
    loadMessages,
    prependMessages,
    appendMessages,
    forkSession,

    // Multi-session support
    saveToRegistry,
    restoreFromRegistry,
    switchSession,
    registry,
  };
});
