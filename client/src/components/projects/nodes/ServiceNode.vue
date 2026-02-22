<script setup lang="ts">
import { computed } from 'vue';
import type { NodeProps } from '@vue-flow/core';
import type { ProjectService } from '@/types/projects';
import { useProjectsStore } from '@/stores/projects';
import { Play, Square, Loader2, Terminal } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';

const props = defineProps<NodeProps>();
const store = useProjectsStore();

const service = computed(() => props.data.service as ProjectService);
const projectId = computed(() => props.data.projectId as string);

const statusColor = computed(() => {
  switch (service.value.status) {
    case 'running': return 'text-green-500';
    case 'starting': return 'text-yellow-500';
    case 'error': return 'text-red-500';
    default: return 'text-muted-foreground';
  }
});

const statusLabel = computed(() => {
  switch (service.value.status) {
    case 'running': return 'Running';
    case 'starting': return 'Starting…';
    case 'error': return 'Error';
    default: return 'Stopped';
  }
});

function toggle() {
  if (service.value.status === 'running' || service.value.status === 'starting') {
    store.stopService(projectId.value, service.value.id);
  } else {
    store.startService(projectId.value, service.value.id);
    store.selectService(service.value.id);
  }
}

function openLogs() {
  store.selectService(service.value.id);
}
</script>

<template>
  <div
    class="service-node min-w-[180px] max-w-[240px] rounded-lg border bg-card text-card-foreground shadow-sm cursor-pointer"
    :class="[
      service.status === 'running' ? 'border-green-500/40 ring-1 ring-green-500/20 running-pulse' : 'border-border',
      service.status === 'error' ? 'border-red-500/40' : '',
    ]"
    @click.stop="openLogs"
  >
    <!-- Header -->
    <div
      class="flex items-center gap-2 rounded-t-lg border-b px-3 py-1.5"
      :class="service.status === 'running' ? 'bg-green-500/8' : 'bg-muted/30'"
    >
      <Terminal class="h-3.5 w-3.5 shrink-0" :class="statusColor" />
      <span class="flex-1 truncate text-xs font-semibold capitalize">{{ service.name }}</span>
      <!-- Status dot -->
      <span class="flex items-center gap-1 text-[10px]" :class="statusColor">
        <Loader2 v-if="service.status === 'starting'" class="h-2.5 w-2.5 animate-spin" />
        <span v-else class="h-1.5 w-1.5 rounded-full" :class="{
          'bg-green-500': service.status === 'running',
          'bg-red-500': service.status === 'error',
          'bg-muted-foreground': service.status === 'stopped',
        }" />
        {{ statusLabel }}
      </span>
    </div>

    <!-- Body -->
    <div class="px-3 py-2 text-xs space-y-1.5">
      <div class="font-mono text-[10px] text-muted-foreground truncate" :title="service.command">
        $ {{ service.command }}
      </div>
      <Button
        size="sm"
        :variant="service.status === 'running' || service.status === 'starting' ? 'destructive' : 'default'"
        class="h-5 w-full px-2 text-[10px] gap-1"
        @click.stop="toggle"
      >
        <Loader2 v-if="service.status === 'starting'" class="h-2.5 w-2.5 animate-spin" />
        <Play v-else-if="service.status !== 'running'" class="h-2.5 w-2.5" />
        <Square v-else class="h-2.5 w-2.5" />
        {{ service.status === 'running' ? 'Stop' : service.status === 'starting' ? 'Starting…' : 'Start' }}
      </Button>
    </div>
  </div>
</template>

<style scoped>
.service-node {
  transition: box-shadow 0.2s ease, border-color 0.2s ease;
}
.running-pulse {
  animation: service-glow 3s ease-in-out infinite;
}
@keyframes service-glow {
  0%, 100% { box-shadow: 0 0 0 0 oklch(from var(--primary) l c h / 0%); }
  50% { box-shadow: 0 0 8px 1px oklch(0.7 0.2 140 / 15%); }
}
</style>
