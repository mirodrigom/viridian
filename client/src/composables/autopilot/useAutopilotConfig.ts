import { ref } from 'vue';
import { toast } from 'vue-sonner';
import { useAuthStore } from '@/stores/auth';
import type {
  AutopilotConfig,
  AutopilotProfile,
  AutopilotRunSummary,
} from '@/types/autopilot';

/**
 * Composable for managing autopilot configuration and REST API calls
 */
export function useAutopilotConfig() {
  const configs = ref<AutopilotConfig[]>([]);
  const profiles = ref<AutopilotProfile[]>([]);
  const runs = ref<AutopilotRunSummary[]>([]);

  const auth = useAuthStore();

  async function fetchProfiles() {
    try {
      const res = await fetch('/api/autopilot/profiles', {
        headers: { Authorization: `Bearer ${auth.token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      profiles.value = data.profiles;
    } catch (err) {
      console.warn('[autopilot] fetchProfiles failed:', err);
      toast.error('Failed to load profiles');
    }
  }

  async function fetchConfigs(project: string) {
    try {
      const res = await fetch(`/api/autopilot/configs?project=${encodeURIComponent(project)}`, {
        headers: { Authorization: `Bearer ${auth.token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      configs.value = data.configs;
    } catch (err) {
      console.warn('[autopilot] fetchConfigs failed:', err);
      toast.error('Failed to load configs');
    }
  }

  async function fetchRuns(project?: string) {
    try {
      const url = project
        ? `/api/autopilot/runs?project=${encodeURIComponent(project)}&limit=20`
        : '/api/autopilot/runs?limit=20';
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${auth.token}` },
      });
      if (!res.ok) return [];
      return (await res.json()).runs;
    } catch (err) {
      console.warn('[autopilot] fetchRuns failed:', err);
      return [];
    }
  }

  async function fetchRunHistory(project?: string) {
    try {
      const url = project
        ? `/api/autopilot/runs?project=${encodeURIComponent(project)}&limit=50`
        : '/api/autopilot/runs?limit=50';
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${auth.token}` },
      });
      if (!res.ok) return;
      runs.value = (await res.json()).runs as AutopilotRunSummary[];
    } catch (err) {
      console.warn('[autopilot] fetchRunHistory failed:', err);
      toast.error('Failed to load run history');
    }
  }

  function clearConfigs() {
    configs.value = [];
    profiles.value = [];
    runs.value = [];
  }

  return {
    // State
    configs,
    profiles,
    runs,

    // Actions
    fetchProfiles,
    fetchConfigs,
    fetchRuns,
    fetchRunHistory,
    clearConfigs,
  };
}