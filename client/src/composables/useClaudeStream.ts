import { watch } from 'vue';
import { useChatStore, type ChatMessage } from '@/stores/chat';
import { useSettingsStore } from '@/stores/settings';
import { apiFetch } from '@/lib/apiFetch';
import { useProviderStore } from '@/stores/provider';
import { useWebSocket } from './useWebSocket';
import { useRouter } from 'vue-router';
import { uuid } from '@/lib/utils';
import { playToolApprovalSound } from './useNotificationSound';

export function useClaudeStream() {
  const chat = useChatStore();
  const settings = useSettingsStore();
  const providerStore = useProviderStore();
  const router = useRouter();
  const { connected, connect, send, on, disconnect } = useWebSocket('/ws/chat');

  // Hoisted so cleanup() can clear it
  let watchdogTimer: ReturnType<typeof setInterval> | null = null;

  /** Snapshot the active provider's id/name/icon at the moment a message is created.
   *  Stored directly on the message so the display never changes after the fact,
   *  even when the user switches providers mid-session. */
  function captureProvider(): { provider: string; providerName: string; providerIcon: string } {
    const p = providerStore.activeProvider;
    return { provider: p.id, providerName: p.name, providerIcon: p.icon };
  }

  function init() {
    connect();
    chat.registerAbort(abort);

    // Track whether the next text delta needs a fresh assistant message
    // (set after a tool_use so text after tools gets its own bubble, matching reload layout)
    let needsNewAssistantMsg = false;
    // Track whether we reconnected mid-stream so we can do a full refresh on stream_end
    let reconnectedMidStream = false;

    // --- Session isolation ---
    // Track which server session ID we're actively listening to.
    // Events from other sessions are silently discarded.
    let activeSessionId: string | null = chat.sessionId;
    // When true, reject ALL events until a new stream_start explicitly sets the session.
    // This prevents stale events from a previous session being "adopted" after clearMessages().
    let awaitingNewSession = false;

    // Clear rate limit when the active provider changes (rate limits are provider-specific)
    watch(() => providerStore.activeProviderId, () => {
      chat.clearRateLimit();
    });

    watch(() => chat.sessionId, (newId, oldId) => {
      activeSessionId = newId;
      if (oldId && !newId) {
        // sessionId went from something to null (clearMessages) — enable guard
        awaitingNewSession = true;
        // Tell the server to detach the old emitter so stale events stop flowing
        send({ type: 'clear_session' });
      } else if (newId) {
        // sessionId was set (loading existing session or first response) — lift guard
        awaitingNewSession = false;
      }
    });

    // Track whether the current stream was initiated via WebSocket (stream_start).
    // When false and isStreaming is true, it means streaming state was restored from
    // the REST API and we need to send check_session to wire up live WS events.
    let wsStreamActive = false;

    watch(() => chat.isStreaming, (streaming) => {
      if (streaming && !wsStreamActive && activeSessionId && connected.value) {
        // Streaming was activated externally (REST API) — send check_session
        // to wire up the WebSocket listener for the ongoing stream.
        send({ type: 'check_session', sessionId: activeSessionId });
      }
      if (!streaming) {
        wsStreamActive = false;
      }
    });

    /** Returns true if the incoming WS event belongs to the current session. */
    function isForCurrentSession(data: unknown): boolean {
      // When awaiting a new session (after clearMessages), reject everything.
      // Only stream_start (handled separately) can lift this guard.
      if (awaitingNewSession) return false;
      if (!data) return true; // null/undefined → allow (malformed event tolerance)
      const d = data as { sessionId?: string };
      if (!d.sessionId) return true;  // no sessionId in event → allow (backward compat)
      if (!activeSessionId) {
        // New chat state: adopt the first sessionId we see (it's our first response)
        activeSessionId = d.sessionId;
        return true;
      }
      return d.sessionId === activeSessionId;
    }

    // Send check_session on reconnect (if streaming) and on initial connect
    // after a page reload (if we have a persisted sessionId).
    let isReconnect = false;

    watch(connected, (isConnected) => {
      if (isConnected) {
        if (chat.sessionId) {
          // On reconnect while streaming, or on initial connect after page reload
          // (isStreaming is false after reload, but sessionId is persisted)
          if (isReconnect ? chat.isStreaming : true) {
            send({ type: 'check_session', sessionId: chat.sessionId });
          }
        }
        isReconnect = true;
      }
    });

    // Streaming activity watchdog — if no WS events arrive for 60s while
    // streaming, proactively check session status in case stream_end was lost.
    let lastStreamActivity = 0;
    const STREAM_WATCHDOG_INTERVAL = 30_000; // check every 30s
    const STREAM_INACTIVITY_THRESHOLD = 60_000; // consider stale after 60s

    watchdogTimer = setInterval(() => {
      if (chat.isStreaming && connected.value && activeSessionId) {
        const elapsed = Date.now() - lastStreamActivity;
        if (elapsed > STREAM_INACTIVITY_THRESHOLD) {
          send({ type: 'check_session', sessionId: activeSessionId });
        }
      }
    }, STREAM_WATCHDOG_INTERVAL);

    /** Reset the streaming activity timer (called on every stream event). */
    function touchStreamActivity() {
      lastStreamActivity = Date.now();
    }

    on('stream_start', (data: unknown) => {
      const d = (data || {}) as { sessionId?: string; provider?: string };
      // On stream_start, adopt the session ID (for new sessions where chat.sessionId is still null)
      if (d.sessionId) {
        activeSessionId = d.sessionId;
        // Persist server UUID immediately so page reload can send check_session
        // to reconnect to an ongoing stream (stream_end may not have fired yet)
        if (!chat.sessionId) {
          chat.sessionId = d.sessionId;
        }
      }
      // Lift the guard — this is a legitimate new stream for the current session
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

    on('stream_delta', (data: unknown) => {
      if (!isForCurrentSession(data)) return;
      touchStreamActivity();
      const d = data as { text?: string };
      if (!d?.text) return; // malformed event tolerance
      if (needsNewAssistantMsg) {
        // Text arriving after a tool — create a new assistant message
        // so the layout matches the reload path (text → tool → text split)
        needsNewAssistantMsg = false;
        // Clear isStreaming on the previous assistant message
        const prev = chat.messages.findLast(m => m.role === 'assistant');
        if (prev) prev.isStreaming = false;
        // Inherit provider snapshot from the group's first message so all
        // continuation bubbles stay labelled with the same provider.
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

    on('stream_end', (data: unknown) => {
      if (!isForCurrentSession(data)) return;
      needsNewAssistantMsg = false;
      const d = data as {
        sessionId?: string;
        claudeSessionId?: string;
        usage?: { input_tokens?: number; output_tokens?: number };
        totalCost?: number;
      };

      // Save claudeSessionId (= Claude CLI session ID used for --resume)
      if (d.claudeSessionId) {
        chat.claudeSessionId = d.claudeSessionId;
      }

      // Save server session ID for in-memory lookups
      if (d.sessionId) {
        chat.sessionId = d.sessionId;
      }

      // Ensure activeProjectDir is set so live-updates and message fetching work
      if (!chat.activeProjectDir && chat.projectPath) {
        chat.activeProjectDir = chat.projectPath;
      }

      // URL uses claudeSessionId (= JSONL filename) so page reloads & sidebar work
      const urlSessionId = d.claudeSessionId || d.sessionId;
      if (urlSessionId) {
        const currentUrlId = router.currentRoute.value.params.sessionId;
        if (currentUrlId !== urlSessionId) {
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
      // Check the last assistant message for rate limit text, but only if the
      // message is short (< 500 chars). Genuine rate limit notices from the CLI
      // are brief; long responses that merely *mention* rate limits (e.g. docs,
      // troubleshooting guides) should not trigger the rate limit UI.
      const lastAssistant = chat.messages.findLast(m => m.role === 'assistant');
      if (lastAssistant?.content && lastAssistant.content.length < 500) {
        detectRateLimit(lastAssistant.content);
      }

      chat.finishStreaming();

      // Reconcile messages after stream ends to catch any events lost during
      // brief WebSocket disruptions (e.g. WS in CLOSING state, kernel buffer
      // full, or reconnection during which events were emitted by the server).
      const reloadId = chat.claudeSessionId || chat.sessionId;
      if (reloadId && chat.activeProjectDir) {
        if (reconnectedMidStream) {
          // Full reload — we likely missed many events during reconnection
          reconnectedMidStream = false;
          reloadSession(reloadId, chat.activeProjectDir);
        } else {
          // Quick check — fetch only messages after our last known index
          fetchMissedMessages(reloadId, chat.activeProjectDir);
        }
      }
    });

    on('tool_use', (data: unknown) => {
      if (!isForCurrentSession(data)) return;
      if (!data) return; // malformed event tolerance
      touchStreamActivity();
      const d = data as { tool: string; input: Record<string, unknown>; requestId: string };

      // Track plan mode transitions BEFORE dedup — even duplicate events
      // should update plan mode state to prevent stale "Plan Mode" indicators
      if (d.tool === 'EnterPlanMode') {
        chat.inPlanMode = true;
      } else if (d.tool === 'ExitPlanMode') {
        chat.inPlanMode = false;
      }

      // Deduplicate: skip if a message with this requestId already exists
      // (can happen with --include-partial-messages re-emitting the same tool_use)
      if (d.requestId && chat.messages.some(m => m.toolUse?.requestId === d.requestId)) {
        return;
      }

      // Mark current assistant message as done — next text delta gets a new bubble
      needsNewAssistantMsg = true;
      // Stop streaming indicator on the current assistant message
      const lastAssistant = chat.messages.findLast(m => m.role === 'assistant');
      if (lastAssistant) lastAssistant.isStreaming = false;

      // Determine initial tool status.
      // EnterPlanMode is an internal tool that never needs approval.
      // ExitPlanMode requires user approval (plan review) in non-bypassPermissions modes.
      // In bypassPermissions (Full Auto) mode, ALL tools are auto-approved.
      // In other modes, tools start as 'pending' until the server auto-approves
      // or forwards a control_request for user approval.
      const INTERNAL_TOOLS = ['EnterPlanMode'];
      // AskUserQuestion always requires user interaction, regardless of permission mode
      const USER_INPUT_TOOLS = ['AskUserQuestion'];
      const autoApproved = INTERNAL_TOOLS.includes(d.tool) ||
        (!USER_INPUT_TOOLS.includes(d.tool) && settings.permissionMode === 'bypassPermissions');

      // Handle ExitPlanMode plan text capture + plan review activation
      if (d.tool === 'ExitPlanMode') {

        // Capture plan text: prefer the Write tool call that targets .claude/plans/,
        // falling back to assistant message content between EnterPlanMode and ExitPlanMode.
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
          // Look for the Write tool that wrote the plan file
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
          // Fallback: collect assistant text if no plan file Write was found
          if (!planText) {
            for (let i = enterIdx + 1; i < msgs.length; i++) {
              if (msgs[i].toolUse?.tool === 'ExitPlanMode') break;
              if (msgs[i].role === 'assistant' && msgs[i].content) {
                planText += msgs[i].content;
              }
            }
          }
        }
        // Only activate plan review when the tool needs user approval.
        // In bypassPermissions mode, the server auto-approves and stream continues.
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

    on('control_request', (data: unknown) => {
      if (!isForCurrentSession(data)) return;
      const d = data as { requestId: string; toolName: string; toolInput: Record<string, unknown>; toolUseId?: string };

      // Server handles auto-approval — any control_request that reaches the client
      // is a tool that genuinely needs user approval (or AskUserQuestion).
      // Store the control request ID on the tool message so respondToTool can use it.
      const msg = chat.messages.find(m => m.toolUse?.requestId === d.toolUseId);
      if (msg?.toolUse) {
        msg.toolUse.controlRequestId = d.requestId;
      }
      // Play attention sound so user knows approval is needed
      playToolApprovalSound();
    });

    on('tool_approved', (data: unknown) => {
      if (!isForCurrentSession(data)) return;
      const d = data as { toolUseId: string };
      // Server auto-approved this tool — update its status from 'pending' to 'approved'
      const msg = chat.messages.find(m => m.toolUse?.requestId === d.toolUseId);
      if (msg?.toolUse) {
        msg.toolUse.status = 'approved';
      }
    });

    on('thinking_start', (data: unknown) => {
      if (!isForCurrentSession(data)) return;
      chat.startThinking();
    });

    on('thinking_delta', (data: unknown) => {
      if (!isForCurrentSession(data)) return;
      touchStreamActivity();
      const d = data as { text: string };
      chat.updateThinking(d.text);
    });

    on('thinking_end', (data: unknown) => {
      if (!isForCurrentSession(data)) return;
      chat.finishThinking();
    });

    on('tool_input_delta', (data: unknown) => {
      if (!isForCurrentSession(data)) return;
      touchStreamActivity();
      const d = data as { requestId: string; accumulatedJson: string };
      chat.appendToolInputDelta(d.requestId, d.accumulatedJson);
    });

    on('tool_input_complete', (data: unknown) => {
      if (!isForCurrentSession(data)) return;
      const d = data as { requestId: string; input: Record<string, unknown> };
      chat.updateToolInput(d.requestId, d.input);
    });

    on('session_status', (data: unknown) => {
      const d = data as {
        sessionId: string;
        serverSessionId?: string;
        claudeSessionId?: string;
        isStreaming: boolean;
        accumulatedText?: string;
      };
      // Only act on status for the session we're actively tracking
      if (d.sessionId !== activeSessionId) return;

      if (d.isStreaming) {
        // Session is still actively streaming on server — restore streaming state
        reconnectedMidStream = true;
        wsStreamActive = true; // Server re-wired the WS emitter for this session
        // Adopt the server's internal session UUID so subsequent events from
        // wireEmitter (which use session.id) pass the isForCurrentSession check.
        // Only update the local tracking variable, not chat.sessionId (which is
        // persisted to sessionStorage and used for URL routing).
        if (d.serverSessionId) {
          activeSessionId = d.serverSessionId;
        }
        // Save claudeSessionId so reloadSession (called from stream_end) can
        // fetch the correct JSONL file even if stream_end claudeSessionId is missing.
        if (d.claudeSessionId && !chat.claudeSessionId) {
          chat.claudeSessionId = d.claudeSessionId;
        }
        if (!chat.isStreaming) {
          chat.startStreaming();
        }
        // If messages were already loaded (e.g. via REST API), don't add a
        // duplicate placeholder — just ensure the last assistant msg is marked streaming
        if (chat.messages.length > 0) {
          const lastAssistant = chat.messages.findLast(m => m.role === 'assistant');
          if (lastAssistant) lastAssistant.isStreaming = true;
        } else {
          // No messages loaded yet — add a placeholder so deltas have somewhere to go
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
        // Session finished while we were disconnected — stop streaming UI
        // and fetch any messages we missed
        if (chat.isStreaming) {
          chat.finishStreaming();
        }
        // Use claudeSessionId (JSONL filename) for the REST lookup — the server UUID
        // won't match any file. Fall back to projectPath if activeProjectDir wasn't set
        // yet (e.g. stream_end never arrived to set it).
        const fetchId = d.claudeSessionId || chat.claudeSessionId || d.sessionId;
        const projectDir = chat.activeProjectDir || chat.projectPath;
        if (fetchId && projectDir) {
          // Ensure activeProjectDir is persisted so future fetches work too
          if (!chat.activeProjectDir && projectDir) {
            chat.activeProjectDir = projectDir;
          }
          fetchMissedMessages(fetchId, projectDir);
        }
        // Mark as idle so the UI shows a "Response complete" indicator
        // for sessions loaded from disk (only when last msg is from assistant/system)
        if (chat.messages.length > 0) {
          const lastMsg = chat.messages[chat.messages.length - 1];
          if (lastMsg && lastMsg.role !== 'user') {
            chat.sessionLoadedIdle = true;
          }
        }
      }
    });

    on('error', (data: unknown) => {
      if (!isForCurrentSession(data)) return;
      if (!data) return; // malformed event tolerance
      const d = data as { error: string };

      // Detect rate limit from error messages
      detectRateLimit(d.error);

      chat.addMessage({
        id: uuid(),
        role: 'system',
        content: `Error: ${d.error}`,
        timestamp: Date.now(),
      });
      // Don't call finishStreaming() here — the error may be non-fatal (e.g. stderr
      // output during context resize). stream_end always fires when the stream truly
      // ends, guaranteed by the safety net in claude.ts. Calling finishStreaming()
      // prematurely causes the "Response complete" notification to fire early and then
      // not fire again when stream_end actually arrives (because isStreaming is already false).
    });
  }

  const THINKING_PREFIXES: Record<string, string> = {
    think: 'think before responding.\n\n',
    think_hard: 'think hard before responding.\n\n',
    think_harder: 'think harder before responding.\n\n',
    ultrathink: 'ultrathink before responding.\n\n',
  };

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

  function respondToTool(requestId: string, approved: boolean, answers?: Record<string, string>) {
    const msg = chat.messages.find(m => m.toolUse?.requestId === requestId);
    // Use the CLI's control request ID if available (for permission responses)
    const controlRequestId = msg?.toolUse?.controlRequestId || requestId;
    // For AskUserQuestion, include the original questions so the server can build updatedInput
    const questions = answers && msg?.toolUse?.input?.questions ? msg.toolUse.input.questions : undefined;
    send({ type: 'tool_response', requestId: controlRequestId, approved, answers, questions });
    if (msg?.toolUse) {
      msg.toolUse.status = approved ? 'approved' : 'rejected';
      if (answers) {
        msg.toolUse.input._userAnswers = answers;
      }
    }
  }

  function abort() {
    // Include sessionId so the server can find the session even if the WS
    // reconnected and currentSessionId (server-side closure var) is null.
    const sent = send({ type: 'abort', sessionId: chat.sessionId });
    if (!sent) {
      // WebSocket not connected — force-finish locally so the UI isn't stuck
      chat.finishStreaming();
    }
  }

  function checkSession(sessionId: string) {
    send({ type: 'check_session', sessionId });
  }

  /** Reload messages from disk after a reconnect where streaming already finished. */
  async function fetchMissedMessages(sessionId: string, projectDir: string) {
    try {
      const afterIndex = chat.messages.length + chat.oldestLoadedIndex;
      const res = await apiFetch(
        `/api/sessions/${sessionId}/messages?projectDir=${encodeURIComponent(projectDir)}&after=${afterIndex}`,
      );
      if (!res.ok) return;
      const data = await res.json();
      if (data.messages?.length) {
        chat.appendMessages(data.messages, { total: data.total });
      }
      if (data.usage) {
        chat.updateUsage({
          inputTokens: data.usage.inputTokens || 0,
          outputTokens: data.usage.outputTokens || 0,
        });
      }
    } catch (err) {
      console.error('Failed to fetch missed messages:', err);
    }
  }

  /** Full reload of session messages (used after mid-stream reconnect to get accurate state). */
  async function reloadSession(sessionId: string, projectDir: string) {
    try {
      const res = await apiFetch(
        `/api/sessions/${sessionId}/messages?projectDir=${encodeURIComponent(projectDir)}&limit=50`,
      );
      if (!res.ok) return;
      const data = await res.json();
      if (data.messages?.length) {
        if (data.sessionProvider) {
          const p = providerStore.providers.find(pr => pr.id === data.sessionProvider);
          for (const msg of data.messages) {
            if (msg.role === 'assistant') {
              if (!msg.provider) msg.provider = data.sessionProvider;
              if (!msg.providerName) msg.providerName = p?.name ?? data.sessionProvider;
              if (!msg.providerIcon) msg.providerIcon = p?.icon;
            }
          }
        }
        chat.loadMessages(data.messages, {
          total: data.total,
          hasMore: data.hasMore,
          oldestIndex: data.oldestIndex,
        });
      }
      if (data.usage) {
        chat.updateUsage({
          inputTokens: data.usage.inputTokens || 0,
          outputTokens: data.usage.outputTokens || 0,
        });
      }
    } catch (err) {
      console.error('Failed to reload session:', err);
    }
  }

  /** Detect rate limit from any text (assistant message content or error). */
  function detectRateLimit(text: string) {
    // Match "resets Feb 13, 12pm" or "resets 10pm" (with optional timezone)
    const rateLimitWithDateMatch = text.match(/resets?\s+(\w+\s+\d{1,2},?\s+\d{1,2}(?::\d{2})?\s*(?:am|pm))/i);
    const rateLimitTimeOnlyMatch = !rateLimitWithDateMatch && text.match(/resets?\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm))/i);
    const isRateLimit = rateLimitWithDateMatch || rateLimitTimeOnlyMatch || /rate.?limit|hit.?(?:your|the)?.?limit|you.?ve hit|usage.?limit|quota|too many requests|429|overloaded/i.test(text);

    if (!isRateLimit) return;

    const resetTime = rateLimitWithDateMatch
      ? parseResetTime(rateLimitWithDateMatch[1]!)
      : rateLimitTimeOnlyMatch
        ? parseResetTimeOnly(rateLimitTimeOnlyMatch[1]!)
        : null;

    if (resetTime) {
      chat.setRateLimitedUntil(resetTime);
    } else {
      // Fallback: block for 5 minutes if we can't parse the time
      chat.setRateLimitedUntil(Date.now() + 5 * 60 * 1000);
    }
  }

  /** Parse a reset time string like "Feb 13, 12pm" into a timestamp. */
  function parseResetTime(timeStr: string): number | null {
    try {
      // Normalize: "Feb 13, 12pm" or "Feb 13 3:30pm"
      const cleaned = timeStr.replace(',', '').trim();
      const match = cleaned.match(/^(\w+)\s+(\d{1,2})\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
      if (!match) return null;

      const [, monthStr, dayStr, hourStr, minStr, ampm] = match;
      const months: Record<string, number> = {
        jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
        jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
      };
      const month = months[monthStr!.toLowerCase().slice(0, 3)];
      if (month === undefined) return null;

      let hour = parseInt(hourStr!, 10);
      const minute = minStr ? parseInt(minStr, 10) : 0;
      if (ampm!.toLowerCase() === 'pm' && hour !== 12) hour += 12;
      if (ampm!.toLowerCase() === 'am' && hour === 12) hour = 0;

      const now = new Date();
      const resetDate = new Date(now.getFullYear(), month, parseInt(dayStr!, 10), hour, minute, 0, 0);

      // If the parsed date is in the past, it might be next year
      if (resetDate.getTime() < Date.now()) {
        resetDate.setFullYear(resetDate.getFullYear() + 1);
      }

      return resetDate.getTime();
    } catch {
      return null;
    }
  }

  /** Parse a time-only reset string like "10pm" or "3:30am" into a timestamp (today or tomorrow). */
  function parseResetTimeOnly(timeStr: string): number | null {
    try {
      const cleaned = timeStr.trim();
      const match = cleaned.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
      if (!match) return null;

      let hour = parseInt(match[1]!, 10);
      const minute = match[2] ? parseInt(match[2], 10) : 0;
      if (match[3]!.toLowerCase() === 'pm' && hour !== 12) hour += 12;
      if (match[3]!.toLowerCase() === 'am' && hour === 12) hour = 0;

      const now = new Date();
      const resetDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0, 0);

      // If the time is in the past today, it means tomorrow
      if (resetDate.getTime() < Date.now()) {
        resetDate.setDate(resetDate.getDate() + 1);
      }

      return resetDate.getTime();
    } catch {
      return null;
    }
  }

  function cleanup() {
    if (watchdogTimer) clearInterval(watchdogTimer);
    disconnect();
  }

  return { connected, init, sendMessage, respondToTool, abort, disconnect: cleanup, checkSession };
}
