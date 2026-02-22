import { defineStore } from 'pinia';
import { ref } from 'vue';
import { apiFetch } from '@/lib/apiFetch';
import { createStoreWebSocket } from '@/lib/storeWebSocket';

export interface LangfuseObservation {
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

export interface LangfuseTrace {
  id: string;
  name: string;
  timestamp: string;
  userId?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  observations?: LangfuseObservation[];
}

export const useTracesStore = defineStore('traces', () => {
  const traces = ref<LangfuseTrace[]>([]);
  const selectedTrace = ref<LangfuseTrace | null>(null);
  const loading = ref(false);
  const detailLoading = ref(false);
  const configured = ref(true);
  const reachable = ref(true);
  const error = ref<string | null>(null);
  const currentUserId = ref<string | undefined>(undefined);

  // ── WebSocket (auto-managed, components don't need to connect/disconnect) ──
  const ws = createStoreWebSocket('/ws/traces');

  ws.on('trace:ended', () => {
    // Small delay: Langfuse indexes events async even after flushAsync completes
    setTimeout(() => fetchTraces(), 1000);
  });

  // Auto-connect when the store is first instantiated
  ws.connect();

  // ── Actions ────────────────────────────────────────────────────────────────

  async function fetchStatus() {
    try {
      const res = await apiFetch('/api/langfuse/status');
      if (res.ok) {
        const data = await res.json() as { configured: boolean; reachable?: boolean };
        configured.value = data.configured;
        reachable.value = data.reachable ?? true;
      }
    } catch { /* silent */ }
  }

  async function fetchTraces(userId?: string) {
    if (userId !== undefined) currentUserId.value = userId;
    loading.value = true;
    error.value = null;
    try {
      const params = new URLSearchParams({ limit: '50' });
      const uid = userId ?? currentUserId.value;
      if (uid) params.set('userId', uid);
      const res = await apiFetch(`/api/langfuse/traces?${params}`);
      if (!res.ok) { error.value = 'Failed to fetch traces'; return; }
      const data = await res.json() as { configured?: boolean; data?: LangfuseTrace[] };
      if (data.configured === false) { configured.value = false; return; }
      configured.value = true;
      reachable.value = true;
      const fresh = data.data || [];
      // Preserve existing traces if fetch returns empty (Langfuse indexing lag)
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
      const res = await apiFetch(`/api/langfuse/traces/${id}`);
      if (!res.ok) return;
      selectedTrace.value = await res.json() as LangfuseTrace;
    } finally {
      detailLoading.value = false;
    }
  }

  function selectTrace(trace: LangfuseTrace) {
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
