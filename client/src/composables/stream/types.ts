import type { Ref } from 'vue';
import type { useChatStore } from '@/stores/chat';
import type { useSettingsStore } from '@/stores/settings';
import type { useProviderStore } from '@/stores/provider';
import type { Router } from 'vue-router';

/** Return type of the useWebSocket composable — the WS primitives we depend on. */
export interface WebSocketHandle {
  connected: Ref<boolean>;
  connect: () => void;
  send: (data: Record<string, unknown>) => boolean;
  on: (event: string, handler: (data: unknown) => void) => void;
  disconnect: () => void;
}

/** Shared context threaded through all stream sub-composables. */
export interface StreamContext {
  chat: ReturnType<typeof useChatStore>;
  settings: ReturnType<typeof useSettingsStore>;
  providerStore: ReturnType<typeof useProviderStore>;
  router: Router;
  ws: WebSocketHandle;
}
