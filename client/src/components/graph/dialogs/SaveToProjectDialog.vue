<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useGraphStore } from '@/stores/graph';
import { useChatStore } from '@/stores/chat';
import { apiFetch } from '@/lib/apiFetch';
import { toast } from 'vue-sonner';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, FolderOutput, Bot, Zap, Server, ShieldCheck, FileText } from 'lucide-vue-next';

interface FilePreview {
  path: string;
  exists: boolean;
}

const open = defineModel<boolean>('open', { default: false });

const graph = useGraphStore();
const chat = useChatStore();
const loading = ref(false);
const saving = ref(false);
const files = ref<FilePreview[]>([]);
const error = ref('');

const projectPath = computed(() => chat.projectPath || '');

const grouped = computed(() => {
  const groups: { agents: FilePreview[]; skills: FilePreview[]; mcps: FilePreview[]; rules: FilePreview[]; other: FilePreview[] } = {
    agents: [],
    skills: [],
    mcps: [],
    rules: [],
    other: [],
  };
  for (const f of files.value) {
    if (f.path.startsWith('.claude/agents/')) groups.agents.push(f);
    else if (f.path.startsWith('.claude/skills/')) groups.skills.push(f);
    else if (f.path === '.mcp.json') groups.mcps.push(f);
    else if (f.path === 'CLAUDE.md') groups.rules.push(f);
    else groups.other.push(f);
  }
  return groups;
});

const overwriteCount = computed(() => files.value.filter(f => f.exists).length);
const newCount = computed(() => files.value.filter(f => !f.exists).length);

async function fetchPreview() {
  if (!projectPath.value) return;
  loading.value = true;
  error.value = '';
  files.value = [];

  try {
    const serialized = graph.serialize();
    const res = await apiFetch('/api/graphs/save-to-project', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graphData: { nodes: serialized.nodes, edges: serialized.edges },
        name: graph.currentGraphName,
        projectPath: projectPath.value,
        preview: true,
      }),
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Preview failed');
    }

    const data = await res.json();
    files.value = data.files;
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to preview files';
  } finally {
    loading.value = false;
  }
}

async function onSave() {
  if (!projectPath.value) return;
  saving.value = true;

  try {
    const serialized = graph.serialize();
    const res = await apiFetch('/api/graphs/save-to-project', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graphData: { nodes: serialized.nodes, edges: serialized.edges },
        name: graph.currentGraphName,
        projectPath: projectPath.value,
      }),
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Save failed');
    }

    const data = await res.json();
    const total = (data.written?.length || 0) + (data.overwritten?.length || 0);
    toast.success(`Saved ${total} file${total !== 1 ? 's' : ''} to project`);
    open.value = false;
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Save failed');
  } finally {
    saving.value = false;
  }
}

watch(open, (v) => { if (v) fetchPreview(); });

const groupConfig: { key: 'agents' | 'skills' | 'mcps' | 'rules' | 'other'; label: string; icon: typeof Bot }[] = [
  { key: 'agents', label: 'Agents', icon: Bot },
  { key: 'skills', label: 'Skills', icon: Zap },
  { key: 'mcps', label: 'MCP Servers', icon: Server },
  { key: 'rules', label: 'Rules', icon: ShieldCheck },
  { key: 'other', label: 'Other', icon: FileText },
];
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2">
          <FolderOutput class="h-4 w-4 text-primary" />
          Save to Project
        </DialogTitle>
        <DialogDescription class="font-mono text-[11px] truncate">
          {{ projectPath || 'No project selected' }}
        </DialogDescription>
      </DialogHeader>

      <!-- No project path -->
      <div v-if="!projectPath" class="py-10 text-center text-sm text-muted-foreground">
        No project directory selected. Open a chat session with a project first.
      </div>

      <!-- Loading -->
      <div v-else-if="loading" class="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
        <Loader2 class="h-4 w-4 animate-spin" />
        Previewing files…
      </div>

      <!-- Error -->
      <div v-else-if="error" class="py-10 text-center text-sm text-destructive">
        {{ error }}
      </div>

      <!-- Empty -->
      <div v-else-if="files.length === 0" class="py-10 text-center text-sm text-muted-foreground">
        No files to write. Make sure your graph has at least one agent node.
      </div>

      <!-- File preview list -->
      <template v-else>
        <div class="flex items-center gap-2 text-xs text-muted-foreground">
          <span v-if="newCount > 0" class="flex items-center gap-1">
            <Badge variant="outline" class="border-emerald-500/50 bg-emerald-500/10 px-1.5 py-0 text-[10px] text-emerald-500">new</Badge>
            {{ newCount }} file{{ newCount !== 1 ? 's' : '' }}
          </span>
          <span v-if="overwriteCount > 0" class="flex items-center gap-1">
            <Badge variant="outline" class="border-amber-500/50 bg-amber-500/10 px-1.5 py-0 text-[10px] text-amber-500">overwrite</Badge>
            {{ overwriteCount }} file{{ overwriteCount !== 1 ? 's' : '' }}
          </span>
        </div>

        <ScrollArea class="max-h-[360px] w-full">
          <div class="space-y-3 pr-3">
            <template v-for="g in groupConfig" :key="g.key">
              <div v-if="(grouped[g.key] || []).length > 0">
                <span class="mb-1 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  <component :is="g.icon" class="h-3.5 w-3.5" /> {{ g.label }}
                </span>
                <div class="space-y-0.5">
                  <div
                    v-for="f in grouped[g.key]"
                    :key="f.path"
                    class="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm"
                  >
                    <code class="flex-1 truncate text-[11px]">{{ f.path }}</code>
                    <Badge
                      v-if="f.exists"
                      variant="outline"
                      class="flex-shrink-0 border-amber-500/50 bg-amber-500/10 px-1.5 py-0 text-[10px] text-amber-500"
                    >overwrite</Badge>
                    <Badge
                      v-else
                      variant="outline"
                      class="flex-shrink-0 border-emerald-500/50 bg-emerald-500/10 px-1.5 py-0 text-[10px] text-emerald-500"
                    >new</Badge>
                  </div>
                </div>
              </div>
            </template>
          </div>
        </ScrollArea>
      </template>

      <DialogFooter v-if="!loading && files.length > 0">
        <Button variant="outline" @click="open = false">Cancel</Button>
        <Button :disabled="saving" @click="onSave">
          <Loader2 v-if="saving" class="mr-1.5 h-3.5 w-3.5 animate-spin" />
          Save {{ files.length }} file{{ files.length !== 1 ? 's' : '' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
