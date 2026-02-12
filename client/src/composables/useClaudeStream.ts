import { watch } from 'vue';
import { useChatStore, type ChatMessage } from '@/stores/chat';
import { useSettingsStore } from '@/stores/settings';
import { useAuthStore } from '@/stores/auth';
import { useWebSocket } from './useWebSocket';
import { useRouter } from 'vue-router';

export function useClaudeStream() {
  const chat = useChatStore();
  const settings = useSettingsStore();
  const auth = useAuthStore();
  const router = useRouter();
  const { connected, connect, send, on, disconnect } = useWebSocket('/ws/chat');

  function init() {
    connect();

    // Track whether the next text delta needs a fresh assistant message
    // (set after a tool_use so text after tools gets its own bubble, matching reload layout)
    let needsNewAssistantMsg = false;
    // Track whether we reconnected mid-stream so we can do a full refresh on stream_end
    let reconnectedMidStream = false;

    // When WS connects (or reconnects), check if active session is still streaming
    watch(connected, (isConnected) => {
      if (isConnected && chat.sessionId) {
        send({ type: 'check_session', sessionId: chat.sessionId });
      }
    });

    on('stream_start', () => {
      chat.startStreaming();
      needsNewAssistantMsg = false;
      reconnectedMidStream = false;
      const msg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        isStreaming: true,
      };
      chat.addMessage(msg);
    });

    on('stream_delta', (data: unknown) => {
      const d = data as { text: string };
      if (needsNewAssistantMsg) {
        // Text arriving after a tool — create a new assistant message
        // so the layout matches the reload path (text → tool → text split)
        needsNewAssistantMsg = false;
        // Clear isStreaming on the previous assistant message
        const prev = chat.messages.findLast(m => m.role === 'assistant');
        if (prev) prev.isStreaming = false;
        const msg: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: d.text,
          timestamp: Date.now(),
          isStreaming: true,
        };
        chat.addMessage(msg);
      } else {
        chat.updateLastAssistantContent(d.text);
      }
    });

    on('stream_end', (data: unknown) => {
      needsNewAssistantMsg = false;
      const d = data as {
        sessionId?: string;
        claudeSessionId?: string;
        usage?: { input_tokens?: number; output_tokens?: number };
        totalCost?: number;
      };
      if (d.sessionId) {
        const isNewSession = !chat.sessionId;
        chat.sessionId = d.sessionId;
        // Update URL to reflect the session (replace for first message, don't stack history)
        if (isNewSession) {
          router.replace({
            name: 'chat-session',
            params: { sessionId: d.sessionId },
          });
        }
      }
      if (d.usage) {
        chat.updateUsage({
          inputTokens: d.usage.input_tokens || 0,
          outputTokens: d.usage.output_tokens || 0,
          totalCost: d.totalCost || 0,
        });
      }
      chat.finishStreaming();

      // If we reconnected mid-stream, we likely missed tool events and intermediate
      // messages. Do a full reload from disk to get the complete conversation.
      if (reconnectedMidStream && chat.sessionId && chat.activeProjectDir) {
        reconnectedMidStream = false;
        reloadSession(chat.sessionId, chat.activeProjectDir);
      }
    });

    on('tool_use', (data: unknown) => {
      const d = data as { tool: string; input: Record<string, unknown>; requestId: string };
      // Mark current assistant message as done — next text delta gets a new bubble
      needsNewAssistantMsg = true;
      // Auto-approve tools in bypassPermissions mode (except AskUserQuestion which needs user input)
      const autoApproved = settings.permissionMode === 'bypassPermissions' && d.tool !== 'AskUserQuestion';
      const msg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'system',
        content: `Tool request: ${d.tool}`,
        timestamp: Date.now(),
        toolUse: {
          tool: d.tool,
          input: d.input,
          requestId: d.requestId,
          status: autoApproved ? 'approved' : 'pending',
        },
      };
      chat.addMessage(msg);
    });

    on('thinking_start', () => {
      chat.startThinking();
    });

    on('thinking_delta', (data: unknown) => {
      const d = data as { text: string };
      chat.updateThinking(d.text);
    });

    on('thinking_end', () => {
      chat.finishThinking();
    });

    on('tool_input_delta', (data: unknown) => {
      const d = data as { requestId: string; accumulatedJson: string };
      chat.appendToolInputDelta(d.requestId, d.accumulatedJson);
    });

    on('tool_input_complete', (data: unknown) => {
      const d = data as { requestId: string; input: Record<string, unknown> };
      chat.updateToolInput(d.requestId, d.input);
    });

    on('session_status', (data: unknown) => {
      const d = data as {
        sessionId: string;
        isStreaming: boolean;
        accumulatedText?: string;
      };
      if (d.isStreaming) {
        // Session is still actively streaming on server — restore streaming state
        reconnectedMidStream = true;
        chat.startStreaming();
        // Add a placeholder assistant message so deltas have somewhere to go
        const msg: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: d.accumulatedText || '',
          timestamp: Date.now(),
          isStreaming: true,
        };
        chat.addMessage(msg);
      } else if (d.sessionId && d.sessionId === chat.sessionId && chat.activeProjectDir) {
        // Session finished while we were disconnected — fetch missed messages
        fetchMissedMessages(d.sessionId, chat.activeProjectDir);
      }
    });

    on('error', (data: unknown) => {
      const d = data as { error: string };
      chat.addMessage({
        id: crypto.randomUUID(),
        role: 'system',
        content: `Error: ${d.error}`,
        timestamp: Date.now(),
      });
      chat.finishStreaming();
    });
  }

  const THINKING_PREFIXES: Record<string, string> = {
    think: 'think before responding.\n\n',
    think_hard: 'think hard before responding.\n\n',
    think_harder: 'think harder before responding.\n\n',
    ultrathink: 'ultrathink before responding.\n\n',
  };

  function sendMessage(prompt: string, images?: { name: string; dataUrl: string }[]) {
    chat.addMessage({
      id: crypto.randomUUID(),
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
      cwd: chat.projectPath,
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
        id: crypto.randomUUID(),
        role: 'system',
        content: 'Error: Not connected to server. Reconnecting…',
        timestamp: Date.now(),
      });
    }
  }

  function respondToTool(requestId: string, approved: boolean, answers?: Record<string, string>) {
    send({ type: 'tool_response', requestId, approved, answers });
    const msg = chat.messages.find(m => m.toolUse?.requestId === requestId);
    if (msg?.toolUse) {
      msg.toolUse.status = approved ? 'approved' : 'rejected';
      if (answers) {
        msg.toolUse.input._userAnswers = answers;
      }
    }
  }

  function abort() {
    send({ type: 'abort' });
  }

  function checkSession(sessionId: string) {
    send({ type: 'check_session', sessionId });
  }

  /** Reload messages from disk after a reconnect where streaming already finished. */
  async function fetchMissedMessages(sessionId: string, projectDir: string) {
    try {
      const afterIndex = chat.messages.length + chat.oldestLoadedIndex;
      const res = await fetch(
        `/api/sessions/${sessionId}/messages?projectDir=${encodeURIComponent(projectDir)}&after=${afterIndex}`,
        { headers: { Authorization: `Bearer ${auth.token}` } },
      );
      if (!res.ok) return;
      const data = await res.json();
      if (data.messages?.length) {
        chat.appendMessages(data.messages, { total: data.total });
      }
    } catch (err) {
      console.error('Failed to fetch missed messages:', err);
    }
  }

  /** Full reload of session messages (used after mid-stream reconnect to get accurate state). */
  async function reloadSession(sessionId: string, projectDir: string) {
    try {
      const res = await fetch(
        `/api/sessions/${sessionId}/messages?projectDir=${encodeURIComponent(projectDir)}&limit=50`,
        { headers: { Authorization: `Bearer ${auth.token}` } },
      );
      if (!res.ok) return;
      const data = await res.json();
      if (data.messages?.length) {
        chat.loadMessages(data.messages, {
          total: data.total,
          hasMore: data.hasMore,
          oldestIndex: data.oldestIndex,
        });
      }
    } catch (err) {
      console.error('Failed to reload session:', err);
    }
  }

  return { connected, init, sendMessage, respondToTool, abort, disconnect, checkSession };
}
