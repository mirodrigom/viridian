import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { toast } from 'vue-sonner';
import { apiFetch } from '@/lib/apiFetch';
import { createStoreWebSocket } from '@/lib/storeWebSocket';
import type {
  Project, ProjectService,
  ServiceStatusEvent, ServiceOutputEvent, AgentStatusEvent,
} from '@/types/projects';

const MAX_LOG_LINES = 500;

export const useProjectsStore = defineStore('projects', () => {
  // ─── State ───────────────────────────────────────────────────────────────────
  const projects = ref<Project[]>([]);
  const loading = ref(false);
  const selectedServiceId = ref<string | null>(null);
  // serviceId → last N lines of combined stdout/stderr
  const processLogs = ref<Map<string, string[]>>(new Map());

  // ─── WebSocket ───────────────────────────────────────────────────────────────
  const { connected, connect, disconnect, send, on } = createStoreWebSocket('/ws/projects');

  on('service_status', (raw) => {
    const event = raw as ServiceStatusEvent;
    const project = projects.value.find(p => p.id === event.projectId);
    if (!project) return;
    const service = project.services.find(s => s.id === event.serviceId);
    if (!service) return;
    service.status = event.status;
  });

  on('service_output', (raw) => {
    const event = raw as ServiceOutputEvent;
    const lines = processLogs.value.get(event.serviceId) ?? [];
    // Split incoming data on newlines, append
    const newLines = event.data.split('\n');
    const combined = [...lines, ...newLines].slice(-MAX_LOG_LINES);
    processLogs.value.set(event.serviceId, combined);
    // Trigger reactivity
    processLogs.value = new Map(processLogs.value);
  });

  on('agent_status', (raw) => {
    const event = raw as AgentStatusEvent;
    const project = projects.value.find(p => p.id === event.projectId);
    if (!project) return;
    project.agentStatus = event.status;
    project.agentSessionId = event.sessionId;
  });

  // ─── Computed ─────────────────────────────────────────────────────────────────
  const selectedServiceLogs = computed(() => {
    if (!selectedServiceId.value) return [];
    return processLogs.value.get(selectedServiceId.value) ?? [];
  });

  const runningCount = computed(() =>
    projects.value.reduce((acc, p) =>
      acc + p.services.filter(s => s.status === 'running').length, 0),
  );

  // ─── Actions ──────────────────────────────────────────────────────────────────

  async function fetchProjects() {
    loading.value = true;
    try {
      const res = await apiFetch('/api/projects');
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json() as { projects: Project[] };
      projects.value = data.projects;
      // Subscribe to all loaded projects via WS
      for (const p of data.projects) {
        send({ type: 'subscribe', projectId: p.id });
      }
    } catch (err) {
      toast.error('Failed to load projects');
      console.error(err);
    } finally {
      loading.value = false;
    }
  }

  async function addProject(payload: {
    name: string;
    path: string;
    description?: string;
    services: { name: string; command: string }[];
  }) {
    const res = await apiFetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const data = await res.json() as { error?: string };
      throw new Error(data.error || 'Failed to create project');
    }
    const data = await res.json() as { project: Project };
    projects.value.unshift(data.project);
    send({ type: 'subscribe', projectId: data.project.id });
    return data.project;
  }

  async function deleteProject(projectId: string) {
    const res = await apiFetch(`/api/projects/${projectId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete project');
    send({ type: 'unsubscribe', projectId });
    projects.value = projects.value.filter(p => p.id !== projectId);
    // Clear logs for all its services
    const project = projects.value.find(p => p.id === projectId);
    if (project) {
      for (const s of project.services) processLogs.value.delete(s.id);
      processLogs.value = new Map(processLogs.value);
    }
  }

  async function addService(projectId: string, name: string, command: string) {
    const res = await apiFetch(`/api/projects/${projectId}/services`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, command }),
    });
    if (!res.ok) throw new Error('Failed to add service');
    const data = await res.json() as { service: ProjectService };
    const project = projects.value.find(p => p.id === projectId);
    if (project) project.services.push(data.service);
    return data.service;
  }

  async function removeService(projectId: string, serviceId: string) {
    const res = await apiFetch(`/api/projects/${projectId}/services/${serviceId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to remove service');
    const project = projects.value.find(p => p.id === projectId);
    if (project) project.services = project.services.filter(s => s.id !== serviceId);
    processLogs.value.delete(serviceId);
    processLogs.value = new Map(processLogs.value);
  }

  async function startService(projectId: string, serviceId: string) {
    // Optimistically mark as starting
    const project = projects.value.find(p => p.id === projectId);
    const service = project?.services.find(s => s.id === serviceId);
    if (service) service.status = 'starting';

    const res = await apiFetch(`/api/projects/${projectId}/services/${serviceId}/start`, { method: 'POST' });
    if (!res.ok) {
      if (service) service.status = 'error';
      throw new Error('Failed to start service');
    }
    // Clear old logs when starting fresh
    processLogs.value.set(serviceId, []);
    processLogs.value = new Map(processLogs.value);
  }

  async function stopService(projectId: string, serviceId: string) {
    const res = await apiFetch(`/api/projects/${projectId}/services/${serviceId}/stop`, { method: 'POST' });
    if (!res.ok) throw new Error('Failed to stop service');
  }

  async function startAllServices(projectId: string) {
    const project = projects.value.find(p => p.id === projectId);
    if (!project) return;
    for (const s of project.services) {
      if (s.status !== 'running') {
        await startService(projectId, s.id).catch(() => null);
      }
    }
  }

  async function stopAllServices(projectId: string) {
    const project = projects.value.find(p => p.id === projectId);
    if (!project) return;
    for (const s of project.services) {
      if (s.status === 'running' || s.status === 'starting') {
        await stopService(projectId, s.id).catch(() => null);
      }
    }
  }

  async function activateAgent(projectId: string): Promise<string> {
    const res = await apiFetch(`/api/projects/${projectId}/agent/activate`, { method: 'POST' });
    if (!res.ok) throw new Error('Failed to activate agent');
    const data = await res.json() as { sessionId: string };
    const project = projects.value.find(p => p.id === projectId);
    if (project) {
      project.agentStatus = 'active';
      project.agentSessionId = data.sessionId;
    }
    return data.sessionId;
  }

  async function deactivateAgent(projectId: string) {
    const res = await apiFetch(`/api/projects/${projectId}/agent/deactivate`, { method: 'POST' });
    if (!res.ok) throw new Error('Failed to deactivate agent');
    const project = projects.value.find(p => p.id === projectId);
    if (project) {
      project.agentStatus = 'inactive';
      project.agentSessionId = undefined;
    }
  }

  function selectService(serviceId: string | null) {
    selectedServiceId.value = serviceId;
  }

  function clearLogs(serviceId: string) {
    processLogs.value.set(serviceId, []);
    processLogs.value = new Map(processLogs.value);
  }

  return {
    // State
    projects,
    loading,
    selectedServiceId,
    processLogs,
    // Computed
    selectedServiceLogs,
    runningCount,
    connected,
    // Actions
    fetchProjects,
    addProject,
    deleteProject,
    addService,
    removeService,
    startService,
    stopService,
    startAllServices,
    stopAllServices,
    activateAgent,
    deactivateAgent,
    selectService,
    clearLogs,
    connect,
    disconnect,
  };
});
