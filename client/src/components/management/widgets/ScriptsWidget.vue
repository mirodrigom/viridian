<script setup lang="ts">
import { ref } from 'vue';
import { useManagementStore } from '@/stores/management';
import { apiFetch } from '@/lib/apiFetch';
import { toast } from 'vue-sonner';
import { Play, Plus, Trash2, Loader2, CheckCircle, XCircle, ScrollText } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import WidgetShell from './WidgetShell.vue';
import type { WidgetConfig } from '@/stores/management';

defineProps<{ widget: WidgetConfig }>();

const store = useManagementStore();

// Add form
const showAdd = ref(false);
const newName = ref('');
const newCmd = ref('');
const newCwd = ref('');
const adding = ref(false);

async function addScript() {
  if (!newName.value.trim() || !newCmd.value.trim()) return;
  adding.value = true;
  try {
    await store.addScript(newName.value.trim(), newCmd.value.trim(), newCwd.value.trim());
    newName.value = ''; newCmd.value = ''; newCwd.value = '';
    showAdd.value = false;
  } catch { toast.error('Failed to add script'); }
  finally { adding.value = false; }
}

// Script runner — per-script state
interface RunState { running: boolean; exitCode: number | null; output: string[] }
const runStates = ref<Map<string, RunState>>(new Map());

function getRunState(id: string): RunState {
  if (!runStates.value.has(id)) runStates.value.set(id, { running: false, exitCode: null, output: [] });
  return runStates.value.get(id)!;
}

async function runScript(id: string) {
  const state = getRunState(id);
  if (state.running) return;
  state.running = true;
  state.exitCode = null;
  state.output = [];

  try {
    const res = await apiFetch(`/api/management/scripts/${id}/run`, { method: 'POST' });
    if (!res.ok) throw new Error('Failed to start script');
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n\n');
      buffer = lines.pop() ?? '';
      for (const chunk of lines) {
        const eventLine = chunk.match(/^event: (\w+)/m)?.[1];
        const dataLine = chunk.match(/^data: (.+)/m)?.[1];
        if (!dataLine) continue;
        try {
          const d = JSON.parse(dataLine);
          if (eventLine === 'output') state.output.push(d.data);
          if (eventLine === 'done') state.exitCode = d.exitCode ?? 0;
          if (eventLine === 'error') { state.output.push(`Error: ${d.error}`); state.exitCode = 1; }
        } catch { /* skip */ }
      }
    }
  } catch (err) {
    state.output.push(`Failed: ${err instanceof Error ? err.message : 'unknown'}`);
    state.exitCode = 1;
  } finally {
    state.running = false;
    runStates.value = new Map(runStates.value);
  }
}
</script>

<template>
  <WidgetShell :widget="widget" title="Scripts">
    <template #icon><ScrollText class="h-3.5 w-3.5 text-chart-5" /></template>
    <template #actions>
      <Button variant="ghost" size="sm" class="h-6 w-6 p-0 text-muted-foreground hover:text-primary" @click="showAdd = !showAdd">
        <Plus class="h-3 w-3" />
      </Button>
    </template>

    <div class="flex flex-col gap-0">
      <!-- Add form -->
      <div v-if="showAdd" class="p-3 space-y-2 bg-muted/10 border-b">
        <div class="flex gap-2">
          <Input v-model="newName" placeholder="Name" class="w-28 h-7 text-xs" @keydown.enter="addScript" />
          <Input v-model="newCmd" placeholder="pnpm build" class="flex-1 h-7 text-xs font-mono" @keydown.enter="addScript" />
        </div>
        <div class="flex gap-2">
          <Input v-model="newCwd" placeholder="/path/to/project  (optional)" class="flex-1 h-7 text-xs font-mono" @keydown.enter="addScript" />
          <Button size="sm" class="h-7 px-3 text-xs" :disabled="adding" @click="addScript">
            {{ adding ? '…' : 'Add' }}
          </Button>
        </div>
      </div>

      <!-- Script entries -->
      <div
        v-for="script in store.scripts"
        :key="script.id"
        class="border-b border-border/50 last:border-0"
      >
        <div class="flex items-center gap-2 px-3 py-2.5 hover:bg-muted/10">
          <div class="flex-1 min-w-0">
            <div class="text-xs font-medium truncate">{{ script.name }}</div>
            <div class="text-[10px] font-mono text-muted-foreground truncate">$ {{ script.command }}</div>
          </div>
          <div class="flex items-center gap-1 shrink-0">
            <!-- Status icon -->
            <CheckCircle v-if="getRunState(script.id).exitCode === 0" class="h-3.5 w-3.5 text-green-500" />
            <XCircle v-else-if="getRunState(script.id).exitCode !== null" class="h-3.5 w-3.5 text-red-500" />

            <Button size="sm" variant="outline" class="h-6 px-2 text-[10px] gap-1"
              :disabled="getRunState(script.id).running"
              @click="runScript(script.id)">
              <Loader2 v-if="getRunState(script.id).running" class="h-2.5 w-2.5 animate-spin" />
              <Play v-else class="h-2.5 w-2.5" />
              {{ getRunState(script.id).running ? 'Running…' : 'Run' }}
            </Button>
            <Button size="sm" variant="ghost" class="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
              @click="store.removeScript(script.id)">
              <Trash2 class="h-3 w-3" />
            </Button>
          </div>
        </div>

        <!-- Output panel -->
        <div v-if="getRunState(script.id).output.length > 0"
          class="mx-3 mb-2 rounded-md overflow-hidden border border-border/40"
          style="background: oklch(0.13 0.01 250);"
        >
          <div class="max-h-32 overflow-y-auto p-2 font-mono text-[10px] leading-4"
            style="color: oklch(0.75 0.15 140);">
            <div v-for="(line, i) in getRunState(script.id).output" :key="i"
              class="whitespace-pre-wrap break-all"
              :class="line.match(/error|Error|ERROR/i) ? 'text-red-400' : ''">{{ line }}</div>
          </div>
          <div class="px-2 py-1 border-t border-border/30 text-[9px] font-mono"
            :class="getRunState(script.id).exitCode === 0 ? 'text-green-500' : 'text-red-400'">
            {{ getRunState(script.id).running ? 'running…' : `exit ${getRunState(script.id).exitCode}` }}
          </div>
        </div>
      </div>

      <div v-if="store.scripts.length === 0 && !showAdd" class="p-6 text-center text-xs text-muted-foreground">
        No scripts yet. Click <Plus class="inline h-3 w-3" /> to add one.
      </div>
    </div>
  </WidgetShell>
</template>
