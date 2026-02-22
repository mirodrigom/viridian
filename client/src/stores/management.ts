import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { toast } from 'vue-sonner';
import { apiFetch } from '@/lib/apiFetch';
import { createStoreWebSocket } from '@/lib/storeWebSocket';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ServiceStatus = 'stopped' | 'starting' | 'running' | 'error';

export interface ManagedService {
  id: string;
  name: string;
  command: string;
  cwd: string;
  sortOrder: number;
  status: ServiceStatus;
  pid?: number;
  startedAt?: number;
  createdAt: string;
}

export interface ManagedScript {
  id: string;
  name: string;
  command: string;
  cwd: string;
  sortOrder: number;
  createdAt: string;
}

export interface RunningProcess {
  serviceId: string;
  name: string;
  command: string;
  cwd: string;
  pid: number;
  uptimeMs: number;
  status: 'running';
}

// ─── Widget layout ────────────────────────────────────────────────────────────

export interface WidgetConfig {
  id: 'services' | 'scripts' | 'env' | 'processes';
  size: 'half' | 'full';
  visible: boolean;
  order: number;
}

const DEFAULT_LAYOUT: WidgetConfig[] = [
  { id: 'services',  size: 'half', visible: true, order: 0 },
  { id: 'scripts',   size: 'half', visible: true, order: 1 },
  { id: 'processes', size: 'half', visible: true, order: 2 },
  { id: 'env',       size: 'half', visible: true, order: 3 },
];

const LAYOUT_KEY = 'management_widget_layout';

function loadLayout(): WidgetConfig[] {
  try {
    const stored = localStorage.getItem(LAYOUT_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as WidgetConfig[];
      // Merge with defaults to handle newly added widgets
      const ids = new Set(parsed.map(w => w.id));
      const merged = [...parsed];
      for (const def of DEFAULT_LAYOUT) {
        if (!ids.has(def.id)) merged.push(def);
      }
      return merged;
    }
  } catch { /* ignore */ }
  return [...DEFAULT_LAYOUT];
}

function saveLayout(layout: WidgetConfig[]) {
  try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout)); } catch { /* ignore */ }
}

const MAX_LOG_LINES = 500;

