<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { useMcpStore, type McpServerType, type McpServerWithStatus, type CreateMcpServerPayload } from '@/stores/mcp';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Plus, Trash2, Server, Terminal, Globe, Loader2,
  ChevronDown, ChevronRight, Pencil, Zap, X, Wrench,
} from 'lucide-vue-next';

const open = defineModel<boolean>('open', { default: false });
const mcp = useMcpStore();

// ─── UI State ────────────────────────────────────────────────────────────────

const showAddForm = ref(false);
const editingId = ref<string | null>(null);
const expandedServer = ref<string | null>(null);
const deletingId = ref<string | null>(null);

// ─── Add/Edit form ───────────────────────────────────────────────────────────

interface ServerForm {
  name: string;
  serverType: McpServerType;
  command: string;
  args: string;
  envPairs: { key: string; value: string }[];
  url: string;
  headerPairs: { key: string; value: string }[];
}

function emptyForm(): ServerForm {
  return {
    name: '',
    serverType: 'stdio',
    command: '',
    args: '',
    envPairs: [{ key: '', value: '' }],
    url: '',
    headerPairs: [{ key: '', value: '' }],
  };
}

const form = ref<ServerForm>(emptyForm());
const submitting = ref(false);

function formIsValid(): boolean {
  if (!form.value.name.trim()) return false;
  if (form.value.serverType === 'stdio') {
    return !!form.value.command.trim();
  }
  return !!form.value.url.trim();
}

function startEdit(server: McpServerWithStatus) {
  editingId.value = server.id;
  showAddForm.value = true;
  form.value = {
    name: server.name,
    serverType: server.serverType as McpServerType,
    command: server.command,
    args: server.args.join(' '),
    envPairs: Object.keys(server.env).length > 0
      ? Object.entries(server.env).map(([key, value]) => ({ key, value }))
      : [{ key: '', value: '' }],
    url: server.url,
    headerPairs: Object.keys(server.headers).length > 0
      ? Object.entries(server.headers).map(([key, value]) => ({ key, value }))
      : [{ key: '', value: '' }],
  };
}

function cancelForm() {
  showAddForm.value = false;
  editingId.value = null;
  form.value = emptyForm();
}

function buildPayload(): CreateMcpServerPayload {
  const f = form.value;
  const env: Record<string, string> = {};
  for (const p of f.envPairs) {
    if (p.key.trim()) env[p.key.trim()] = p.value;
  }
  const headers: Record<string, string> = {};
  for (const p of f.headerPairs) {
    if (p.key.trim()) headers[p.key.trim()] = p.value;
  }

  return {
    name: f.name.trim(),
    serverType: f.serverType,
    command: f.command.trim(),
    args: f.args.trim() ? f.args.trim().split(/\s+/).filter(Boolean) : [],
    env,
    url: f.url.trim(),
    headers,
    enabled: true,
  };
}

async function submitForm() {
  if (!formIsValid() || submitting.value) return;
  submitting.value = true;
  try {
    if (editingId.value) {
      const ok = await mcp.updateServer(editingId.value, buildPayload());
      if (ok) cancelForm();
    } else {
      const server = await mcp.createServer(buildPayload());
      if (server) cancelForm();
    }
  } finally {
    submitting.value = false;
  }
}

async function handleDelete(id: string) {
  deletingId.value = id;
  try {
    await mcp.deleteServer(id);
    if (expandedServer.value === id) expandedServer.value = null;
  } finally {
    deletingId.value = null;
  }
}

function toggleExpand(id: string) {
  expandedServer.value = expandedServer.value === id ? null : id;
}

// ─── Status helpers ──────────────────────────────────────────────────────────

function statusColor(status: string): string {
  switch (status) {
    case 'connected': return 'bg-green-500';
    case 'error': return 'bg-red-500';
    case 'testing': return 'bg-yellow-500 animate-pulse';
    case 'disabled': return 'bg-gray-400';
    default: return 'bg-gray-400';
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case 'connected': return 'Connected';
    case 'error': return 'Error';
    case 'testing': return 'Testing...';
    case 'disabled': return 'Disabled';
    default: return 'Unknown';
  }
}

function statusBadgeVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'connected': return 'default';
    case 'error': return 'destructive';
    default: return 'secondary';
  }
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

