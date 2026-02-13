<script setup lang="ts">
import { ref, watch } from 'vue';
import { toast } from 'vue-sonner';
import { useAuthStore } from '@/stores/auth';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Plus, Trash2, Server, Terminal, Globe, Loader2, ChevronDown, ChevronRight } from 'lucide-vue-next';

const auth = useAuthStore();
const open = defineModel<boolean>('open', { default: false });

type ServerType = 'stdio' | 'sse' | 'http';

interface McpServerConfig {
  type?: ServerType;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

interface EditingServer {
  name: string;
  type: ServerType;
  command: string;
  args: string;
  envPairs: { key: string; value: string }[];
  url: string;
  headerPairs: { key: string; value: string }[];
}

const servers = ref<Record<string, McpServerConfig>>({});
const loading = ref(false);
const error = ref('');
const showAddForm = ref(false);
const expandedServer = ref<string | null>(null);
const addingServer = ref(false);
const removingServer = ref<string | null>(null);

const newServer = ref<EditingServer>(emptyServer());

function emptyServer(): EditingServer {
  return {
    name: '',
    type: 'stdio',
    command: '',
    args: '',
    envPairs: [{ key: '', value: '' }],
    url: '',
    headerPairs: [{ key: '', value: '' }],
  };
}

async function fetchServers() {
  loading.value = true;
  error.value = '';
  try {
    const res = await fetch('/api/mcp/servers', {
      headers: { Authorization: `Bearer ${auth.token}` },
    });
    if (!res.ok) throw new Error('Failed to load');
    const data = await res.json();
    servers.value = data.servers || {};
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to load MCP servers';
  }
  loading.value = false;
}

async function addServer() {
  const s = newServer.value;
  if (!s.name.trim()) return;

  const config: McpServerConfig = {};

  if (s.type === 'stdio') {
    if (!s.command.trim()) return;
    config.command = s.command.trim();
    if (s.args.trim()) config.args = s.args.split(/\s+/).filter(Boolean);
    const env: Record<string, string> = {};
    for (const p of s.envPairs) {
      if (p.key.trim()) env[p.key.trim()] = p.value;
    }
    if (Object.keys(env).length > 0) config.env = env;
  } else {
    if (!s.url.trim()) return;
    config.type = s.type;
    config.url = s.url.trim();
    const headers: Record<string, string> = {};
    for (const p of s.headerPairs) {
      if (p.key.trim()) headers[p.key.trim()] = p.value;
    }
    if (Object.keys(headers).length > 0) config.headers = headers;
  }

  addingServer.value = true;
  try {
    const res = await fetch('/api/mcp/servers', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${auth.token}`,
      },
      body: JSON.stringify({ name: s.name.trim(), config }),
    });
    if (!res.ok) {
      const data = await res.json();
      toast.error(data.error || 'Failed to add server');
      return;
    }
    const data = await res.json();
    servers.value = data.servers;
    newServer.value = emptyServer();
    showAddForm.value = false;
  } catch (err) {
    toast.error(err instanceof Error ? err.message : 'Failed to add server');
  } finally {
    addingServer.value = false;
  }
}

async function removeServer(name: string) {
  removingServer.value = name;
  try {
    const res = await fetch(`/api/mcp/servers/${encodeURIComponent(name)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${auth.token}` },
    });
    if (!res.ok) {
      const data = await res.json();
      toast.error(data.error || 'Failed to remove server');
      return;
    }
    const data = await res.json();
    servers.value = data.servers;
    if (expandedServer.value === name) expandedServer.value = null;
  } catch (err) {
    toast.error(err instanceof Error ? err.message : 'Failed to remove server');
  } finally {
    removingServer.value = null;
  }
}

function getServerType(config: McpServerConfig): ServerType {
  if (config.url) return config.type === 'http' ? 'http' : 'sse';
  return 'stdio';
}

function toggleExpand(name: string) {
  expandedServer.value = expandedServer.value === name ? null : name;
}

watch(open, (isOpen) => {
  if (isOpen) fetchServers();
});
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="max-h-[85vh] max-w-lg overflow-y-auto">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2">
          <Server class="h-5 w-5" />
          MCP Servers
        </DialogTitle>
        <DialogDescription>
          Manage Model Context Protocol servers for Claude Code
        </DialogDescription>
      </DialogHeader>

      <div class="space-y-4 py-2">
        <!-- Loading -->
        <div v-if="loading" class="flex items-center justify-center py-8">
          <Loader2 class="h-5 w-5 animate-spin text-muted-foreground" />
        </div>

        <!-- Error -->
        <p v-if="error" class="text-xs text-destructive">{{ error }}</p>

        <!-- Server list -->
        <template v-if="!loading">
          <div v-if="Object.keys(servers).length === 0" class="py-4 text-center text-sm text-muted-foreground">
            No MCP servers configured
          </div>

          <div v-else class="space-y-2">
            <div
              v-for="(config, name) in servers"
              :key="name"
              class="rounded-lg border border-border"
            >
              <div class="flex items-center gap-2 px-3 py-2.5">
                <button class="shrink-0 text-muted-foreground" @click="toggleExpand(String(name))">
                  <ChevronDown v-if="expandedServer === name" class="h-4 w-4" />
                  <ChevronRight v-else class="h-4 w-4" />
                </button>
                <component
                  :is="getServerType(config) === 'stdio' ? Terminal : Globe"
                  class="h-4 w-4 shrink-0 text-muted-foreground"
                />
                <div class="min-w-0 flex-1">
                  <div class="text-sm font-medium text-foreground">{{ name }}</div>
                  <div class="truncate text-xs text-muted-foreground">
                    {{ getServerType(config) === 'stdio' ? config.command : config.url }}
                  </div>
                </div>
                <span class="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">
                  {{ getServerType(config) }}
                </span>
                <Button variant="ghost" size="sm" class="h-7 w-7 p-0 text-destructive hover:bg-destructive/10" :disabled="removingServer === name" @click="removeServer(String(name))">
                  <Loader2 v-if="removingServer === name" class="h-3.5 w-3.5 animate-spin" />
                  <Trash2 v-else class="h-3.5 w-3.5" />
                </Button>
              </div>

              <!-- Expanded details -->
              <div v-if="expandedServer === name" class="border-t border-border bg-muted/30 px-3 py-2.5 text-xs">
                <template v-if="getServerType(config) === 'stdio'">
                  <div class="space-y-1">
                    <div><span class="text-muted-foreground">Command:</span> <code class="rounded bg-muted px-1">{{ config.command }}</code></div>
                    <div v-if="config.args?.length"><span class="text-muted-foreground">Args:</span> <code class="rounded bg-muted px-1">{{ config.args?.join(' ') }}</code></div>
                    <div v-if="config.env && Object.keys(config.env).length > 0">
                      <span class="text-muted-foreground">Env:</span>
                      <div v-for="(v, k) in config.env" :key="k" class="ml-3">
                        <code class="rounded bg-muted px-1">{{ k }}={{ v }}</code>
                      </div>
                    </div>
                  </div>
                </template>
                <template v-else>
                  <div class="space-y-1">
                    <div><span class="text-muted-foreground">URL:</span> <code class="rounded bg-muted px-1">{{ config.url }}</code></div>
                    <div v-if="config.headers && Object.keys(config.headers).length > 0">
                      <span class="text-muted-foreground">Headers:</span>
                      <div v-for="(v, k) in config.headers" :key="k" class="ml-3">
                        <code class="rounded bg-muted px-1">{{ k }}: {{ v }}</code>
                      </div>
                    </div>
                  </div>
                </template>
              </div>
            </div>
          </div>

          <Separator />

          <!-- Add server form -->
          <div>
            <Button v-if="!showAddForm" variant="outline" size="sm" class="w-full gap-1" @click="showAddForm = true">
              <Plus class="h-3.5 w-3.5" />
              Add Server
            </Button>

            <div v-else class="space-y-3 rounded-lg border border-primary/30 bg-card p-3">
              <div class="flex items-center justify-between">
                <h4 class="text-sm font-medium">Add MCP Server</h4>
                <Button variant="ghost" size="sm" class="h-6 text-xs" @click="showAddForm = false">Cancel</Button>
              </div>

              <div class="space-y-1.5">
                <Label class="text-xs">Name</Label>
                <Input v-model="newServer.name" placeholder="my-mcp-server" class="h-8 font-mono text-sm" />
              </div>

              <div class="space-y-1.5">
                <Label class="text-xs">Type</Label>
                <Select :model-value="newServer.type" @update:model-value="(v: any) => newServer.type = v">
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
              <template v-if="newServer.type === 'stdio'">
                <div class="space-y-1.5">
                  <Label class="text-xs">Command</Label>
                  <Input v-model="newServer.command" placeholder="npx" class="h-8 font-mono text-sm" />
                </div>
                <div class="space-y-1.5">
                  <Label class="text-xs">Arguments (space-separated)</Label>
                  <Input v-model="newServer.args" placeholder="-y @modelcontextprotocol/server-filesystem /home" class="h-8 font-mono text-sm" />
                </div>
                <div class="space-y-1.5">
                  <Label class="text-xs">Environment variables</Label>
                  <div v-for="(pair, idx) in newServer.envPairs" :key="idx" class="flex gap-1">
                    <Input v-model="pair.key" placeholder="KEY" class="h-7 w-1/3 font-mono text-xs" />
                    <Input v-model="pair.value" placeholder="value" class="h-7 flex-1 font-mono text-xs" />
                    <Button v-if="idx === newServer.envPairs.length - 1" variant="ghost" size="sm" class="h-7 w-7 p-0" @click="newServer.envPairs.push({ key: '', value: '' })">
                      <Plus class="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              </template>

              <!-- SSE/HTTP fields -->
              <template v-else>
                <div class="space-y-1.5">
                  <Label class="text-xs">URL</Label>
                  <Input v-model="newServer.url" placeholder="http://localhost:3000/mcp" class="h-8 font-mono text-sm" />
                </div>
                <div class="space-y-1.5">
                  <Label class="text-xs">Headers</Label>
                  <div v-for="(pair, idx) in newServer.headerPairs" :key="idx" class="flex gap-1">
                    <Input v-model="pair.key" placeholder="Header" class="h-7 w-1/3 font-mono text-xs" />
                    <Input v-model="pair.value" placeholder="value" class="h-7 flex-1 font-mono text-xs" />
                    <Button v-if="idx === newServer.headerPairs.length - 1" variant="ghost" size="sm" class="h-7 w-7 p-0" @click="newServer.headerPairs.push({ key: '', value: '' })">
                      <Plus class="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              </template>

              <Button size="sm" class="w-full gap-1" @click="addServer" :disabled="addingServer || !newServer.name.trim() || (newServer.type === 'stdio' ? !newServer.command.trim() : !newServer.url.trim())">
                <Loader2 v-if="addingServer" class="h-3.5 w-3.5 animate-spin" />
                <Plus v-else class="h-3.5 w-3.5" />
                {{ addingServer ? 'Adding...' : 'Add Server' }}
              </Button>
            </div>
          </div>
        </template>
      </div>
    </DialogContent>
  </Dialog>
</template>
