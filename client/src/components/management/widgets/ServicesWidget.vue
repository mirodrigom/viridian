<script setup lang="ts">
import { ref, computed } from 'vue';
import { useManagementStore } from '@/stores/management';
import { toast } from 'vue-sonner';
import { Play, Square, Loader2, Plus, Trash2, Terminal, ServerCog, Pencil, Check, X } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import WidgetShell from './WidgetShell.vue';
import type { WidgetConfig } from '@/stores/management';

defineProps<{ widget: WidgetConfig }>();

const store = useManagementStore();

// Selected service for log view
const selectedId = computed(() => store.selectedServiceId);
const logs = computed(() => store.selectedServiceLogs);
const logsEndRef = ref<HTMLElement | null>(null);

// Add-service form
const showAdd = ref(false);
const newName = ref('');
const newCmd = ref('');
const newCwd = ref('');
const adding = ref(false);

async function addService() {
  if (!newName.value.trim() || !newCmd.value.trim()) return;
  adding.value = true;
  try {
    await store.addService(newName.value.trim(), newCmd.value.trim(), newCwd.value.trim());
    newName.value = ''; newCmd.value = ''; newCwd.value = '';
    showAdd.value = false;
  } catch { toast.error('Failed to add service'); }
  finally { adding.value = false; }
}

// Edit service
const editingId = ref<string | null>(null);
const editName = ref('');
const editCmd = ref('');
const editCwd = ref('');

function startEdit(svc: { id: string; name: string; command: string; cwd: string }) {
  editingId.value = svc.id;
  editName.value = svc.name;
  editCmd.value = svc.command;
  editCwd.value = svc.cwd;
}

function cancelEdit() {
  editingId.value = null;
}

async function saveEdit() {
  if (!editingId.value || !editName.value.trim() || !editCmd.value.trim()) return;
  try {
    await store.updateService(editingId.value, {
      name: editName.value.trim(),
      command: editCmd.value.trim(),
      cwd: editCwd.value.trim(),
    });
    editingId.value = null;
  } catch { toast.error('Failed to update service'); }
}

async function toggleService(id: string, status: string) {
  if (status === 'running' || status === 'starting') {
    await store.stopService(id);
  } else {
    await store.startService(id);
  }
}

function formatUptime(startedAt?: number) {
  if (!startedAt) return '';
  const ms = Date.now() - startedAt;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}
</script>

