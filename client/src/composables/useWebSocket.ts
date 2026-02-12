import { ref, onUnmounted } from 'vue';
import { useAuthStore } from '@/stores/auth';

export function useWebSocket(path: string) {
  const ws = ref<WebSocket | null>(null);
  const connected = ref(false);
  const handlers = new Map<string, Set<(data: unknown) => void>>();
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempts = 0;
  let intentionalClose = false;

  const MAX_RECONNECT_DELAY = 10_000;
  const BASE_RECONNECT_DELAY = 500;

  function connect() {
    // Clean up any previous socket
    if (ws.value) {
      intentionalClose = true;
      ws.value.close();
      ws.value = null;
    }
    intentionalClose = false;

    const auth = useAuthStore();
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const url = `${protocol}//${host}${path}?token=${auth.token}`;

    const socket = new WebSocket(url);

    socket.onopen = () => {
      connected.value = true;
      reconnectAttempts = 0;
    };

    socket.onclose = () => {
      connected.value = false;
      ws.value = null;
      if (!intentionalClose) {
        scheduleReconnect();
      }
    };

    socket.onerror = () => {
      // onerror is always followed by onclose, so reconnect is handled there
    };

    socket.onmessage = (event) => {
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

    ws.value = socket;
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    const delay = Math.min(BASE_RECONNECT_DELAY * 2 ** reconnectAttempts, MAX_RECONNECT_DELAY);
    reconnectAttempts++;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  }

  function send(data: Record<string, unknown>): boolean {
    if (ws.value?.readyState === WebSocket.OPEN) {
      ws.value.send(JSON.stringify(data));
      return true;
    }
    return false;
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
    intentionalClose = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    ws.value?.close();
    ws.value = null;
    connected.value = false;
  }

  onUnmounted(() => {
    disconnect();
  });

  return { ws, connected, connect, send, on, off, disconnect };
}
