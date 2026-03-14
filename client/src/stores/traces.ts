import { defineStore } from 'pinia';
import { ref } from 'vue';
import { apiFetch } from '@/lib/apiFetch';
import { createStoreWebSocket } from '@/lib/storeWebSocket';

export interface TraceObservation {
  id: string;
  type: 'GENERATION' | 'SPAN' | 'EVENT';
  name: string;
  startTime: string;
  endTime?: string;
  parentObservationId?: string | null;
  model?: string;
  input?: unknown;
  output?: unknown;
  level?: 'DEFAULT' | 'DEBUG' | 'WARNING' | 'ERROR';
  statusMessage?: string;
  usage?: { input?: number; output?: number; total?: number };
  metadata?: Record<string, unknown>;
}

export interface Trace {
  id: string;
  name: string;
  timestamp: string;
  userId?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  observations?: TraceObservation[];
}

export const useTracesStore = defineStore('traces', () => {
  const traces = ref<Trace[]>([]);
  const selectedTrace = ref<Trace | null>(null);
  const loading = ref(false);
  const detailLoading = ref(false);
  const configured = ref(true);
  const reachable = ref(true);
  const error = ref<string | null>(null);
  const currentUserId = ref<string | undefined>(undefined);

  // ── WebSocket (auto-managed, components don't need to connect/disconnect) ──
  const ws = createStoreWebSocket('/ws/traces');

  ws.on('trace:ended', () => {
    // Only auto-refetch when we have a session filter — without one, we'd fetch
    // ALL traces which is wrong for a new conversation that hasn't received its
    // claudeSessionId yet (arrives on stream_end).
    if (!currentUserId.value) return;
    setTimeout(() => fetchTraces(), 300);
  });

  // Auto-connect when the store is first instantiated
  ws.connect();

  // ── Actions ────────────────────────────────────────────────────────────────

  async function fetchStatus() {
    try {
      const res = await apiFetch('/api/traces/status');
      if (res.ok) {
        const data = await res.json() as { configured: boolean; reachable?: boolean };
        configured.value = data.configured;
        reachable.value = data.reachable ?? true;
      }
    } catch { /* silent */ }
  }

  async function fetchTraces(userId?: string) {
    const prevUserId = currentUserId.value;
    if (userId !== undefined) currentUserId.value = userId;
    const uid = userId ?? currentUserId.value;

    // If the session filter changed, clear stale traces immediately
    if (uid !== prevUserId) traces.value = [];

    loading.value = true;
    error.value = null;
    try {
      const params = new URLSearchParams({ limit: '50' });
      if (uid) params.set('userId', uid);
      const res = await apiFetch(`/api/traces?${params}`);
      if (!res.ok) { error.value = 'Failed to fetch traces'; return; }
      const data = await res.json() as { configured?: boolean; data?: Trace[] };
      if (data.configured === false) { configured.value = false; return; }
      configured.value = true;
      reachable.value = true;
      const fresh = data.data || [];
      // Preserve existing traces only within the same session if fetch returns empty
      if (fresh.length > 0 || traces.value.length === 0) {
        traces.value = fresh;
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Unknown error';
    } finally {
      loading.value = false;
    }
  }

  async function fetchTrace(id: string) {
    detailLoading.value = true;
    try {
      const res = await apiFetch(`/api/traces/${id}`);
      if (!res.ok) return;
      selectedTrace.value = await res.json() as Trace;
    } finally {
      detailLoading.value = false;
    }
  }

  function selectTrace(trace: Trace) {
    selectedTrace.value = trace;
    fetchTrace(trace.id);
  }

  function clearSelection() {
    selectedTrace.value = null;
  }

  return {
    traces, selectedTrace, loading, detailLoading, configured, reachable, error, currentUserId,
    fetchStatus, fetchTraces, fetchTrace, selectTrace, clearSelection,
  };
});
