import { defineStore } from 'pinia';
import { useChatMessages, type ChatMessage } from '../composables/useChatMessages';
import { useChatSession } from '../composables/useChatSession';
import { useChatPagination } from '../composables/useChatPagination';
import { useChatUI } from '../composables/useChatUI';

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
  };
});
