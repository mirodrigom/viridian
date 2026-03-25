import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { toast } from 'vue-sonner';
import { apiFetch } from '@/lib/apiFetch';

// ─── Types ───────────────────────────────────────────────────────────────────

export type McpServerType = 'stdio' | 'sse' | 'http';
export type McpServerStatus = 'unknown' | 'connected' | 'error' | 'disabled' | 'testing';

export interface McpServerConfig {
  id: string;
  name: string;
  serverType: McpServerType;
  command: string;
  args: string[];
  env: Record<string, string>;
  url: string;
  headers: Record<string, string>;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface McpServerTool {
  name: string;
  description?: string;
}

export interface McpServerWithStatus extends McpServerConfig {
  status: McpServerStatus;
  tools: McpServerTool[];
  error?: string;
}

export interface CreateMcpServerPayload {
  name: string;
  serverType: McpServerType;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  enabled?: boolean;
}

export interface UpdateMcpServerPayload {
  name?: string;
  serverType?: McpServerType;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  enabled?: boolean;
}

// ─── Store ───────────────────────────────────────────────────────────────────

export const useMcpStore = defineStore('mcp', () => {
  const servers = ref<McpServerWithStatus[]>([]);
  const loading = ref(false);
  const error = ref('');

  // ─── Computed ──────────────────────────────────────────────────────────────

  const enabledCount = computed(() => servers.value.filter(s => s.enabled).length);
  const connectedCount = computed(() => servers.value.filter(s => s.status === 'connected').length);

  // ─── Actions ───────────────────────────────────────────────────────────────

  async function fetchServers() {
    loading.value = true;
    error.value = '';
    try {
      const res = await apiFetch('/api/mcp/managed');
      if (!res.ok) throw new Error('Failed to load MCP servers');
      const data = await res.json() as { servers: McpServerConfig[] };
      // Preserve existing status/tools for servers that already exist
      const existingMap = new Map(servers.value.map(s => [s.id, s]));
      servers.value = data.servers.map(s => {
        const existing = existingMap.get(s.id);
        return {
          ...s,
          status: s.enabled ? (existing?.status || 'unknown') : 'disabled',
          tools: existing?.tools || [],
          error: existing?.error,
        };
      });
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load';
    } finally {
      loading.value = false;
    }
  }

  async function createServer(payload: CreateMcpServerPayload): Promise<McpServerWithStatus | null> {
    try {
      const res = await apiFetch('/api/mcp/managed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || 'Failed to create server');
        return null;
      }
      const data = await res.json() as { server: McpServerConfig };
      const server: McpServerWithStatus = {
        ...data.server,
        status: data.server.enabled ? 'unknown' : 'disabled',
        tools: [],
      };
      servers.value = [...servers.value, server];
      toast.success(`MCP server "${data.server.name}" added`);
      return server;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create server');
      return null;
    }
  }

  async function updateServer(id: string, payload: UpdateMcpServerPayload): Promise<boolean> {
    try {
      const res = await apiFetch(`/api/mcp/managed/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || 'Failed to update server');
        return false;
      }
      const data = await res.json() as { server: McpServerConfig };
      servers.value = servers.value.map(s =>
        s.id === id
          ? { ...s, ...data.server, status: data.server.enabled ? s.status : 'disabled' }
          : s,
      );
      toast.success('Server updated');
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update server');
      return false;
    }
  }

  async function deleteServer(id: string): Promise<boolean> {
    const server = servers.value.find(s => s.id === id);
    try {
      const res = await apiFetch(`/api/mcp/managed/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        toast.error('Failed to delete server');
        return false;
      }
      servers.value = servers.value.filter(s => s.id !== id);
      if (server) toast.success(`"${server.name}" removed`);
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete server');
      return false;
    }
  }

  async function toggleServer(id: string): Promise<boolean> {
    try {
      const res = await apiFetch(`/api/mcp/managed/${id}/toggle`, { method: 'PATCH' });
      if (!res.ok) {
        toast.error('Failed to toggle server');
        return false;
      }
      const data = await res.json() as { server: McpServerConfig };
      servers.value = servers.value.map(s =>
        s.id === id
          ? {
              ...s,
              ...data.server,
              status: data.server.enabled ? 'unknown' : 'disabled',
              tools: data.server.enabled ? s.tools : [],
            }
          : s,
      );
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to toggle server');
      return false;
    }
  }

  async function testServer(id: string): Promise<void> {
    const idx = servers.value.findIndex(s => s.id === id);
    if (idx === -1) return;

    servers.value[idx] = { ...servers.value[idx]!, status: 'testing', error: undefined };

    try {
      const res = await apiFetch(`/api/mcp/managed/${id}/test`, { method: 'POST' });
      if (!res.ok) throw new Error('Test request failed');
      const data = await res.json() as { status: 'connected' | 'error'; error?: string; tools: McpServerTool[] };

      servers.value = servers.value.map(s =>
        s.id === id
          ? { ...s, status: data.status, tools: data.tools, error: data.error }
          : s,
      );

      if (data.status === 'connected') {
        toast.success(`Connected to "${servers.value.find(s => s.id === id)?.name}" (${data.tools.length} tools)`);
      } else {
        toast.error(`Connection failed: ${data.error}`);
      }
    } catch (err) {
      servers.value = servers.value.map(s =>
        s.id === id
          ? { ...s, status: 'error', error: (err as Error).message }
          : s,
      );
      toast.error(`Test failed: ${(err as Error).message}`);
    }
  }

  return {
    servers,
    loading,
    error,
    enabledCount,
    connectedCount,
    fetchServers,
    createServer,
    updateServer,
    deleteServer,
    toggleServer,
    testServer,
  };
});
