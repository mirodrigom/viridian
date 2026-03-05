import { watch, nextTick, type Ref } from 'vue';

const DRAFT_KEY = 'chat-draft';

export function useDraftPersistence(
  input: Ref<string>,
  sessionId: () => string | null,
  autoResize: () => void,
) {
  function getDrafts(): Record<string, string> {
    try {
      return JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}');
    } catch {
      return {};
    }
  }

  function saveDraft() {
    const key = sessionId() || '_new';
    const drafts = getDrafts();
    if (input.value.trim()) {
      drafts[key] = input.value;
    } else {
      delete drafts[key];
    }
    localStorage.setItem(DRAFT_KEY, JSON.stringify(drafts));
  }

  function loadDraft() {
    const key = sessionId() || '_new';
    const drafts = getDrafts();
    input.value = drafts[key] || '';
    nextTick(() => autoResize());
  }

  function clearDraft() {
    const key = sessionId() || '_new';
    const drafts = getDrafts();
    delete drafts[key];
    localStorage.setItem(DRAFT_KEY, JSON.stringify(drafts));
  }

  return {
    getDrafts,
    saveDraft,
    loadDraft,
    clearDraft,
  };
}
