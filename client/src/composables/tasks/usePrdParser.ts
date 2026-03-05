import { ref, watch, nextTick } from 'vue';
import { toast } from 'vue-sonner';
import type { TaskStatus, TaskPriority } from '@/stores/tasks';

type PrdPhase = 'input' | 'chat' | 'finalizing';

interface PrdParserDeps {
  projectPath: () => string | null;
  tasksStore: {
    prdChatting: boolean;
    prdFinalizing: boolean;
    sendPrdMessage: (
      projectPath: string,
      message: string,
      prdContent: string | undefined,
      sessionId: string | undefined,
      onChunk: (text: string) => void,
    ) => Promise<string | null>;
    finalizePrd: (
      projectPath: string,
      sessionId: string,
      prdContent: string,
      onChunk: (text: string) => void,
    ) => Promise<void>;
    parsePrd: (
      projectPath: string,
      content: string,
      onChunk: (text: string) => void,
    ) => Promise<void>;
  };
}

export function usePrdParser(deps: PrdParserDeps) {
  const showPrdDialog = ref(false);
  const prdText = ref('');
  const prdOutput = ref('');

  // PRD chat state
  const prdPhase = ref<PrdPhase>('input');
  const prdMessages = ref<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
  const prdChatInput = ref('');
  const prdStreamBuffer = ref('');
  const prdChatSessionId = ref<string | null>(null);
  const prdFinalizingOutput = ref('');
  const prdChatScroll = ref<HTMLElement | null>(null);

  function scrollPrdToBottom() {
    nextTick(() => {
      if (prdChatScroll.value) prdChatScroll.value.scrollTop = prdChatScroll.value.scrollHeight;
    });
  }

  function resetPrdDialog() {
    prdPhase.value = 'input';
    prdMessages.value = [];
    prdChatInput.value = '';
    prdStreamBuffer.value = '';
    prdChatSessionId.value = null;
    prdFinalizingOutput.value = '';
    prdOutput.value = '';
  }

  watch(showPrdDialog, (open) => {
    if (!open) resetPrdDialog();
  });

  async function handleStartPrdChat() {
    const projectPath = deps.projectPath();
    if (!prdText.value.trim() || !projectPath) return;
    const userMessage = 'Please analyze this PRD and describe how you\'d break it into implementation tasks.';
    prdMessages.value = [{ role: 'user', content: userMessage }];
    prdStreamBuffer.value = '';
    prdPhase.value = 'chat';
    scrollPrdToBottom();

    try {
      const sid = await deps.tasksStore.sendPrdMessage(
        projectPath,
        userMessage,
        prdText.value,
        undefined,
        (text) => { prdStreamBuffer.value += text; scrollPrdToBottom(); },
      );
      prdMessages.value.push({ role: 'assistant', content: prdStreamBuffer.value });
      prdStreamBuffer.value = '';
      if (sid) prdChatSessionId.value = sid;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'PRD analysis failed');
      prdPhase.value = 'input';
    }
  }

  async function handlePrdReply() {
    const projectPath = deps.projectPath();
    const message = prdChatInput.value.trim();
    if (!message || !projectPath || !prdChatSessionId.value) return;
    prdChatInput.value = '';
    prdMessages.value.push({ role: 'user', content: message });
    prdStreamBuffer.value = '';
    scrollPrdToBottom();

    try {
      const sid = await deps.tasksStore.sendPrdMessage(
        projectPath,
        message,
        undefined,
        prdChatSessionId.value,
        (text) => { prdStreamBuffer.value += text; scrollPrdToBottom(); },
      );
      prdMessages.value.push({ role: 'assistant', content: prdStreamBuffer.value });
      prdStreamBuffer.value = '';
      if (sid) prdChatSessionId.value = sid;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Reply failed');
    }
  }

  async function handleFinalizePrd() {
    const projectPath = deps.projectPath();
    if (!projectPath || !prdChatSessionId.value) return;
    prdPhase.value = 'finalizing';
    prdFinalizingOutput.value = '';

    try {
      await deps.tasksStore.finalizePrd(
        projectPath,
        prdChatSessionId.value,
        prdText.value,
        (text) => { prdFinalizingOutput.value += text; },
      );
      prdText.value = '';
      resetPrdDialog();
      showPrdDialog.value = false;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Task generation failed');
      prdPhase.value = 'chat';
    }
  }

  async function handleParsePrd() {
    const projectPath = deps.projectPath();
    if (!prdText.value.trim() || !projectPath) return;
    prdOutput.value = '';
    await deps.tasksStore.parsePrd(projectPath, prdText.value, (text) => {
      prdOutput.value += text;
    });
    prdText.value = '';
    showPrdDialog.value = false;
  }

  return {
    showPrdDialog,
    prdText,
    prdOutput,
    prdPhase,
    prdMessages,
    prdChatInput,
    prdStreamBuffer,
    prdChatSessionId,
    prdFinalizingOutput,
    prdChatScroll,
    resetPrdDialog,
    handleStartPrdChat,
    handlePrdReply,
    handleFinalizePrd,
    handleParsePrd,
    scrollPrdToBottom,
  };
}