export const useManagementStore = defineStore('management', () => {
  // ─── State ────────────────────────────────────────────────────────────────
  const services = ref<ManagedService[]>([]);
  const scripts = ref<ManagedScript[]>([]);
  const processes = ref<RunningProcess[]>([]);
  const loading = ref(false);
  const selectedServiceId = ref<string | null>(null);
  const serviceLogs = ref<Map<string, string[]>>(new Map());
  const widgetLayout = ref<WidgetConfig[]>(loadLayout());

  // ─── WebSocket ────────────────────────────────────────────────────────────
  const { connected, connect, disconnect, send, on } = createStoreWebSocket('/ws/management');

  on('service_status', (raw) => {
    const event = raw as { serviceId: string; status: ServiceStatus; pid?: number };
    const svc = services.value.find(s => s.id === event.serviceId);
    if (svc) {
      svc.status = event.status;
      if (event.pid) svc.pid = event.pid;
      if (event.status === 'stopped' || event.status === 'error') {
        svc.pid = undefined;
        svc.startedAt = undefined;
      }
      if (event.status === 'running') svc.startedAt = Date.now();
    }
  });

  on('service_output', (raw) => {
    const event = raw as { serviceId: string; data: string };
    const lines = serviceLogs.value.get(event.serviceId) ?? [];
    const newLines = event.data.split('\n');
    const combined = [...lines, ...newLines].slice(-MAX_LOG_LINES);
    serviceLogs.value.set(event.serviceId, combined);
    serviceLogs.value = new Map(serviceLogs.value);
  });

  // ─── Computed ─────────────────────────────────────────────────────────────
  const runningCount = computed(() => services.value.filter(s => s.status === 'running').length);

  const selectedServiceLogs = computed(() => {
    if (!selectedServiceId.value) return [];
    return serviceLogs.value.get(selectedServiceId.value) ?? [];
  });

  const sortedWidgets = computed(() =>
    [...widgetLayout.value].sort((a, b) => a.order - b.order),
  );

  // ─── Services actions ─────────────────────────────────────────────────────
  async function fetchServices() {
    const res = await apiFetch('/api/management/services');
    if (!res.ok) return;
    const data = await res.json() as { services: ManagedService[] };
    services.value = data.services;
  }

  async function addService(name: string, command: string, cwd: string) {
    const res = await apiFetch('/api/management/services', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, command, cwd }),
    });
    if (!res.ok) throw new Error('Failed to add service');
    const data = await res.json() as { service: ManagedService };
    services.value.push(data.service);
  }

  async function removeService(id: string) {
    await apiFetch(`/api/management/services/${id}`, { method: 'DELETE' });
    services.value = services.value.filter(s => s.id !== id);
    serviceLogs.value.delete(id);
    serviceLogs.value = new Map(serviceLogs.value);
    if (selectedServiceId.value === id) selectedServiceId.value = null;
  }

  async function startService(id: string) {
    const svc = services.value.find(s => s.id === id);
    if (svc) { svc.status = 'starting'; serviceLogs.value.set(id, []); serviceLogs.value = new Map(serviceLogs.value); }
    await apiFetch(`/api/management/services/${id}/start`, { method: 'POST' });
    selectedServiceId.value = id;
  }

  async function stopService(id: string) {
    await apiFetch(`/api/management/services/${id}/stop`, { method: 'POST' });
  }

  // ─── Scripts actions ──────────────────────────────────────────────────────
  async function fetchScripts() {
    const res = await apiFetch('/api/management/scripts');
    if (!res.ok) return;
    const data = await res.json() as { scripts: ManagedScript[] };
    scripts.value = data.scripts;
  }

  async function addScript(name: string, command: string, cwd: string) {
    const res = await apiFetch('/api/management/scripts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, command, cwd }),
    });
    if (!res.ok) throw new Error('Failed to add script');
    const data = await res.json() as { script: ManagedScript };
    scripts.value.push(data.script);
  }

  async function removeScript(id: string) {
    await apiFetch(`/api/management/scripts/${id}`, { method: 'DELETE' });
    scripts.value = scripts.value.filter(s => s.id !== id);
  }

  // ─── Processes ────────────────────────────────────────────────────────────
  async function fetchProcesses() {
    const res = await apiFetch('/api/management/processes');
    if (!res.ok) return;
    const data = await res.json() as { processes: RunningProcess[] };
    processes.value = data.processes;
  }

  // ─── Widget layout ────────────────────────────────────────────────────────
  function updateWidgetSize(id: WidgetConfig['id'], size: 'half' | 'full') {
    const w = widgetLayout.value.find(w => w.id === id);
    if (w) { w.size = size; saveLayout(widgetLayout.value); }
  }

  function reorderWidgets(newOrder: WidgetConfig[]) {
    widgetLayout.value = newOrder.map((w, i) => ({ ...w, order: i }));
    saveLayout(widgetLayout.value);
  }

  // ─── Misc ─────────────────────────────────────────────────────────────────
  function selectService(id: string | null) { selectedServiceId.value = id; }
  function clearLogs(id: string) { serviceLogs.value.set(id, []); serviceLogs.value = new Map(serviceLogs.value); }

  async function init() {
    loading.value = true;
    try { await Promise.all([fetchServices(), fetchScripts()]); }
    finally { loading.value = false; }
  }

  return {
    // State
    services, scripts, processes, loading,
    selectedServiceId, serviceLogs, widgetLayout,
    // Computed
    runningCount, selectedServiceLogs, sortedWidgets,
    connected,
    // Actions
    init, fetchServices, addService, removeService, startService, stopService,
    fetchScripts, addScript, removeScript,
    fetchProcesses,
    updateWidgetSize, reorderWidgets,
    selectService, clearLogs,
    connect, disconnect,
  };
});
