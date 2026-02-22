<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { useManagementStore } from '@/stores/management';
import { Square, RefreshCw, Activity } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import WidgetShell from './WidgetShell.vue';
import type { WidgetConfig } from '@/stores/management';

defineProps<{ widget: WidgetConfig }>();

const store = useManagementStore();
const ticker = ref<ReturnType<typeof setInterval> | null>(null);
const now = ref(Date.now());

function formatUptime(ms: number) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

onMounted(() => {
  store.fetchProcesses();
  // Refresh process list every 5s, uptime every 1s
  ticker.value = setInterval(() => {
    now.value = Date.now();
    store.fetchProcesses();
  }, 5000);
});

onUnmounted(() => {
  if (ticker.value) clearInterval(ticker.value);
});
</script>

<template>
  <WidgetShell :widget="widget" title="Processes">
    <template #icon><Activity class="h-3.5 w-3.5 text-chart-2" /></template>
    <template #actions>
      <Button size="sm" variant="ghost" class="h-6 w-6 p-0 text-muted-foreground" @click="store.fetchProcesses">
        <RefreshCw class="h-3 w-3" />
      </Button>
    </template>

    <div class="p-2">
      <div v-if="store.processes.length === 0" class="p-6 text-center">
        <Activity class="h-6 w-6 text-muted-foreground/30 mx-auto mb-2" />
        <p class="text-xs text-muted-foreground">No running processes</p>
      </div>

      <table v-else class="w-full text-xs">
        <thead>
          <tr class="border-b border-border/40">
            <th class="text-left font-medium text-muted-foreground pb-1.5 px-2">Name</th>
            <th class="text-left font-medium text-muted-foreground pb-1.5 px-2 hidden sm:table-cell">Command</th>
            <th class="text-right font-medium text-muted-foreground pb-1.5 px-2">PID</th>
            <th class="text-right font-medium text-muted-foreground pb-1.5 px-2">Uptime</th>
            <th class="pb-1.5 px-1" />
          </tr>
        </thead>
        <tbody class="divide-y divide-border/30">
          <tr v-for="proc in store.processes" :key="proc.serviceId" class="group hover:bg-muted/10">
            <td class="py-1.5 px-2">
              <div class="flex items-center gap-1.5">
                <span class="relative flex h-1.5 w-1.5 shrink-0">
                  <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-500 opacity-75" />
                  <span class="relative inline-flex h-1.5 w-1.5 rounded-full bg-green-500" />
                </span>
                <span class="font-medium capitalize truncate max-w-[80px]">{{ proc.name }}</span>
              </div>
            </td>
            <td class="py-1.5 px-2 hidden sm:table-cell">
              <span class="font-mono text-[10px] text-muted-foreground truncate block max-w-[140px]">{{ proc.command }}</span>
            </td>
            <td class="py-1.5 px-2 text-right font-mono text-[10px] text-muted-foreground">{{ proc.pid }}</td>
            <td class="py-1.5 px-2 text-right font-mono text-[10px] text-green-500">
              {{ formatUptime(now - (Date.now() - proc.uptimeMs)) }}
            </td>
            <td class="py-1.5 px-1">
              <Button
                size="sm" variant="ghost"
                class="h-5 w-5 p-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                @click="store.stopService(proc.serviceId)"
              >
                <Square class="h-2.5 w-2.5" />
              </Button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </WidgetShell>
</template>
