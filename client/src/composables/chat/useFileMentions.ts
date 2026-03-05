import { ref, computed, watch, nextTick, type Ref } from 'vue';
import { apiFetch } from '@/lib/apiFetch';
import { useChatStore } from '@/stores/chat';

export function useFileMentions(
  input: Ref<string>,
  textarea: Ref<HTMLTextAreaElement | null>,
  showCommandMenu: Ref<boolean>,
  closeTemplateMenu: () => void,
) {
  const chat = useChatStore();

  const mentionedFiles = ref<string[]>([]);
  const fileSuggestions = ref<string[]>([]);
  const selectedFileIndex = ref(0);
  let fileSearchTimer: ReturnType<typeof setTimeout> | null = null;

  const mentionQuery = computed(() => {
    if (showCommandMenu.value) return null;
    const el = textarea.value;
    if (!el) return null;
    const pos = el.selectionStart;
    const text = input.value.slice(0, pos);
    const atIdx = text.lastIndexOf('@');
    if (atIdx === -1) return null;
    // Must be start of line or after whitespace
    if (atIdx > 0 && !/\s/.test(text[atIdx - 1]!)) return null;
    const query = text.slice(atIdx + 1);
    // Stop if there's whitespace after the @ (mention already complete)
    if (/\s/.test(query)) return null;
    return { query, start: atIdx };
  });

  const showFileMenu = computed(() => {
    return mentionQuery.value !== null && mentionQuery.value.query.length >= 1 && fileSuggestions.value.length > 0;
  });

  // Close template menu when file menu opens
  watch(showFileMenu, (show) => {
    if (show) {
      closeTemplateMenu();
    }
  });

  watch(mentionQuery, (mq) => {
    if (fileSearchTimer) clearTimeout(fileSearchTimer);
    if (!mq || mq.query.length < 1) {
      fileSuggestions.value = [];
      return;
    }
    fileSearchTimer = setTimeout(async () => {
      if (!chat.projectPath) return;
      try {
        const res = await apiFetch(
          `/api/files/search?root=${encodeURIComponent(chat.projectPath)}&q=${encodeURIComponent(mq.query)}`,
        );
        if (!res.ok) return;
        const data = await res.json();
        fileSuggestions.value = (data.files || []).filter((f: string) => !mentionedFiles.value.includes(f));
        selectedFileIndex.value = 0;
      } catch { /* ignore */ }
    }, 200);
  });

  function selectFileMention(filePath: string) {
    if (!mentionedFiles.value.includes(filePath)) {
      mentionedFiles.value.push(filePath);
    }
    // Remove the @query from input
    const mq = mentionQuery.value;
    if (mq) {
      input.value = input.value.slice(0, mq.start) + input.value.slice(mq.start + 1 + mq.query.length);
    }
    fileSuggestions.value = [];
    nextTick(() => textarea.value?.focus());
  }

  function removeFileMention(filePath: string) {
    mentionedFiles.value = mentionedFiles.value.filter(f => f !== filePath);
  }

  return {
    mentionedFiles,
    fileSuggestions,
    selectedFileIndex,
    mentionQuery,
    showFileMenu,
    selectFileMention,
    removeFileMention,
  };
}
