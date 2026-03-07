/**
 * Reusable WebSocket connection logic for Pinia stores.
 *
 * Unlike the `useWebSocket` composable (which ties to component lifecycle via onUnmounted),
 * this utility is designed for stores that persist across tab/route changes.
 */
import { ref } from 'vue';
import { useAuthStore } from '@/stores/auth';

export interface StoreWebSocket {
  connected: ReturnType<typeof ref<boolean>>;
  connect: () => void;
  disconnect: () => void;
  send: (data: Record<string, unknown>) => boolean;
  on: (type: string, handler: (data: unknown) => void) => void;
  offAll: () => void;
}

export function createStoreWebSocket(wsPath: string): StoreWebSocket {
  let ws: WebSocket | null = null;
  const connected = ref(false);
  const handlers = new Map<string, Set<(data: unknown) => void>>();
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempts = 0;
  let intentionalClose = false;

  const MAX_RECONNECT_DELAY = 10_000;
  const BASE_RECONNECT_DELAY = 500;

  function connect() {
    if (ws) {
      intentionalClose = true;
      ws.close();
      ws = null;
    }
    intentionalClose = false;

    const auth = useAuthStore();
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const url = `${protocol}//${host}${wsPath}?token=${auth.token}`;

    const socket = new WebSocket(url);

    socket.onopen = () => {
      connected.value = true;
      reconnectAttempts = 0;
    };

    socket.onclose = () => {
      connected.value = false;
      ws = null;
      if (!intentionalClose) scheduleReconnect();
    };

    socket.onerror = () => {
      // onerror is always followed by onclose
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const type = data.type as string;
        const typeHandlers = handlers.get(type);
        if (typeHandlers) {
          typeHandlers.forEach(handler => handler(data));
        }
      } catch (err) {
        console.warn(`[WS ${wsPath}] Failed to parse message:`, err);
      }
    };

    ws = socket;
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
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
      return true;
    }
    return false;
  }

  function on(type: string, handler: (data: unknown) => void) {
    if (!handlers.has(type)) handlers.set(type, new Set());
    handlers.get(type)!.add(handler);
  }

  function offAll() {
    handlers.clear();
  }

  function disconnect() {
    intentionalClose = true;
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    ws?.close();
    ws = null;
    connected.value = false;
  }

  return { connected, connect, disconnect, send, on, offAll };
}
