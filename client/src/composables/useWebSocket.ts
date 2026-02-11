import { ref, onUnmounted } from 'vue';
import { useAuthStore } from '@/stores/auth';

export function useWebSocket(path: string) {
  const ws = ref<WebSocket | null>(null);
  const connected = ref(false);
  const handlers = new Map<string, Set<(data: unknown) => void>>();

  function connect() {
    const auth = useAuthStore();
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const url = `${protocol}//${host}${path}?token=${auth.token}`;

    ws.value = new WebSocket(url);

    ws.value.onopen = () => {
      connected.value = true;
    };

    ws.value.onclose = () => {
      connected.value = false;
    };

    ws.value.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const type = data.type as string;
        const typeHandlers = handlers.get(type);
        if (typeHandlers) {
          typeHandlers.forEach(handler => handler(data));
        }
        const allHandlers = handlers.get('*');
        if (allHandlers) {
          allHandlers.forEach(handler => handler(data));
        }
      } catch {
        // ignore non-JSON messages
      }
    };
  }

  function send(data: Record<string, unknown>) {
    if (ws.value?.readyState === WebSocket.OPEN) {
      ws.value.send(JSON.stringify(data));
    }
  }

  function on(type: string, handler: (data: unknown) => void) {
    if (!handlers.has(type)) {
      handlers.set(type, new Set());
    }
    handlers.get(type)!.add(handler);
  }

  function off(type: string, handler: (data: unknown) => void) {
    handlers.get(type)?.delete(handler);
  }

  function disconnect() {
    ws.value?.close();
    ws.value = null;
    connected.value = false;
  }

  onUnmounted(() => {
    disconnect();
  });

  return { ws, connected, connect, send, on, off, disconnect };
}
