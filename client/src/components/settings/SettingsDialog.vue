<script setup lang="ts">
import { ref, watch } from 'vue';
import { apiFetch } from '@/lib/apiFetch';
import { useChatStore } from '@/stores/chat';
import { useSettingsStore, COMMON_TOOLS, COMMON_DISALLOWED } from '@/stores/settings';
import { useMcpStore, type McpServerType, type McpServerWithStatus, type CreateMcpServerPayload } from '@/stores/mcp';
import {
  Dialog, DialogContent,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import ProviderSelector from './ProviderSelector.vue';
import AudioProviderSettings from './AudioProviderSettings.vue';
import PersonaSettings from './PersonaSettings.vue';
import {
  Brain, Mic, Bot, Shield, Server, GitBranch,
  AlertTriangle, Plus, X, Terminal, Globe, Loader2,
  ChevronDown, ChevronRight, Pencil, Zap, Wrench, Trash2,
} from 'lucide-vue-next';

const chat = useChatStore();
const settingsStore = useSettingsStore();
const mcp = useMcpStore();

const open = defineModel<boolean>('open', { default: false });
const section = defineModel<string>('section', { default: 'providers' });

// ─── Section definitions ──────────────────────────────────────────────────

const SECTIONS = [
  { id: 'providers', label: 'AI Providers', icon: Brain },
  { id: 'speech', label: 'Speech-to-Text', icon: Mic },
  { id: 'assistants', label: 'Assistants', icon: Bot },
  { id: 'tools', label: 'Permissions', icon: Shield },
  { id: 'mcp', label: 'MCP Servers', icon: Server },
  { id: 'git', label: 'Git Identity', icon: GitBranch },
] as const;

// ─── Git Identity ─────────────────────────────────────────────────────────

const gitName = ref('');
const gitEmail = ref('');
const gitConfigLoading = ref(false);
const gitConfigSaved = ref(false);

async function loadGitConfig() {
  if (!chat.projectPath) return;
  gitConfigLoading.value = true;
  try {
    const res = await apiFetch(
      `/api/git/user-config?cwd=${encodeURIComponent(chat.projectPath)}`,
    );
    if (res.ok) {
      const data = await res.json();
      gitName.value = data.name || '';
      gitEmail.value = data.email || '';
    }
  } catch { /* ignore */ }
  gitConfigLoading.value = false;
}

async function saveGitConfig() {
  if (!chat.projectPath || gitConfigLoading.value) return;
  try {
    await apiFetch('/api/git/user-config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cwd: chat.projectPath, name: gitName.value, email: gitEmail.value }),
    });
    gitConfigSaved.value = true;
    setTimeout(() => { gitConfigSaved.value = false; }, 2000);
  } catch { /* ignore */ }
}

// ─── Tools & Permissions ──────────────────────────────────────────────────

const newAllowedTool = ref('');
const newDisallowedTool = ref('');

function addAllowed() {
  const tool = newAllowedTool.value.trim();
  if (tool) { settingsStore.addAllowedTool(tool); newAllowedTool.value = ''; }
}
function addDisallowed() {
  const tool = newDisallowedTool.value.trim();
  if (tool) { settingsStore.addDisallowedTool(tool); newDisallowedTool.value = ''; }
}
function toggleSkipPermissions(checked: boolean) {
  settingsStore.permissionMode = checked ? 'bypassPermissions' : 'default';
  settingsStore.save();
}

// ─── MCP Servers ──────────────────────────────────────────────────────────

const showAddForm = ref(false);
const editingId = ref<string | null>(null);
const expandedServer = ref<string | null>(null);
const deletingId = ref<string | null>(null);

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
  return { name: '', serverType: 'stdio', command: '', args: '', envPairs: [{ key: '', value: '' }], url: '', headerPairs: [{ key: '', value: '' }] };
}
const mcpForm = ref<ServerForm>(emptyForm());
const mcpSubmitting = ref(false);

