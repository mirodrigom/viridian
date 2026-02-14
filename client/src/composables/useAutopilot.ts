import { onMounted, onUnmounted, watch } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useAutopilotStore } from '@/stores/autopilot';

/**
 * Composable to initialize the autopilot WebSocket connection, event handlers,
 * and URL synchronization.
 * Call once in the AutopilotView component.
 */
export function useAutopilot() {
  const store = useAutopilotStore();
  const router = useRouter();
  const route = useRoute();

  onMounted(() => {
    store.wsConnect();
    store.initEventHandlers();
    store.fetchProfiles();
  });

  onUnmounted(() => {
    // Don't disconnect — autopilot should keep running in background
  });

  // Sync URL when the current run changes (new run started, run loaded from sidebar)
  watch(
    () => store.currentRun?.runId,
    (runId, oldRunId) => {
      if (!runId) {
        // Run was cleared — go back to base autopilot route
        if (route.meta.tab === 'autopilot' && route.name !== 'autopilot') {
          router.replace({ name: 'autopilot' });
        }
        return;
      }
      if (runId === oldRunId) return;
      // Only update URL if we're on the autopilot tab
      if (route.meta.tab !== 'autopilot') return;
      const currentUrlRunId = route.params.runId as string | undefined;
      if (currentUrlRunId !== runId) {
        router.replace({ name: 'autopilot-run', params: { runId } });
      }
    },
  );

  // Sync URL when the selected cycle changes
  watch(
    () => store.selectedCycleNumber,
    (cycleNumber) => {
      if (route.meta.tab !== 'autopilot') return;
      const runId = store.currentRun?.runId;
      if (!runId) return;

      if (cycleNumber !== null) {
        router.replace({
          name: 'autopilot-cycle',
          params: { runId, cycleNumber: String(cycleNumber) },
        });
      } else {
        // Cycle deselected — go back to run-level URL
        if (route.name === 'autopilot-cycle') {
          router.replace({ name: 'autopilot-run', params: { runId } });
        }
      }
    },
  );

  return store;
}
