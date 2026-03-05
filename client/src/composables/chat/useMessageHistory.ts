import { ref, nextTick, type Ref } from 'vue';

const HISTORY_KEY = 'chat-message-history';
const MAX_HISTORY = 50;

export function useMessageHistory(
  input: Ref<string>,
  textarea: Ref<HTMLTextAreaElement | null>,
  autoResize: () => void,
) {
  const messageHistory = ref<string[]>([]);
  const historyIndex = ref(-1);
  const currentDraft = ref('');
  const isNavigatingHistory = ref(false);

  function getMessageHistory(): string[] {
    try {
      return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    } catch {
      return [];
    }
  }

  function saveMessageHistory() {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(messageHistory.value));
  }

  function addToHistory(message: string) {
    const trimmed = message.trim();
    if (!trimmed) return;

    // Remove duplicate if it exists
    const existing = messageHistory.value.indexOf(trimmed);
    if (existing !== -1) {
      messageHistory.value.splice(existing, 1);
    }

    // Add to the beginning
    messageHistory.value.unshift(trimmed);

    // Keep only the latest MAX_HISTORY entries
    if (messageHistory.value.length > MAX_HISTORY) {
      messageHistory.value = messageHistory.value.slice(0, MAX_HISTORY);
    }

    saveMessageHistory();
  }

  function loadMessageHistory() {
    messageHistory.value = getMessageHistory();
  }

  function resetHistoryNavigation() {
    historyIndex.value = -1;
    currentDraft.value = '';
    isNavigatingHistory.value = false;
  }

  function navigateHistory(direction: 'up' | 'down') {
    if (direction === 'up') {
      if (historyIndex.value === -1) {
        // Starting navigation - save current input as draft
        currentDraft.value = input.value;
        if (messageHistory.value.length === 0) return;
        historyIndex.value = 0;
      } else if (historyIndex.value < messageHistory.value.length - 1) {
        historyIndex.value++;
      } else {
        return; // Already at the oldest message
      }

      input.value = messageHistory.value[historyIndex.value] || '';
      isNavigatingHistory.value = true;
    } else if (direction === 'down') {
      if (historyIndex.value === -1) return; // Not navigating

      if (historyIndex.value > 0) {
        historyIndex.value--;
        input.value = messageHistory.value[historyIndex.value] || '';
      } else {
        // Return to draft
        input.value = currentDraft.value;
        resetHistoryNavigation();
      }
    }

    nextTick(() => {
      autoResize();
      // Move cursor to end
      const el = textarea.value;
      if (el) {
        el.setSelectionRange(el.value.length, el.value.length);
      }
    });
  }

  return {
    messageHistory,
    historyIndex,
    currentDraft,
    isNavigatingHistory,
    addToHistory,
    loadMessageHistory,
    resetHistoryNavigation,
    navigateHistory,
  };
}