function mcpFormIsValid(): boolean {
  if (!mcpForm.value.name.trim()) return false;
  return mcpForm.value.serverType === 'stdio' ? !!mcpForm.value.command.trim() : !!mcpForm.value.url.trim();
}
function startEdit(server: McpServerWithStatus) {
  editingId.value = server.id;
  showAddForm.value = true;
  mcpForm.value = {
    name: server.name, serverType: server.serverType as McpServerType,
    command: server.command, args: server.args.join(' '),
    envPairs: Object.keys(server.env).length > 0 ? Object.entries(server.env).map(([key, value]) => ({ key, value })) : [{ key: '', value: '' }],
    url: server.url,
    headerPairs: Object.keys(server.headers).length > 0 ? Object.entries(server.headers).map(([key, value]) => ({ key, value })) : [{ key: '', value: '' }],
  };
}
function cancelForm() { showAddForm.value = false; editingId.value = null; mcpForm.value = emptyForm(); }
function buildPayload(): CreateMcpServerPayload {
  const f = mcpForm.value;
  const env: Record<string, string> = {};
  for (const p of f.envPairs) { if (p.key.trim()) env[p.key.trim()] = p.value; }
  const headers: Record<string, string> = {};
  for (const p of f.headerPairs) { if (p.key.trim()) headers[p.key.trim()] = p.value; }
  return { name: f.name.trim(), serverType: f.serverType, command: f.command.trim(), args: f.args.trim() ? f.args.trim().split(/\s+/).filter(Boolean) : [], env, url: f.url.trim(), headers, enabled: true };
}
async function mcpSubmitForm() {
  if (!mcpFormIsValid() || mcpSubmitting.value) return;
  mcpSubmitting.value = true;
  try {
    if (editingId.value) { const ok = await mcp.updateServer(editingId.value, buildPayload()); if (ok) cancelForm(); }
    else { const server = await mcp.createServer(buildPayload()); if (server) cancelForm(); }
  } finally { mcpSubmitting.value = false; }
}
async function handleDelete(id: string) {
  deletingId.value = id;
  try { await mcp.deleteServer(id); if (expandedServer.value === id) expandedServer.value = null; }
  finally { deletingId.value = null; }
}
function toggleExpand(id: string) { expandedServer.value = expandedServer.value === id ? null : id; }
function statusColor(status: string): string {
  switch (status) { case 'connected': return 'bg-green-500'; case 'error': return 'bg-red-500'; case 'testing': return 'bg-yellow-500 animate-pulse'; default: return 'bg-gray-400'; }
}
function statusLabel(status: string): string {
  switch (status) { case 'connected': return 'Connected'; case 'error': return 'Error'; case 'testing': return 'Testing...'; case 'disabled': return 'Disabled'; default: return 'Unknown'; }
}
function statusBadgeVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) { case 'connected': return 'default'; case 'error': return 'destructive'; default: return 'secondary'; }
}

// ─── Lifecycle ────────────────────────────────────────────────────────────