watch(open, (isOpen) => {
  if (isOpen) {
    mcp.fetchServers();
    cancelForm();
  }
});
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="max-h-[85vh] max-w-xl overflow-y-auto">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2">
          <Server class="h-5 w-5" />
          MCP Servers
        </DialogTitle>
        <DialogDescription>
          Manage Model Context Protocol servers. Enabled servers are available across all agents and sessions.
        </DialogDescription>
      </DialogHeader>

      <div class="space-y-4 py-2">
        <!-- Loading -->
        <div v-if="mcp.loading" class="flex items-center justify-center py-8">
          <Loader2 class="h-5 w-5 animate-spin text-muted-foreground" />
        </div>

        <!-- Error -->
        <p v-if="mcp.error" class="text-xs text-destructive">{{ mcp.error }}</p>

        <!-- Server list -->
        <template v-if="!mcp.loading">
          <div v-if="mcp.servers.length === 0 && !showAddForm" class="py-6 text-center">
            <Server class="mx-auto mb-2 h-8 w-8 text-muted-foreground/50" />
            <p class="text-sm text-muted-foreground">No MCP servers configured</p>
            <p class="mt-1 text-xs text-muted-foreground/70">Add a server to provide tools to your agents</p>
          </div>

          <div v-if="mcp.servers.length > 0" class="space-y-2">
            <div
              v-for="server in mcp.servers"
              :key="server.id"
              class="rounded-lg border border-border transition-colors"
              :class="{ 'opacity-50': !server.enabled }"
            >
              <!-- Server header row -->
              <div class="flex items-center gap-2 px-3 py-2.5">
                <button class="shrink-0 text-muted-foreground" @click="toggleExpand(server.id)">
                  <ChevronDown v-if="expandedServer === server.id" class="h-4 w-4" />
                  <ChevronRight v-else class="h-4 w-4" />
                </button>

                <!-- Status indicator -->
                <span
                  class="h-2 w-2 shrink-0 rounded-full"
                  :class="statusColor(server.status)"
                  :title="statusLabel(server.status)"
                />

                <!-- Icon by type -->
                <component
                  :is="server.serverType === 'stdio' ? Terminal : Globe"
                  class="h-4 w-4 shrink-0 text-muted-foreground"
                />

                <!-- Name & description -->
                <div class="min-w-0 flex-1">
                  <div class="text-sm font-medium text-foreground">{{ server.name }}</div>
                  <div class="truncate text-xs text-muted-foreground">
                    {{ server.serverType === 'stdio' ? server.command : server.url }}
                  </div>
                </div>

                <!-- Type badge -->
                <span class="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">
                  {{ server.serverType }}
                </span>

                <!-- Enable/disable toggle -->
                <Switch
                  :checked="server.enabled"
                  @update:checked="mcp.toggleServer(server.id)"
                  class="scale-75"
                />

                <!-- Edit -->
                <Button
                  variant="ghost" size="sm"
                  class="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                  @click="startEdit(server)"
                  title="Edit"
                >
                  <Pencil class="h-3.5 w-3.5" />
                </Button>

                <!-- Delete -->
                <Button
                  variant="ghost" size="sm"
                  class="h-7 w-7 p-0 text-destructive hover:bg-destructive/10"
                  :disabled="deletingId === server.id"
                  @click="handleDelete(server.id)"
                  title="Delete"
                >
                  <Loader2 v-if="deletingId === server.id" class="h-3.5 w-3.5 animate-spin" />
                  <Trash2 v-else class="h-3.5 w-3.5" />
                </Button>
              </div>

              <!-- Expanded details -->
              <div v-if="expandedServer === server.id" class="border-t border-border bg-muted/30 px-3 py-3 text-xs">
                <!-- Status & test -->
                <div class="mb-3 flex items-center gap-2">
                  <Badge :variant="statusBadgeVariant(server.status)" class="text-[10px]">
                    {{ statusLabel(server.status) }}
                  </Badge>
                  <Button
                    variant="outline" size="sm"
                    class="h-6 gap-1 px-2 text-[11px]"
                    :disabled="!server.enabled || server.status === 'testing'"
                    @click="mcp.testServer(server.id)"
                  >
                    <Loader2 v-if="server.status === 'testing'" class="h-3 w-3 animate-spin" />
                    <Zap v-else class="h-3 w-3" />
                    Test Connection
                  </Button>
                </div>

                <!-- Error message -->
                <div v-if="server.error" class="mb-3 rounded-md bg-destructive/10 px-2 py-1.5 text-destructive">
                  {{ server.error }}
                </div>

                <!-- Server config details -->
                <template v-if="server.serverType === 'stdio'">
                  <div class="space-y-1">
                    <div><span class="text-muted-foreground">Command:</span> <code class="rounded bg-muted px-1">{{ server.command }}</code></div>
                    <div v-if="server.args.length > 0"><span class="text-muted-foreground">Args:</span> <code class="rounded bg-muted px-1">{{ server.args.join(' ') }}</code></div>
                    <div v-if="Object.keys(server.env).length > 0">
                      <span class="text-muted-foreground">Env:</span>
                      <div v-for="(v, k) in server.env" :key="k" class="ml-3">
                        <code class="rounded bg-muted px-1">{{ k }}={{ v }}</code>
                      </div>
                    </div>
                  </div>
                </template>
                <template v-else>
                  <div class="space-y-1">
                    <div><span class="text-muted-foreground">URL:</span> <code class="rounded bg-muted px-1">{{ server.url }}</code></div>
                    <div v-if="Object.keys(server.headers).length > 0">
                      <span class="text-muted-foreground">Headers:</span>
                      <div v-for="(v, k) in server.headers" :key="k" class="ml-3">
                        <code class="rounded bg-muted px-1">{{ k }}: {{ v }}</code>
                      </div>
                    </div>
                  </div>
                </template>

                <!-- Tools list -->
                <div v-if="server.tools.length > 0" class="mt-3">
                  <div class="mb-1.5 flex items-center gap-1 text-muted-foreground">
                    <Wrench class="h-3 w-3" />
                    <span class="font-medium">Available Tools ({{ server.tools.length }})</span>
                  </div>
                  <div class="flex flex-wrap gap-1">
                    <Badge
                      v-for="tool in server.tools"
                      :key="tool.name"
                      variant="outline"
                      class="text-[10px]"
                      :title="tool.description || tool.name"
                    >
                      {{ tool.name }}
                    </Badge>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <Separator />

          <!-- Add/Edit server form -->
          <div>
            <Button
              v-if="!showAddForm"
              variant="outline" size="sm"
              class="w-full gap-1"
              @click="showAddForm = true; editingId = null; form = emptyForm();"
            >
              <Plus class="h-3.5 w-3.5" />
              Add Server
            </Button>

            <div v-else class="space-y-3 rounded-lg border border-primary/30 bg-card p-3">
              <div class="flex items-center justify-between">
                <h4 class="text-sm font-medium">
                  {{ editingId ? 'Edit MCP Server' : 'Add MCP Server' }}
                </h4>
                <Button variant="ghost" size="sm" class="h-6 w-6 p-0" @click="cancelForm">
                  <X class="h-3.5 w-3.5" />
                </Button>
              </div>

              <div class="space-y-1.5">
                <Label class="text-xs">Name</Label>
                <Input
                  v-model="form.name"
                  placeholder="my-mcp-server"
                  class="h-8 font-mono text-sm"
                />
              </div>

              <div class="space-y-1.5">
                <Label class="text-xs">Type</Label>
                <Select :model-value="form.serverType" @update:model-value="(v: any) => form.serverType = v">
                  <SelectTrigger class="h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="stdio">Stdio (local process)</SelectItem>
                    <SelectItem value="sse">SSE (Server-Sent Events)</SelectItem>
                    <SelectItem value="http">HTTP (Streamable HTTP)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <!-- Stdio fields -->
              <template v-if="form.serverType === 'stdio'">
                <div class="space-y-1.5">
                  <Label class="text-xs">Command</Label>
                  <Input v-model="form.command" placeholder="npx" class="h-8 font-mono text-sm" />
                </div>
                <div class="space-y-1.5">
                  <Label class="text-xs">Arguments (space-separated)</Label>
                  <Input v-model="form.args" placeholder="-y @modelcontextprotocol/server-filesystem /home" class="h-8 font-mono text-sm" />
                </div>
                <div class="space-y-1.5">
                  <Label class="text-xs">Environment variables</Label>
                  <div v-for="(pair, idx) in form.envPairs" :key="idx" class="flex gap-1">
                    <Input v-model="pair.key" placeholder="KEY" class="h-7 w-1/3 font-mono text-xs" />
                    <Input v-model="pair.value" placeholder="value" class="h-7 flex-1 font-mono text-xs" />
                    <Button
                      v-if="idx === form.envPairs.length - 1"
                      variant="ghost" size="sm" class="h-7 w-7 p-0"
                      @click="form.envPairs.push({ key: '', value: '' })"
                    >
                      <Plus class="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              </template>

              <!-- SSE/HTTP fields -->
              <template v-else>
                <div class="space-y-1.5">
                  <Label class="text-xs">URL</Label>
                  <Input v-model="form.url" placeholder="http://localhost:3000/mcp" class="h-8 font-mono text-sm" />
                </div>
                <div class="space-y-1.5">
                  <Label class="text-xs">Headers</Label>
                  <div v-for="(pair, idx) in form.headerPairs" :key="idx" class="flex gap-1">
                    <Input v-model="pair.key" placeholder="Header" class="h-7 w-1/3 font-mono text-xs" />
                    <Input v-model="pair.value" placeholder="value" class="h-7 flex-1 font-mono text-xs" />
                    <Button
                      v-if="idx === form.headerPairs.length - 1"
                      variant="ghost" size="sm" class="h-7 w-7 p-0"
                      @click="form.headerPairs.push({ key: '', value: '' })"
                    >
                      <Plus class="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              </template>

              <Button
                size="sm" class="w-full gap-1"
                :disabled="submitting || !formIsValid()"
                @click="submitForm"
              >
                <Loader2 v-if="submitting" class="h-3.5 w-3.5 animate-spin" />
                <template v-else>
                  <Pencil v-if="editingId" class="h-3.5 w-3.5" />
                  <Plus v-else class="h-3.5 w-3.5" />
                </template>
                {{ submitting ? 'Saving...' : (editingId ? 'Update Server' : 'Add Server') }}
              </Button>
            </div>
          </div>
        </template>
      </div>
    </DialogContent>
  </Dialog>
</template>
