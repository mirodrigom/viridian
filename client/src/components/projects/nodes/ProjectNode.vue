<script setup lang="ts">
import { computed } from 'vue';
import type { NodeProps } from '@vue-flow/core';
import type { Project } from '@/types/projects';
import { useProjectsStore } from '@/stores/projects';
import { FolderOpen, Play, Square } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

const props = defineProps<NodeProps>();
const store = useProjectsStore();

const project = computed(() => props.data.project as Project);

const allRunning = computed(() =>
  project.value.services.length > 0 &&
  project.value.services.every(s => s.status === 'running'),
);

const anyRunning = computed(() =>
  project.value.services.some(s => s.status === 'running' || s.status === 'starting'),
);

function startAll() {
  store.startAllServices(project.value.id);
}

function stopAll() {
  store.stopAllServices(project.value.id);
}
</script>

<template>
  <div
    class="project-node min-w-[220px] max-w-[280px] rounded-lg border bg-card text-card-foreground shadow-md"
    :class="anyRunning ? 'border-primary/40 ring-1 ring-primary/20' : 'border-border'"
  >
    <!-- Header -->
    <div class="flex items-center gap-2 rounded-t-lg border-b px-3 py-2 bg-primary/8">
      <FolderOpen class="h-4 w-4 shrink-0 text-primary" />
      <span class="flex-1 truncate text-sm font-semibold">{{ project.name }}</span>
      <Badge v-if="anyRunning" variant="default" class="h-4 px-1.5 text-[10px]">Live</Badge>
    </div>

    <!-- Body -->
    <div class="px-3 py-2 text-xs text-muted-foreground space-y-1.5">
      <div class="truncate font-mono text-[10px] opacity-70" :title="project.path">
        {{ project.path }}
      </div>
      <div v-if="project.description" class="text-muted-foreground/80">
        {{ project.description }}
      </div>

      <!-- Quick actions -->
      <div v-if="project.services.length > 0" class="flex gap-1.5 pt-1">
        <Button
          v-if="!allRunning"
          size="sm"
          variant="default"
          class="h-6 px-2 text-[10px] gap-1"
          @click.stop="startAll"
        >
          <Play class="h-2.5 w-2.5" />
          Start All
        </Button>
        <Button
          v-if="anyRunning"
          size="sm"
          variant="destructive"
          class="h-6 px-2 text-[10px] gap-1"
          @click.stop="stopAll"
        >
          <Square class="h-2.5 w-2.5" />
          Stop All
        </Button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.project-node {
  transition: box-shadow 0.2s ease, border-color 0.2s ease;
}
</style>