watch(open, async (isOpen) => {
  if (isOpen) {
    loadGitConfig();
    mcp.fetchServers();
    cancelForm();
  }
});
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="max-h-[85vh] w-[95vw] !max-w-6xl overflow-hidden p-0 sm:w-[90vw]">
      <div class="flex h-[80vh] max-h-[75vh] flex-col sm:flex-row">
        <!-- Sidebar — horizontal on mobile, vertical on sm+ -->
        <nav class="flex shrink-0 border-b border-border bg-muted/30 sm:w-48 sm:flex-col sm:border-b-0 sm:border-r">
          <div class="hidden px-4 py-4 sm:block">
            <h2 class="text-sm font-semibold">Settings</h2>
            <p class="text-[11px] text-muted-foreground">Configure Viridian</p>
          </div>
          <div class="flex gap-0.5 overflow-x-auto px-2 py-1.5 sm:flex-1 sm:flex-col sm:overflow-x-visible sm:py-0">
            <button
              v-for="s in SECTIONS"
              :key="s.id"
              class="flex shrink-0 items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13px] transition-colors sm:w-full sm:gap-2.5"
              :class="section === s.id
                ? 'bg-accent text-foreground font-medium'
                : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'"
              @click="section = s.id"
            >
              <component :is="s.icon" class="h-4 w-4 shrink-0" />
              <span class="hidden sm:inline">{{ s.label }}</span>
            </button>
          </div>
        </nav>

        <!-- Content -->
        <ScrollArea class="min-h-0 flex-1">
          <div class="mx-auto max-w-2xl p-5 sm:p-6">
            <!-- AI Providers -->
            <div v-if="section === 'providers'">
              <ProviderSelector />
            </div>

            <!-- Speech-to-Text -->
            <div v-else-if="section === 'speech'">
              <AudioProviderSettings />
            </div>

            <!-- Assistants (Personas) -->
            <div v-else-if="section === 'assistants'">
              <PersonaSettings />
            </div>

            <!-- Tools & Permissions -->
            <div v-else-if="section === 'tools'" class="space-y-5">
              <!-- Permission toggle -->
              <div>
                <h4 class="mb-3 text-xs font-medium uppercase text-muted-foreground">Permission Settings</h4>
                <div class="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                  <div class="flex items-center justify-between gap-3">
                    <div>
                      <p class="text-sm font-medium text-foreground">Skip permission prompts</p>
                      <p class="text-xs text-amber-600 dark:text-amber-400">Equivalent to --dangerously-skip-permissions</p>
                    </div>
                    <Switch
                      :checked="settingsStore.permissionMode === 'bypassPermissions'"
                      @update:checked="toggleSkipPermissions"
                    />
                  </div>
                </div>
              </div>

              <Separator />

              <!-- Allowed Tools -->
              <div>
                <h4 class="mb-2 flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
                  <Shield class="h-3.5 w-3.5 text-primary" />
                  Allowed Tools
                </h4>
                <p class="mb-3 text-xs text-muted-foreground">Tools that are automatically allowed without prompting</p>
                <div class="mb-3 flex gap-2">
                  <Input v-model="newAllowedTool" placeholder='e.g. "Bash(git log:*)"' class="text-sm" @keydown.enter="addAllowed" />
                  <Button size="sm" class="shrink-0 gap-1" :disabled="!newAllowedTool.trim()" @click="addAllowed">
                    <Plus class="h-3.5 w-3.5" />
                  </Button>
                </div>
                <div class="mb-3">
                  <p class="mb-2 text-xs font-medium text-muted-foreground">Quick add:</p>
                  <div class="flex flex-wrap gap-1.5">
                    <button
                      v-for="tool in COMMON_TOOLS" :key="tool"
                      class="rounded-md border border-border px-2 py-1 text-xs text-foreground transition-colors hover:bg-accent"
                      :class="{ 'opacity-40 pointer-events-none': settingsStore.allowedTools.includes(tool) }"
                      @click="settingsStore.addAllowedTool(tool)"
                    >{{ tool }}</button>
                  </div>
                </div>
                <div v-if="settingsStore.allowedTools.length > 0" class="space-y-1.5">
                  <div v-for="tool in settingsStore.allowedTools" :key="tool" class="flex items-center justify-between rounded-md bg-primary/5 px-3 py-1.5">
                    <span class="text-sm text-foreground">{{ tool }}</span>
                    <button class="text-muted-foreground transition-colors hover:text-destructive" @click="settingsStore.removeAllowedTool(tool)">
                      <X class="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                <p v-else class="py-2 text-center text-xs text-muted-foreground">No allowed tools configured</p>
              </div>

              <Separator />

              <!-- Disallowed Tools -->
              <div>
                <h4 class="mb-2 flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
                  <AlertTriangle class="h-3.5 w-3.5 text-destructive" />
                  Disallowed Tools
                </h4>
                <p class="mb-3 text-xs text-muted-foreground">Tools that are never allowed, even in auto-approve mode</p>
                <div class="mb-3 flex gap-2">
                  <Input v-model="newDisallowedTool" placeholder='e.g. "Bash(rm -rf:*)"' class="text-sm" @keydown.enter="addDisallowed" />
                  <Button size="sm" variant="destructive" class="shrink-0 gap-1" :disabled="!newDisallowedTool.trim()" @click="addDisallowed">
                    <Plus class="h-3.5 w-3.5" />
                  </Button>
                </div>
                <div class="mb-3">
                  <p class="mb-2 text-xs font-medium text-muted-foreground">Quick add:</p>
                  <div class="flex flex-wrap gap-1.5">
                    <button
                      v-for="tool in COMMON_DISALLOWED" :key="tool"
                      class="rounded-md border border-destructive/30 px-2 py-1 text-xs text-destructive transition-colors hover:bg-destructive/10"
                      :class="{ 'opacity-40 pointer-events-none': settingsStore.disallowedTools.includes(tool) }"
                      @click="settingsStore.addDisallowedTool(tool)"
                    >{{ tool }}</button>
                  </div>
                </div>
                <div v-if="settingsStore.disallowedTools.length > 0" class="space-y-1.5">
                  <div v-for="tool in settingsStore.disallowedTools" :key="tool" class="flex items-center justify-between rounded-md bg-destructive/5 px-3 py-1.5">
                    <span class="text-sm text-foreground">{{ tool }}</span>
                    <button class="text-muted-foreground transition-colors hover:text-foreground" @click="settingsStore.removeDisallowedTool(tool)">
                      <X class="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                <p v-else class="py-2 text-center text-xs text-muted-foreground">No disallowed tools configured</p>
              </div>

              <Separator />

              <div>
                <h4 class="mb-2 text-xs font-medium uppercase text-muted-foreground">Pattern Syntax</h4>
                <div class="space-y-1 rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                  <p><code class="rounded bg-muted px-1 text-foreground">Read</code> — allow/block an entire tool</p>
                  <p><code class="rounded bg-muted px-1 text-foreground">Bash(git:*)</code> — Bash only for commands starting with "git"</p>
                  <p><code class="rounded bg-muted px-1 text-foreground">Bash(npm test:*)</code> — Bash for "npm test" commands</p>
                </div>
              </div>
            </div>

            <!-- MCP Servers -->
            <div v-else-if="section === 'mcp'" class="space-y-4">
              <div>
                <h4 class="mb-1 text-xs font-medium uppercase text-muted-foreground">MCP Servers</h4>
                <p class="text-xs text-muted-foreground">Manage Model Context Protocol servers. Enabled servers are available across all agents and sessions.</p>
              </div>

              <div v-if="mcp.loading" class="flex items-center justify-center py-8">
                <Loader2 class="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
              <p v-if="mcp.error" class="text-xs text-destructive">{{ mcp.error }}</p>

              <template v-if="!mcp.loading">
                <div v-if="mcp.servers.length === 0 && !showAddForm" class="py-6 text-center">
                  <Server class="mx-auto mb-2 h-8 w-8 text-muted-foreground/50" />
                  <p class="text-sm text-muted-foreground">No MCP servers configured</p>
                  <p class="mt-1 text-xs text-muted-foreground/70">Add a server to provide tools to your agents</p>
                </div>

                <div v-if="mcp.servers.length > 0" class="space-y-2">
                  <div
                    v-for="server in mcp.servers" :key="server.id"
                    class="rounded-lg border border-border transition-colors"
                    :class="{ 'opacity-50': !server.enabled }"
                  >
                    <div class="flex items-center gap-2 px-3 py-2.5">
                      <button class="shrink-0 text-muted-foreground" @click="toggleExpand(server.id)">
                        <ChevronDown v-if="expandedServer === server.id" class="h-4 w-4" />
                        <ChevronRight v-else class="h-4 w-4" />
                      </button>
                      <span class="h-2 w-2 shrink-0 rounded-full" :class="statusColor(server.status)" :title="statusLabel(server.status)" />
                      <component :is="server.serverType === 'stdio' ? Terminal : Globe" class="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div class="min-w-0 flex-1">
                        <div class="text-sm font-medium text-foreground">{{ server.name }}</div>
                        <div class="truncate text-xs text-muted-foreground">{{ server.serverType === 'stdio' ? server.command : server.url }}</div>
                      </div>
                      <span class="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">{{ server.serverType }}</span>
                      <Switch :checked="server.enabled" @update:checked="mcp.toggleServer(server.id)" class="scale-75" />
                      <Button variant="ghost" size="sm" class="h-7 w-7 p-0 text-muted-foreground hover:text-foreground" @click="startEdit(server)" title="Edit">
                        <Pencil class="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="sm" class="h-7 w-7 p-0 text-destructive hover:bg-destructive/10" :disabled="deletingId === server.id" @click="handleDelete(server.id)" title="Delete">
                        <Loader2 v-if="deletingId === server.id" class="h-3.5 w-3.5 animate-spin" />
                        <Trash2 v-else class="h-3.5 w-3.5" />
                      </Button>
                    </div>

                    <div v-if="expandedServer === server.id" class="border-t border-border bg-muted/30 px-3 py-3 text-xs">
                      <div class="mb-3 flex items-center gap-2">
                        <Badge :variant="statusBadgeVariant(server.status)" class="text-[10px]">{{ statusLabel(server.status) }}</Badge>
                        <Button variant="outline" size="sm" class="h-6 gap-1 px-2 text-[11px]" :disabled="!server.enabled || server.status === 'testing'" @click="mcp.testServer(server.id)">
                          <Loader2 v-if="server.status === 'testing'" class="h-3 w-3 animate-spin" />
                          <Zap v-else class="h-3 w-3" />
                          Test Connection
                        </Button>
                      </div>
                      <div v-if="server.error" class="mb-3 rounded-md bg-destructive/10 px-2 py-1.5 text-destructive">{{ server.error }}</div>
                      <template v-if="server.serverType === 'stdio'">
                        <div class="space-y-1">
                          <div><span class="text-muted-foreground">Command:</span> <code class="rounded bg-muted px-1">{{ server.command }}</code></div>
                          <div v-if="server.args.length > 0"><span class="text-muted-foreground">Args:</span> <code class="rounded bg-muted px-1">{{ server.args.join(' ') }}</code></div>
                          <div v-if="Object.keys(server.env).length > 0">
                            <span class="text-muted-foreground">Env:</span>
                            <div v-for="(v, k) in server.env" :key="k" class="ml-3"><code class="rounded bg-muted px-1">{{ k }}={{ v }}</code></div>
                          </div>
                        </div>
                      </template>
                      <template v-else>
                        <div class="space-y-1">
                          <div><span class="text-muted-foreground">URL:</span> <code class="rounded bg-muted px-1">{{ server.url }}</code></div>
                          <div v-if="Object.keys(server.headers).length > 0">
                            <span class="text-muted-foreground">Headers:</span>
                            <div v-for="(v, k) in server.headers" :key="k" class="ml-3"><code class="rounded bg-muted px-1">{{ k }}: {{ v }}</code></div>
                          </div>
                        </div>
                      </template>
                      <div v-if="server.tools.length > 0" class="mt-3">
                        <div class="mb-1.5 flex items-center gap-1 text-muted-foreground">
                          <Wrench class="h-3 w-3" />
                          <span class="font-medium">Available Tools ({{ server.tools.length }})</span>
                        </div>
                        <div class="flex flex-wrap gap-1">
                          <Badge v-for="tool in server.tools" :key="tool.name" variant="outline" class="text-[10px]" :title="tool.description || tool.name">{{ tool.name }}</Badge>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <Separator />

                <div>
                  <Button v-if="!showAddForm" variant="outline" size="sm" class="w-full gap-1" @click="showAddForm = true; editingId = null; mcpForm = emptyForm();">
                    <Plus class="h-3.5 w-3.5" />
                    Add Server
                  </Button>
                  <div v-else class="space-y-3 rounded-lg border border-primary/30 bg-card p-3">
                    <div class="flex items-center justify-between">
                      <h4 class="text-sm font-medium">{{ editingId ? 'Edit MCP Server' : 'Add MCP Server' }}</h4>
                      <Button variant="ghost" size="sm" class="h-6 w-6 p-0" @click="cancelForm"><X class="h-3.5 w-3.5" /></Button>
                    </div>
                    <div class="space-y-1.5">
                      <Label class="text-xs">Name</Label>
                      <Input v-model="mcpForm.name" placeholder="my-mcp-server" class="h-8 font-mono text-sm" />
                    </div>
                    <div class="space-y-1.5">
                      <Label class="text-xs">Type</Label>
                      <Select :model-value="mcpForm.serverType" @update:model-value="(v: any) => mcpForm.serverType = v">
                        <SelectTrigger class="h-8"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="stdio">Stdio (local process)</SelectItem>
                          <SelectItem value="sse">SSE (Server-Sent Events)</SelectItem>
                          <SelectItem value="http">HTTP (Streamable HTTP)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <template v-if="mcpForm.serverType === 'stdio'">
                      <div class="space-y-1.5">
                        <Label class="text-xs">Command</Label>
                        <Input v-model="mcpForm.command" placeholder="npx" class="h-8 font-mono text-sm" />
                      </div>
                      <div class="space-y-1.5">
                        <Label class="text-xs">Arguments (space-separated)</Label>
                        <Input v-model="mcpForm.args" placeholder="-y @modelcontextprotocol/server-filesystem /home" class="h-8 font-mono text-sm" />
                      </div>
                      <div class="space-y-1.5">
                        <Label class="text-xs">Environment variables</Label>
                        <div v-for="(pair, idx) in mcpForm.envPairs" :key="idx" class="flex gap-1">
                          <Input v-model="pair.key" placeholder="KEY" class="h-7 w-1/3 font-mono text-xs" />
                          <Input v-model="pair.value" placeholder="value" class="h-7 flex-1 font-mono text-xs" />
                          <Button v-if="idx === mcpForm.envPairs.length - 1" variant="ghost" size="sm" class="h-7 w-7 p-0" @click="mcpForm.envPairs.push({ key: '', value: '' })">
                            <Plus class="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    </template>
                    <template v-else>
                      <div class="space-y-1.5">
                        <Label class="text-xs">URL</Label>
                        <Input v-model="mcpForm.url" placeholder="http://localhost:3000/mcp" class="h-8 font-mono text-sm" />
                      </div>
                      <div class="space-y-1.5">
                        <Label class="text-xs">Headers</Label>
                        <div v-for="(pair, idx) in mcpForm.headerPairs" :key="idx" class="flex gap-1">
                          <Input v-model="pair.key" placeholder="Header" class="h-7 w-1/3 font-mono text-xs" />
                          <Input v-model="pair.value" placeholder="value" class="h-7 flex-1 font-mono text-xs" />
                          <Button v-if="idx === mcpForm.headerPairs.length - 1" variant="ghost" size="sm" class="h-7 w-7 p-0" @click="mcpForm.headerPairs.push({ key: '', value: '' })">
                            <Plus class="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    </template>
                    <Button size="sm" class="w-full gap-1" :disabled="mcpSubmitting || !mcpFormIsValid()" @click="mcpSubmitForm">
                      <Loader2 v-if="mcpSubmitting" class="h-3.5 w-3.5 animate-spin" />
                      <template v-else>
                        <Pencil v-if="editingId" class="h-3.5 w-3.5" />
                        <Plus v-else class="h-3.5 w-3.5" />
                      </template>
                      {{ mcpSubmitting ? 'Saving...' : (editingId ? 'Update Server' : 'Add Server') }}
                    </Button>
                  </div>
                </div>
              </template>
            </div>

            <!-- Git Identity -->
            <div v-else-if="section === 'git'">
              <h4 class="mb-3 text-xs font-medium uppercase text-muted-foreground">Git Identity</h4>
              <div v-if="!chat.projectPath" class="text-xs text-muted-foreground">
                Open a project to configure git identity
              </div>
              <div v-else class="space-y-3">
                <div class="space-y-1.5">
                  <Label class="text-xs">Name</Label>
                  <Input v-model="gitName" placeholder="Your Name" class="h-8 text-sm" :disabled="gitConfigLoading" @blur="saveGitConfig" />
                </div>
                <div class="space-y-1.5">
                  <Label class="text-xs">Email</Label>
                  <Input v-model="gitEmail" placeholder="your@email.com" class="h-8 text-sm" :disabled="gitConfigLoading" @blur="saveGitConfig" />
                </div>
                <p v-if="gitConfigSaved" class="text-xs text-green-500">Git identity saved.</p>
              </div>
            </div>
          </div>
        </ScrollArea>
      </div>
    </DialogContent>
  </Dialog>
</template>
