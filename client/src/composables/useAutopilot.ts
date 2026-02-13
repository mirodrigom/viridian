import { onMounted, onUnmounted } from 'vue';
import { useAutopilotStore } from '@/stores/autopilot';

/**
 * Composable to initialize the autopilot WebSocket connection and event handlers.
 * Call once in the AutopilotView component.
 */
export function useAutopilot() {
  const store = useAutopilotStore();

  onMounted(() => {
    store.wsConnect();
    store.initEventHandlers();
    store.fetchProfiles();
  });

  onUnmounted(() => {
    // Don't disconnect — autopilot should keep running in background
    // Only disconnect if explicitly requested
  });

  return store;
}
