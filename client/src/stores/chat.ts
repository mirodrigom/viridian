import { defineStore } from 'pinia';
import { useChatMessages, type ChatMessage } from '../composables/useChatMessages';
import { useChatSession } from '../composables/useChatSession';
import { useChatPagination } from '../composables/useChatPagination';
import { useChatUI } from '../composables/useChatUI';
import { apiFetch } from '../lib/apiFetch';

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

      // Switch to the new session (caller is responsible for URL update if needed)
      session.claudeSessionId.value = data.newSessionId;
      session.sessionId.value = null; // will be assigned by the server on first send

      return data.newSessionId;
    } catch (err) {
      console.error('[forkSession] error:', err);
      return null;
    }
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
  };
});
