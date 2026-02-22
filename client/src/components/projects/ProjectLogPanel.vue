<script setup lang="ts">
import { computed, watch, nextTick, ref } from 'vue';
import { useProjectsStore } from '@/stores/projects';
import { X, Trash2 } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';

const store = useProjectsStore();
const scrollRef = ref<HTMLElement | null>(null);

const selectedService = computed(() => {
  if (!store.selectedServiceId) return null;
  for (const p of store.projects) {
    const s = p.services.find(s => s.id === store.selectedServiceId);
    if (s) return { project: p, service: s };
  }
  return null;
});

const logs = computed(() => store.selectedServiceLogs);

// Auto-scroll to bottom when new lines arrive
watch(logs, async () => {
  await nextTick();
  if (scrollRef.value) {
    scrollRef.value.scrollTop = scrollRef.value.scrollHeight;
  }
});

function close() {
  store.selectService(null);
}

function clearLogs() {
  if (store.selectedServiceId) store.clearLogs(store.selectedServiceId);
}

const statusColor = computed(() => {
  const status = selectedService.value?.service.status;
  if (status === 'running') return 'text-green-400';
  if (status === 'starting') return 'text-yellow-400';
  if (status === 'error') return 'text-red-400';
  return 'text-muted-foreground';
});
</script>

<template>
  <div
    v-if="store.selectedServiceId && selectedService"
    class="flex h-full flex-col border-t bg-background"
  >
    <!-- Log panel header -->
    <div class="flex items-center gap-2 border-b px-3 py-1.5 bg-muted/20 shrink-0">
      <span class="text-xs font-medium text-foreground truncate">
        {{ selectedService.project.name }}
        <span class="text-muted-foreground"> / </span>
        <span class="capitalize">{{ selectedService.service.name }}</span>
      </span>
      <span class="text-[10px] font-mono" :class="statusColor">
        {{ selectedService.service.status }}
      </span>
      <div class="ml-auto flex items-center gap-1">
        <Button variant="ghost" size="sm" class="h-6 w-6 p-0 text-muted-foreground hover:text-foreground" @click="clearLogs">
          <Trash2 class="h-3 w-3" />
        </Button>
        <Button variant="ghost" size="sm" class="h-6 w-6 p-0 text-muted-foreground hover:text-foreground" @click="close">
          <X class="h-3 w-3" />
        </Button>
      </div>
    </div>

    <!-- Log output -->
    <div
      ref="scrollRef"
      class="flex-1 overflow-y-auto px-3 py-2 font-mono text-[11px] leading-5 text-green-400/90"
      style="background: oklch(0.12 0.01 250);"
    >
      <div v-if="logs.length === 0" class="text-muted-foreground text-xs italic">
        No output yet. Start the service to see logs here.
      </div>
      <div
        v-for="(line, i) in logs"
        :key="i"
        class="whitespace-pre-wrap break-all"
        :class="line.includes('error') || line.includes('Error') || line.includes('ERROR') ? 'text-red-400' : ''"
      >{{ line }}</div>
    </div>
  </div>
</template>
