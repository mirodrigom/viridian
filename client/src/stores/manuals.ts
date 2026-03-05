import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { apiFetch } from '@/lib/apiFetch';
import { toast } from 'vue-sonner';

// ─── Types ────────────────────────────────────────────────────────────

export interface LogoPosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ManualSummary {
  id: string;
  title: string;
  status: string;
  updatedAt: string;
}

export interface ManualVersion {
  id: string;
  createdAt: string;
}

export interface ManualVersionFull extends ManualVersion {
  content: string;
}

export interface Manual {
  id: string;
  title: string;
  prompt: string;
  content: string;
  logo1Data: string;
  logo2Data: string;
  logo1Position: LogoPosition;
  logo2Position: LogoPosition;
  brandColors: string[];
  pdfData: string;
  mode: 'generate' | 'enhance';
  status: string;
  projectPath: string;
  createdAt: string;
  updatedAt: string;
}

export const useManualsStore = defineStore('manuals', () => {
  // ─── State ───────────────────────────────────────────────────────────
  const manualList = ref<ManualSummary[]>([]);
  const currentManual = ref<Manual | null>(null);
  const loading = ref(false);
  const generating = ref(false);
  const generationStatus = ref<{ type: string; text: string } | null>(null);
  const versions = ref<ManualVersion[]>([]);
  const versionsLoading = ref(false);

  // ─── Computed ────────────────────────────────────────────────────────
  const manualCount = computed(() => manualList.value.length);

  // ─── Actions ─────────────────────────────────────────────────────────
  async function fetchManualList(projectPath: string) {
    loading.value = true;
    try {
      const res = await apiFetch(`/api/manuals?project=${encodeURIComponent(projectPath)}`);
      if (res.ok) {
        const data = await res.json();
        manualList.value = data.manuals || [];
      }
    } catch (err) {
      console.error('Failed to fetch manuals:', err);
    } finally {
      loading.value = false;
    }
  }

  async function loadManual(id: string) {
    loading.value = true;
    try {
      const res = await apiFetch(`/api/manuals/${id}`);
      if (res.ok) {
        currentManual.value = await res.json();
      } else {
        toast.error('Failed to load manual');
      }
    } catch (err) {
      console.error('Failed to load manual:', err);
      toast.error('Failed to load manual');
    } finally {
      loading.value = false;
    }
  }

  async function createManual(projectPath: string, data: {
    title: string;
    prompt: string;
    logo1Data?: string;
    logo2Data?: string;
  }): Promise<Manual | null> {
    try {
      const res = await apiFetch('/api/manuals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project: projectPath, ...data }),
      });
      if (res.ok) {
        const manual = await res.json();
        currentManual.value = manual;
        // Refresh list
        await fetchManualList(projectPath);
        return manual;
      } else {
        const err = await res.json();
        toast.error(err.error || 'Failed to create manual');
        return null;
      }
    } catch (err) {
      console.error('Failed to create manual:', err);
      toast.error('Failed to create manual');
      return null;
    }
  }

  async function updateManual(id: string, updates: Partial<Manual>) {
    try {
      const res = await apiFetch(`/api/manuals/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (res.ok) {
        const manual = await res.json();
        currentManual.value = manual;
        // Update list entry
        const idx = manualList.value.findIndex(m => m.id === id);
        if (idx >= 0) {
          manualList.value[idx] = { id: manual.id, title: manual.title, status: manual.status, updatedAt: manual.updatedAt };
        }
        return manual;
      }
    } catch (err) {
      console.error('Failed to update manual:', err);
      toast.error('Failed to update manual');
    }
    return null;
  }

  async function deleteManual(id: string, projectPath: string) {
    try {
      const res = await apiFetch(`/api/manuals/${id}`, { method: 'DELETE' });
      if (res.ok) {
        if (currentManual.value?.id === id) {
          currentManual.value = null;
        }
        await fetchManualList(projectPath);
        toast.success('Manual deleted');
      }
    } catch (err) {
      console.error('Failed to delete manual:', err);
      toast.error('Failed to delete manual');
    }
  }

  async function generateContent(id: string, providerId = 'claude', model?: string) {
    generating.value = true;
    generationStatus.value = { type: 'start', text: 'Connecting...' };
    try {
      const res = await apiFetch(`/api/manuals/${id}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId, model }),
      });

      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => '');
        let msg = 'Failed to generate manual';
        try { msg = (JSON.parse(text) as { error?: string }).error || msg; } catch { /* not JSON */ }
        toast.error(msg);
        return null;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // Parse SSE events (separated by double newlines)
        const parts = buffer.split('\n\n');
        buffer = parts.pop() ?? '';

        for (const part of parts) {
          const line = part.replace(/^data: /, '').trim();
          if (!line) continue;
          try {
            const event = JSON.parse(line) as { type: string; text?: string; manual?: typeof currentManual.value; error?: string };
            if (event.type === 'progress' && event.text) {
              generationStatus.value = { type: 'writing', text: event.text };
            } else if (event.type === 'done' && event.manual) {
              currentManual.value = event.manual;
              const idx = manualList.value.findIndex(m => m.id === id);
              if (idx >= 0 && event.manual) {
                manualList.value[idx] = { id: event.manual.id, title: event.manual.title, status: event.manual.status, updatedAt: event.manual.updatedAt };
              }
              toast.success('Manual generated successfully');
              return event.manual;
            } else if (event.type === 'error') {
              toast.error(event.error || 'Generation failed');
              return null;
            }
          } catch { /* ignore parse errors */ }
        }
      }

      return null;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('Failed to generate manual:', msg);
      toast.error(`Generation error: ${msg}`);
      return null;
    } finally {
      generating.value = false;
      generationStatus.value = null;
    }
  }

  function clearManual() {
    currentManual.value = null;
    versions.value = [];
  }

  async function fetchVersions(manualId: string) {
    versionsLoading.value = true;
    try {
      const res = await apiFetch(`/api/manuals/${manualId}/versions`);
      if (res.ok) {
        const data = await res.json();
        versions.value = (data.versions || []).map((v: { id: string; created_at: string }) => ({
          id: v.id,
          createdAt: v.created_at,
        }));
      }
    } catch (err) {
      console.error('Failed to fetch versions:', err);
    } finally {
      versionsLoading.value = false;
    }
  }

  async function getVersionContent(manualId: string, versionId: string): Promise<ManualVersionFull | null> {
    try {
      const res = await apiFetch(`/api/manuals/${manualId}/versions/${versionId}`);
      if (res.ok) {
        const v = await res.json() as { id: string; content: string; created_at: string };
        return { id: v.id, content: v.content, createdAt: v.created_at };
      }
    } catch (err) {
      console.error('Failed to get version content:', err);
    }
    return null;
  }

  async function restoreVersion(manualId: string, versionId: string) {
    try {
      const res = await apiFetch(`/api/manuals/${manualId}/versions/${versionId}/restore`, { method: 'POST' });
      if (res.ok) {
        const manual = await res.json();
        currentManual.value = manual;
        const idx = manualList.value.findIndex(m => m.id === manualId);
        if (idx >= 0) {
          manualList.value[idx] = { id: manual.id, title: manual.title, status: manual.status, updatedAt: manual.updatedAt };
        }
        await fetchVersions(manualId);
        toast.success('Version restored');
        return manual;
      }
    } catch (err) {
      console.error('Failed to restore version:', err);
      toast.error('Failed to restore version');
    }
    return null;
  }

  return {
    // State
    manualList,
    currentManual,
    loading,
    generating,
    generationStatus,
    versions,
    versionsLoading,

    // Computed
    manualCount,

    // Actions
    fetchManualList,
    loadManual,
    createManual,
    updateManual,
    deleteManual,
    generateContent,
    clearManual,
    fetchVersions,
    getVersionContent,
    restoreVersion,
  };
});
