import { ref } from 'vue';
import type { ChatMessage } from './useChatMessages';

/**
 * Composable for managing chat message pagination and loading states
 */
export function useChatPagination() {
  const totalMessages = ref(0);
  const hasMoreMessages = ref(false);
  const oldestLoadedIndex = ref(0);
  const isLoadingMore = ref(false);

  // Scroll trigger — incremented after loadMessages to signal MessageList to scroll
  const scrollToBottomRequest = ref(0);

  function loadMessages(msgs: ChatMessage[], meta?: { total: number; hasMore: boolean; oldestIndex: number }) {
    if (meta) {
      totalMessages.value = meta.total;
      hasMoreMessages.value = meta.hasMore;
      oldestLoadedIndex.value = meta.oldestIndex;
    }
    // Signal MessageList to scroll to bottom
    scrollToBottomRequest.value++;
  }

  function prependMessages(msgs: ChatMessage[], meta: { hasMore: boolean; oldestIndex: number }) {
    hasMoreMessages.value = meta.hasMore;
    oldestLoadedIndex.value = meta.oldestIndex;
  }

  function appendMessages(msgs: ChatMessage[], meta?: { total: number }) {
    if (meta) {
      totalMessages.value = meta.total;
    }
  }

  function startLoadingMore() {
    isLoadingMore.value = true;
  }

  function finishLoadingMore() {
    isLoadingMore.value = false;
  }

  function clearPagination() {
    totalMessages.value = 0;
    hasMoreMessages.value = false;
    oldestLoadedIndex.value = 0;
    isLoadingMore.value = false;
  }

  function triggerScrollToBottom() {
    scrollToBottomRequest.value++;
  }

  return {
    // State
    totalMessages,
    hasMoreMessages,
    oldestLoadedIndex,
    isLoadingMore,
    scrollToBottomRequest,

    // Actions
    loadMessages,
    prependMessages,
    appendMessages,
    startLoadingMore,
    finishLoadingMore,
    clearPagination,
    triggerScrollToBottom,
  };
}