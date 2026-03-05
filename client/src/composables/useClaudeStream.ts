import { useChatStore } from '@/stores/chat';
import { useSettingsStore } from '@/stores/settings';
import { useProviderStore } from '@/stores/provider';
import { useWebSocket } from './useWebSocket';
import { useRouter } from 'vue-router';
import { uuid } from '@/lib/utils';
import { useStreamHandlers, useSessionRecovery, useRateLimitDetector } from './stream';
import type { StreamContext } from './stream';

const THINKING_PREFIXES: Record<string, string> = {
  think: 'think before responding.\n\n',
  think_hard: 'think hard before responding.\n\n',
  think_harder: 'think harder before responding.\n\n',
  ultrathink: 'ultrathink before responding.\n\n',
};

export function useClaudeStream() {
  const chat = useChatStore();
  const settings = useSettingsStore();
  const providerStore = useProviderStore();
  const router = useRouter();
  const { connected, connect, send, on, disconnect } = useWebSocket('/ws/chat');

  // Build shared context for sub-composables
  const ctx: StreamContext = {
    chat,
    settings,
    providerStore,
    router,
    ws: { connected, connect, send, on, disconnect },
  };

  // Wire up sub-composables
  const rateLimitDetector = useRateLimitDetector(chat);
  const sessionRecovery = useSessionRecovery(chat, providerStore);
  const { registerHandlers, cleanup: handlersCleanup } = useStreamHandlers({
    ctx,
    rateLimitDetector,
    sessionRecovery,
  });

  function init() {
    connect();
    chat.registerAbort(abort);
    registerHandlers();
  }

  function sendMessage(prompt: string, images?: { name: string; dataUrl: string }[]) {
    // Reject any pending AskUserQuestion tools so their modals close before
    // the new stream starts (user is bypassing the question by typing directly)
    for (const msg of chat.messages) {
      if (msg.toolUse?.tool === 'AskUserQuestion' && msg.toolUse.status === 'pending') {
        msg.toolUse.status = 'rejected';
      }
    }

    chat.addMessage({
      id: uuid(),
      role: 'user',
      content: prompt,
      timestamp: Date.now(),
      images: images?.length ? images : undefined,
    });

    // Prepend thinking instruction if non-standard mode selected
    const prefix = THINKING_PREFIXES[settings.thinkingMode] || '';
    const effectivePrompt = prefix ? prefix + prompt : prompt;

    const payload: Record<string, unknown> = {
      type: 'chat',
      prompt: effectivePrompt,
      sessionId: chat.sessionId,
      claudeSessionId: chat.claudeSessionId,
      cwd: chat.projectPath,
      provider: providerStore.activeProviderId,
      model: settings.model,
      permissionMode: settings.permissionMode,
      allowedTools: settings.allowedTools,
      disallowedTools: settings.disallowedTools,
      maxOutputTokens: settings.maxOutputTokens || undefined,
    };
    if (images?.length) {
      payload.images = images.map(img => ({ name: img.name, dataUrl: img.dataUrl }));
    }
    const sent = send(payload);
    if (!sent) {
      chat.addMessage({
        id: uuid(),
        role: 'system',
        content: 'Error: Not connected to server. Reconnecting…',
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Send a message to the server without adding a visible user bubble in the chat.
   * Used by AskUserQuestion to deliver answers as a new turn via --resume.
   */
  function sendSilentMessage(prompt: string) {
    const payload: Record<string, unknown> = {
      type: 'chat',
      prompt,
      sessionId: chat.sessionId,
      claudeSessionId: chat.claudeSessionId,
      cwd: chat.projectPath,
      provider: providerStore.activeProviderId,
      model: settings.model,
      permissionMode: settings.permissionMode,
      allowedTools: settings.allowedTools,
      disallowedTools: settings.disallowedTools,
      maxOutputTokens: settings.maxOutputTokens || undefined,
    };
    send(payload);
  }

  function respondToTool(requestId: string, approved: boolean, answers?: Record<string, string>) {
    const msg = chat.messages.find(m => m.toolUse?.requestId === requestId);
    const controlRequestId = msg?.toolUse?.controlRequestId || requestId;
    if (!msg?.toolUse?.controlRequestId) {
      console.warn(`[respondToTool] controlRequestId not found on tool message (requestId=${requestId}), using fallback`);
    }
    const questions = answers && msg?.toolUse?.input?.questions ? msg.toolUse.input.questions : undefined;
    if (answers && !questions) {
      console.warn(`[respondToTool] Answers provided but no questions found on tool input — server will need to use fallback`);
    }
    const sent = send({ type: 'tool_response', requestId: controlRequestId, approved, answers, questions, sessionId: chat.sessionId });
    if (!sent) {
      console.warn('[respondToTool] WebSocket send failed — tool response not delivered');
      return;
    }
    if (msg?.toolUse) {
      msg.toolUse.status = approved ? 'approved' : 'rejected';
      if (answers) {
        msg.toolUse.input._userAnswers = answers;
      }
    }
  }

  function abort() {
    const sent = send({ type: 'abort', sessionId: chat.sessionId });
    if (!sent) {
      chat.finishStreaming();
    }
  }

  function checkSession(sessionId: string) {
    send({ type: 'check_session', sessionId });
  }

  function cleanup() {
    handlersCleanup();
    disconnect();
  }

  return { connected, init, sendMessage, sendSilentMessage, respondToTool, abort, disconnect: cleanup, checkSession };
}