<template>
  <WidgetShell :widget="widget" title="Services">
    <template #icon><ServerCog class="h-3.5 w-3.5 text-primary" /></template>
    <template #actions>
      <Button data-testid="services-add-btn" variant="ghost" size="sm" class="h-6 w-6 p-0 text-muted-foreground hover:text-primary" @click="showAdd = !showAdd">
        <Plus class="h-3 w-3" />
      </Button>
    </template>

    <div class="flex h-full flex-col overflow-hidden">
      <!-- Service list -->
      <div class="divide-y divide-border/50 shrink-0 overflow-y-auto max-h-[50%]">
        <!-- Add form -->
        <div v-if="showAdd" data-testid="services-add-form" class="p-3 space-y-2 bg-muted/10">
          <div class="flex gap-2">
            <Input v-model="newName" placeholder="Name" class="w-28 h-7 text-xs" @keydown.enter="addService" />
            <Input v-model="newCmd" placeholder="pnpm dev" class="flex-1 h-7 text-xs font-mono" @keydown.enter="addService" />
          </div>
          <div class="flex gap-2">
            <Input v-model="newCwd" placeholder="/path/to/project  (optional)" class="flex-1 h-7 text-xs font-mono" @keydown.enter="addService" />
            <Button size="sm" class="h-7 px-3 text-xs" :disabled="adding" @click="addService">
              {{ adding ? '…' : 'Add' }}
            </Button>
          </div>
        </div>

        <div
          v-for="svc in store.services"
          :key="svc.id"
        >
          <!-- Inline edit mode -->
          <div v-if="editingId === svc.id" class="p-3 space-y-2 bg-muted/10" @click.stop>
            <div class="flex gap-2">
              <Input v-model="editName" placeholder="Name" class="w-28 h-7 text-xs" @keydown.enter="saveEdit" @keydown.escape="cancelEdit" />
              <Input v-model="editCmd" placeholder="Command" class="flex-1 h-7 text-xs font-mono" @keydown.enter="saveEdit" @keydown.escape="cancelEdit" />
            </div>
            <div class="flex gap-2">
              <Input v-model="editCwd" placeholder="/path/to/project  (optional)" class="flex-1 h-7 text-xs font-mono" @keydown.enter="saveEdit" @keydown.escape="cancelEdit" />
              <Button size="sm" class="h-7 w-7 p-0" @click="saveEdit"><Check class="h-3 w-3" /></Button>
              <Button size="sm" variant="ghost" class="h-7 w-7 p-0" @click="cancelEdit"><X class="h-3 w-3" /></Button>
            </div>
          </div>

          <!-- Normal display mode -->
          <div
            v-else
            class="flex items-center gap-2.5 px-3 py-2.5 hover:bg-muted/20 cursor-pointer transition-colors"
            :class="selectedId === svc.id ? 'bg-muted/30' : ''"
            @click="store.selectService(selectedId === svc.id ? null : svc.id)"
          >
            <!-- Status indicator -->
            <span class="relative flex h-2 w-2 shrink-0">
              <span
                v-if="svc.status === 'running'"
                class="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-500 opacity-75"
              />
              <span
                class="relative inline-flex h-2 w-2 rounded-full"
                :class="{
                  'bg-green-500': svc.status === 'running',
                  'bg-yellow-500': svc.status === 'starting',
                  'bg-red-500': svc.status === 'error',
                  'bg-muted-foreground/40': svc.status === 'stopped',
                }"
              />
            </span>

            <Terminal class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />

            <div class="flex-1 min-w-0">
              <div class="flex items-baseline gap-2">
                <span class="text-xs font-medium capitalize truncate">{{ svc.name }}</span>
                <span v-if="svc.status === 'running' && svc.startedAt" class="text-[10px] text-muted-foreground shrink-0">
                  {{ formatUptime(svc.startedAt) }}
                </span>
              </div>
              <span class="text-[10px] font-mono text-muted-foreground truncate block">{{ svc.command }}</span>
            </div>

            <div class="flex items-center gap-1 shrink-0">
              <Button
                size="sm" variant="ghost"
                class="h-6 w-6 p-0 text-muted-foreground hover:text-primary"
                @click.stop="startEdit(svc)"
              >
                <Pencil class="h-3 w-3" />
              </Button>
              <Button
                size="sm"
                :variant="svc.status === 'running' || svc.status === 'starting' ? 'destructive' : 'default'"
                class="h-6 w-6 p-0"
                @click.stop="toggleService(svc.id, svc.status)"
              >
                <Loader2 v-if="svc.status === 'starting'" class="h-3 w-3 animate-spin" />
                <Square v-else-if="svc.status === 'running'" class="h-3 w-3" />
                <Play v-else class="h-3 w-3" />
              </Button>
              <Button
                size="sm" variant="ghost"
                class="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                @click.stop="store.removeService(svc.id)"
              >
                <Trash2 class="h-3 w-3" />
              </Button>
            </div>
          </div>
        </div>

        <div v-if="store.services.length === 0 && !showAdd" class="p-6 text-center text-xs text-muted-foreground">
          No services yet. Click <Plus class="inline h-3 w-3" /> to add one.
        </div>
      </div>

      <!-- Log output for selected service -->
      <div v-if="selectedId && logs.length > 0" class="flex-1 min-h-0 border-t flex flex-col overflow-hidden">
        <div class="flex items-center justify-between px-3 py-1 bg-muted/10 border-b shrink-0">
          <span class="text-[10px] font-mono text-muted-foreground">stdout / stderr ({{ logs.length }} lines)</span>
          <Button variant="ghost" size="sm" class="h-5 w-5 p-0 text-muted-foreground" @click="store.clearLogs(selectedId!)">
            <Trash2 class="h-2.5 w-2.5" />
          </Button>
        </div>
        <div
          class="flex-1 min-h-0 overflow-y-auto p-2 font-mono text-[10px] leading-4"
          style="background: oklch(0.13 0.01 250); color: oklch(0.75 0.15 140);"
        >
          <div v-for="(line, i) in logs" :key="i" class="whitespace-pre-wrap break-all"
            :class="line.match(/error|Error|ERROR|fail|FAIL/i) ? 'text-red-400' : ''">{{ line }}</div>
          <div ref="logsEndRef" />
        </div>
      </div>
    </div>
  </WidgetShell>
</template>
