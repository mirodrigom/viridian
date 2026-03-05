import type { useChatStore } from '@/stores/chat';
import type { useProviderStore } from '@/stores/provider';
import { apiFetch } from '@/lib/apiFetch';

type ChatStore = ReturnType<typeof useChatStore>;
type ProviderStore = ReturnType<typeof useProviderStore>;

/**
 * Session recovery: fetch missed messages after brief WS disruptions,
 * or do a full reload after a mid-stream reconnect.
 */
export function useSessionRecovery(chat: ChatStore, providerStore: ProviderStore) {
  /** Reload messages from disk after a reconnect where streaming already finished. */
  async function fetchMissedMessages(sessionId: string, projectDir: string) {
    try {
      const afterIndex = chat.messages.length + chat.oldestLoadedIndex;
      const res = await apiFetch(
        `/api/sessions/${sessionId}/messages?projectDir=${encodeURIComponent(projectDir)}&after=${afterIndex}`,
      );
      if (!res.ok) {
        console.warn(`[fetchMissedMessages] Server returned ${res.status} for session=${sessionId}, projectDir=${projectDir}, after=${afterIndex}`);
        return;
      }
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
      console.error('[fetchMissedMessages] Failed:', err);
    }
  }

  /** Full reload of session messages (used after mid-stream reconnect to get accurate state). */
  async function reloadSession(sessionId: string, projectDir: string) {
    try {
      const res = await apiFetch(
        `/api/sessions/${sessionId}/messages?projectDir=${encodeURIComponent(projectDir)}&limit=50`,
      );
      if (!res.ok) {
        console.warn(`[reloadSession] Server returned ${res.status} for session=${sessionId}, projectDir=${projectDir}`);
        return;
      }
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

  return { fetchMissedMessages, reloadSession };
}
