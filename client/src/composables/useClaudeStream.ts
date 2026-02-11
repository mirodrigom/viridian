import { useChatStore, type ChatMessage } from '@/stores/chat';
import { useSettingsStore } from '@/stores/settings';
import { useWebSocket } from './useWebSocket';

export function useClaudeStream() {
  const chat = useChatStore();
  const settings = useSettingsStore();
  const { connected, connect, send, on, disconnect } = useWebSocket('/ws/chat');

  function init() {
    connect();

    on('stream_start', () => {
      chat.startStreaming();
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
      chat.updateLastAssistantContent(d.text);
    });

    on('stream_end', (data: unknown) => {
      const d = data as {
        sessionId?: string;
        claudeSessionId?: string;
        usage?: { input_tokens?: number; output_tokens?: number };
        totalCost?: number;
      };
      if (d.sessionId) {
        chat.sessionId = d.sessionId;
      }
      if (d.usage) {
        chat.updateUsage({
          inputTokens: d.usage.input_tokens || 0,
          outputTokens: d.usage.output_tokens || 0,
          totalCost: d.totalCost || 0,
        });
      }
      chat.finishStreaming();
    });

    on('tool_use', (data: unknown) => {
      const d = data as { tool: string; input: Record<string, unknown>; requestId: string };
      // Auto-approve tools in bypassPermissions mode
      const autoApproved = settings.permissionMode === 'bypassPermissions';
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

  function sendMessage(prompt: string) {
    chat.addMessage({
      id: crypto.randomUUID(),
      role: 'user',
      content: prompt,
      timestamp: Date.now(),
    });

    // Prepend thinking instruction if non-standard mode selected
    const prefix = THINKING_PREFIXES[settings.thinkingMode] || '';
    const effectivePrompt = prefix ? prefix + prompt : prompt;

    send({
      type: 'chat',
      prompt: effectivePrompt,
      sessionId: chat.sessionId,
      cwd: chat.projectPath,
      model: settings.model,
      permissionMode: settings.permissionMode,
      allowedTools: settings.allowedTools,
      disallowedTools: settings.disallowedTools,
    });
  }

  function respondToTool(requestId: string, approved: boolean) {
    send({ type: 'tool_response', requestId, approved });
    const msg = chat.messages.find(m => m.toolUse?.requestId === requestId);
    if (msg?.toolUse) {
      msg.toolUse.status = approved ? 'approved' : 'rejected';
    }
  }

  function abort() {
    send({ type: 'abort' });
  }

  return { connected, init, sendMessage, respondToTool, abort, disconnect };
}
