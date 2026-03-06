import { watch } from 'vue';
import type { ChatMessage } from '@/stores/chat';
import { uuid } from '@/lib/utils';
import { playToolApprovalSound } from '../useNotificationSound';
import type { StreamContext } from './types';
import type { useRateLimitDetector } from './useRateLimitDetector';
import type { useSessionRecovery } from './useSessionRecovery';

/**
 * Encode a raw cwd path into the directory name Claude CLI uses for session storage.
 * Must match the server's cwdToHash() in server/src/utils/platform.ts.
 */
function cwdToHash(cwd: string): string {
  if (cwd.includes(':') || cwd.includes('\\')) {
    return cwd.replace(/[:\\/]/g, '-').replace(/^-+/, '');
  }
  return cwd.replace(/\//g, '-');
}

interface StreamHandlersDeps {
  ctx: StreamContext;
  rateLimitDetector: ReturnType<typeof useRateLimitDetector>;
  sessionRecovery: ReturnType<typeof useSessionRecovery>;
}

/**
 * All WebSocket event handlers, session isolation logic, watchers, and the
 * streaming activity watchdog. This is the core of the stream composable.
 */
export function useStreamHandlers({ ctx, rateLimitDetector, sessionRecovery }: StreamHandlersDeps) {
  const { chat, settings, providerStore, router, ws } = ctx;
  const { detectRateLimit } = rateLimitDetector;
  const { fetchMissedMessages, reloadSession } = sessionRecovery;

  // Hoisted so cleanup() can clear them
  let watchdogTimer: ReturnType<typeof setInterval> | null = null;
  let watchdogGraceTimer: ReturnType<typeof setTimeout> | null = null;

  function cancelWatchdogGrace() {
    if (watchdogGraceTimer) {
      clearTimeout(watchdogGraceTimer);
      watchdogGraceTimer = null;
    }
  }

  /** Snapshot the active provider's id/name/icon at the moment a message is created. */
  function captureProvider(): { provider: string; providerName: string; providerIcon: string } {
    const p = providerStore.activeProvider;
    return { provider: p.id, providerName: p.name, providerIcon: p.icon };
  }

  /**
   * Register all WebSocket event handlers, Vue watchers, and the watchdog timer.
   * Call this once during init().
   */
  function registerHandlers() {
    // Track whether the next text delta needs a fresh assistant message
    let needsNewAssistantMsg = false;
    // Track whether we reconnected mid-stream so we can do a full refresh on stream_end
    let reconnectedMidStream = false;

    // --- Session isolation ---
    let activeSessionId: string | null = chat.sessionId;
    let awaitingNewSession = false;

    // Clear rate limit when the active provider changes
    watch(() => providerStore.activeProviderId, () => {
      chat.clearRateLimit();
    });

    watch(() => chat.sessionId, (newId, oldId) => {
      activeSessionId = newId;
      if (oldId && !newId) {
        awaitingNewSession = true;
        if (!chat.suppressClearSession) {
          ws.send({ type: 'clear_session' });
        }
      } else if (oldId && newId && oldId !== newId) {
        if (!chat.suppressClearSession) {
          ws.send({ type: 'clear_session' });
        }
        awaitingNewSession = false;
      } else if (newId) {
        awaitingNewSession = false;
      }
    });

    // Track whether the current stream was initiated via WebSocket
    let wsStreamActive = false;

    let pendingReconnectCheck = false;
    let pendingWatchdogCheck = false;
    const WATCHDOG_GRACE_PERIOD = 5_000;

    watch(() => chat.isStreaming, (streaming) => {
      if (streaming && !wsStreamActive && activeSessionId && ws.connected.value) {
        pendingWatchdogCheck = false;
        ws.send({ type: 'check_session', sessionId: activeSessionId });
      }
      if (!streaming) {
        wsStreamActive = false;
      }
    });

    /** Returns true if the incoming WS event belongs to the current session. */
    function isForCurrentSession(data: unknown): boolean {
      if (awaitingNewSession) return false;
      if (!data) return true;
      const d = data as { sessionId?: string };
      if (!d.sessionId) return true;
      if (!activeSessionId) {
        activeSessionId = d.sessionId;
        return true;
      }
      return d.sessionId === activeSessionId;
    }

    // Send check_session on reconnect / initial connect
    let isReconnect = false;

    watch(ws.connected, (isConnected) => {
      if (isConnected) {
        if (chat.sessionId) {
          if (isReconnect ? chat.isStreaming : true) {
            pendingReconnectCheck = isReconnect;
            pendingWatchdogCheck = false;
            ws.send({ type: 'check_session', sessionId: chat.sessionId });
          }
        }
        isReconnect = true;
      }
    });

    // Streaming activity watchdog
    let lastStreamActivity = 0;
    const STREAM_WATCHDOG_INTERVAL = 30_000;
    const STREAM_INACTIVITY_THRESHOLD = 60_000;

    watchdogTimer = setInterval(() => {
      if (chat.isStreaming && ws.connected.value && activeSessionId) {
        const elapsed = Date.now() - lastStreamActivity;
        if (elapsed > STREAM_INACTIVITY_THRESHOLD) {
          pendingWatchdogCheck = true;
          ws.send({ type: 'check_session', sessionId: activeSessionId });
        }
      }
    }, STREAM_WATCHDOG_INTERVAL);

    function touchStreamActivity() {
      lastStreamActivity = Date.now();
    }

    // ─── Event handlers ───────────────────────────────────────────────

    ws.on('stream_start', (data: unknown) => {
      const d = (data || {}) as { sessionId?: string; provider?: string };
      cancelWatchdogGrace();
      if (d.sessionId) {
        activeSessionId = d.sessionId;
        if (!chat.sessionId) {
          chat.sessionId = d.sessionId;
        }
      }
      awaitingNewSession = false;
      wsStreamActive = true;
      chat.startStreaming();
      touchStreamActivity();
      needsNewAssistantMsg = false;
      reconnectedMidStream = false;
      const providerId = (d.provider as string | undefined) || providerStore.activeProviderId;
      const providerInfo = providerStore.providers.find(p => p.id === providerId) ?? providerStore.activeProvider;
      const msg: ChatMessage = {
        id: uuid(),
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        isStreaming: true,
        provider: providerId,
        providerName: providerInfo.name,
        providerIcon: providerInfo.icon,
      };
      chat.addMessage(msg);
    });

    ws.on('stream_delta', (data: unknown) => {
      if (!isForCurrentSession(data)) return;
      cancelWatchdogGrace();
      touchStreamActivity();
      const d = data as { text?: string };
      if (!d?.text) return;
      if (needsNewAssistantMsg) {
        needsNewAssistantMsg = false;
        const prev = chat.messages.findLast(m => m.role === 'assistant');
        if (prev) prev.isStreaming = false;
        const msg: ChatMessage = {
          id: uuid(),
          role: 'assistant',
          content: d.text,
          timestamp: Date.now(),
          isStreaming: true,
          provider: prev?.provider ?? providerStore.activeProviderId,
          providerName: prev?.providerName ?? providerStore.activeProvider.name,
          providerIcon: prev?.providerIcon ?? providerStore.activeProvider.icon,
        };
        chat.addMessage(msg);
      } else {
        chat.updateLastAssistantContent(d.text);
      }
    });

    ws.on('stream_end', (data: unknown) => {
      if (!isForCurrentSession(data)) return;
      cancelWatchdogGrace();
      needsNewAssistantMsg = false;
      const d = data as {
        sessionId?: string;
        claudeSessionId?: string;
        usage?: { input_tokens?: number; output_tokens?: number };
        totalCost?: number;
      };

      if (d.claudeSessionId) {
        chat.claudeSessionId = d.claudeSessionId;
      }
      if (d.sessionId) {
        chat.sessionId = d.sessionId;
      }

      if (!chat.activeProjectDir && chat.projectPath) {
        chat.activeProjectDir = cwdToHash(chat.projectPath);
      }

      const urlSessionId = d.claudeSessionId || d.sessionId;
      if (urlSessionId) {
        const currentUrlId = router.currentRoute.value.params.sessionId;
        if (currentUrlId !== urlSessionId) {
          // Align chat.sessionId with the URL we're navigating to.
          // Without this, handleRoute sees (urlSessionId !== server-internal-UUID)
          // and calls loadSessionFromUrl, wiping the just-received messages.
          chat.sessionId = urlSessionId;
          router.replace({
            name: 'chat-session',
            params: { sessionId: urlSessionId },
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

      const lastAssistant = chat.messages.findLast(m => m.role === 'assistant');
      if (lastAssistant?.content && lastAssistant.content.length < 500) {
        detectRateLimit(lastAssistant.content);
      }

      chat.finishStreaming();

      const reloadId = chat.claudeSessionId || chat.sessionId;
      if (reloadId && chat.activeProjectDir) {
        if (reconnectedMidStream) {
          reconnectedMidStream = false;
          reloadSession(reloadId, chat.activeProjectDir);
        } else {
          fetchMissedMessages(reloadId, chat.activeProjectDir);
        }
      }
    });

    ws.on('tool_use', (data: unknown) => {
      if (!isForCurrentSession(data)) return;
      if (!data) return;
      touchStreamActivity();
      const d = data as { tool: string; input: Record<string, unknown>; requestId: string };

      if (d.tool === 'EnterPlanMode') {
        chat.inPlanMode = true;
      } else if (d.tool === 'ExitPlanMode') {
        chat.inPlanMode = false;
      }

      if (d.requestId && chat.messages.some(m => m.toolUse?.requestId === d.requestId)) {
        return;
      }

      needsNewAssistantMsg = true;

      const INTERNAL_TOOLS = ['EnterPlanMode'];
      const USER_INPUT_TOOLS = ['AskUserQuestion', 'ExitPlanMode'];
      const autoApproved = INTERNAL_TOOLS.includes(d.tool) ||
        (!USER_INPUT_TOOLS.includes(d.tool) && settings.permissionMode === 'bypassPermissions');

      if (d.tool === 'ExitPlanMode') {
        const msgs = chat.messages;
        let enterIdx = -1;
        for (let i = msgs.length - 1; i >= 0; i--) {
          if (msgs[i].toolUse?.tool === 'EnterPlanMode') {
            enterIdx = i;
            break;
          }
        }
        let planText = '';
        if (enterIdx >= 0) {
          for (let i = enterIdx + 1; i < msgs.length; i++) {
            if (msgs[i].toolUse?.tool === 'ExitPlanMode') break;
            const tu = msgs[i].toolUse;
            if (tu?.tool === 'Write') {
              const filePath = String(tu.input.file_path || tu.input.filePath || '');
              if (filePath.includes('.claude/plans/') && tu.input.content) {
                planText = String(tu.input.content);
                break;
              }
            }
          }
          if (!planText) {
            for (let i = enterIdx + 1; i < msgs.length; i++) {
              if (msgs[i].toolUse?.tool === 'ExitPlanMode') break;
              if (msgs[i].role === 'assistant' && msgs[i].content) {
                planText += msgs[i].content;
              }
            }
          }
        }
        if (!autoApproved) {
          chat.activatePlanReview(planText.trim() || '(Plan text not captured)', d.requestId);
        }
      }

      const msg: ChatMessage = {
        id: uuid(),
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

    ws.on('control_request', (data: unknown) => {
      if (!isForCurrentSession(data)) return;
      const d = data as { requestId: string; toolName: string; toolInput: Record<string, unknown>; toolUseId?: string };

      const msg = d.toolUseId
        ? chat.messages.find(m => m.toolUse?.requestId === d.toolUseId)
        : chat.messages.findLast(m => m.toolUse?.tool === d.toolName && m.toolUse.status === 'pending');
      if (msg?.toolUse) {
        msg.toolUse.controlRequestId = d.requestId;
        if (d.toolName === 'AskUserQuestion' && d.toolInput?.questions) {
          if (!msg.toolUse.input?.questions || !Array.isArray(msg.toolUse.input.questions) || msg.toolUse.input.questions.length === 0) {
            msg.toolUse.input = { ...msg.toolUse.input, ...d.toolInput };
            msg.toolUse.isInputStreaming = false;
          }
        }
      } else {
        console.warn(`[control_request] Could not find matching tool message for toolUseId=${d.toolUseId}, toolName=${d.toolName}`);
      }
      playToolApprovalSound();
    });

    ws.on('tool_approved', (data: unknown) => {
      if (!isForCurrentSession(data)) return;
      const d = data as { toolUseId: string };
      const msg = chat.messages.find(m => m.toolUse?.requestId === d.toolUseId);
      if (msg?.toolUse) {
        msg.toolUse.status = 'approved';
      }
    });

    ws.on('thinking_start', (data: unknown) => {
      if (!isForCurrentSession(data)) return;
      chat.startThinking();
    });

    ws.on('thinking_delta', (data: unknown) => {
      if (!isForCurrentSession(data)) return;
      touchStreamActivity();
      const d = data as { text: string };
      chat.updateThinking(d.text);
    });

    ws.on('thinking_end', (data: unknown) => {
      if (!isForCurrentSession(data)) return;
      chat.finishThinking();
    });

    ws.on('tool_input_delta', (data: unknown) => {
      if (!isForCurrentSession(data)) return;
      touchStreamActivity();
      const d = data as { requestId: string; accumulatedJson: string };
      chat.appendToolInputDelta(d.requestId, d.accumulatedJson);
    });

    ws.on('tool_input_complete', (data: unknown) => {
      if (!isForCurrentSession(data)) return;
      const d = data as { requestId: string; input: Record<string, unknown> };
      chat.updateToolInput(d.requestId, d.input);
    });

    ws.on('session_status', (data: unknown) => {
      const d = data as {
        sessionId: string;
        serverSessionId?: string;
        claudeSessionId?: string;
        isStreaming: boolean;
        accumulatedText?: string;
      };
      if (d.sessionId !== activeSessionId) return;

      if (d.isStreaming) {
        if (pendingReconnectCheck) {
          reconnectedMidStream = true;
        }
        pendingReconnectCheck = false;
        wsStreamActive = true;
        if (d.serverSessionId) {
          activeSessionId = d.serverSessionId;
        }
        if (d.claudeSessionId && !chat.claudeSessionId) {
          chat.claudeSessionId = d.claudeSessionId;
        }
        if (!chat.isStreaming) {
          chat.startStreaming();
        }
        if (chat.messages.length > 0) {
          const lastAssistant = chat.messages.findLast(m => m.role === 'assistant');
          if (lastAssistant) lastAssistant.isStreaming = true;
        } else {
          const { provider, providerName, providerIcon } = captureProvider();
          const msg: ChatMessage = {
            id: uuid(),
            role: 'assistant',
            content: d.accumulatedText || '',
            timestamp: Date.now(),
            isStreaming: true,
            provider,
            providerName,
            providerIcon,
          };
          chat.addMessage(msg);
        }
      } else {
        const wasWatchdog = pendingWatchdogCheck;
        pendingReconnectCheck = false;
        pendingWatchdogCheck = false;

        const applyFinish = () => {
          watchdogGraceTimer = null;
          if (chat.isStreaming) return;

          const fetchId = d.claudeSessionId || chat.claudeSessionId || d.sessionId;
          const projectDir = chat.activeProjectDir
            || (chat.projectPath ? cwdToHash(chat.projectPath) : null);
          if (fetchId && projectDir) {
            if (!chat.activeProjectDir && projectDir) {
              chat.activeProjectDir = projectDir;
            }
            fetchMissedMessages(fetchId, projectDir);
          }
          if (chat.messages.length > 0) {
            const lastMsg = chat.messages[chat.messages.length - 1];
            if (lastMsg && lastMsg.role !== 'user') {
              chat.sessionLoadedIdle = true;
            }
          }
        };

        if (wasWatchdog && chat.isStreaming) {
          cancelWatchdogGrace();
          watchdogGraceTimer = setTimeout(() => {
            if (chat.isStreaming && activeSessionId && ws.connected.value) {
              ws.send({ type: 'check_session', sessionId: activeSessionId });
            } else {
              applyFinish();
            }
          }, WATCHDOG_GRACE_PERIOD);
        } else {
          cancelWatchdogGrace();
          if (chat.isStreaming) {
            chat.finishStreaming();
          }
          applyFinish();
        }
      }
    });

    ws.on('error', (data: unknown) => {
      if (!isForCurrentSession(data)) return;
      if (!data) return;
      const d = data as { error: string };

      detectRateLimit(d.error);

      chat.addMessage({
        id: uuid(),
        role: 'system',
        content: `Error: ${d.error}`,
        timestamp: Date.now(),
      });
    });
  }

  function cleanup() {
    cancelWatchdogGrace();
    if (watchdogTimer) clearInterval(watchdogTimer);
  }

  return { registerHandlers, cleanup };
}
