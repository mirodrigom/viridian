<script setup lang="ts">
import { computed } from 'vue';
import type { NodeProps } from '@vue-flow/core';
import type { SubagentNodeData } from '@/types/graph';
import BaseNode from './BaseNode.vue';
import { GitBranch } from 'lucide-vue-next';

const props = defineProps<NodeProps>();
const data = computed(() => props.data as SubagentNodeData);
</script>

<template>
  <BaseNode :id="id" :data="data" :selected="selected" class="group">
    <template #icon>
      <GitBranch class="h-4 w-4 shrink-0" />
    </template>
    <div class="space-y-1">
      <div class="flex items-center justify-between">
        <span class="text-muted-foreground">Model</span>
        <span class="font-mono text-foreground">{{ data.model?.split('-').slice(-2).join('-') || 'not set' }}</span>
      </div>
      <div v-if="data.description" class="truncate text-muted-foreground/70">
        {{ data.description.slice(0, 80) }}{{ data.description.length > 80 ? '...' : '' }}
      </div>
      <div v-if="data.metadata?.tags?.length" class="flex flex-wrap gap-0.5 pt-0.5">
        <span
          v-for="tag in data.metadata.tags.slice(0, 4)" :key="tag"
          class="rounded bg-chart-2/10 px-1 py-px text-[9px] text-chart-2/70"
        >{{ tag }}</span>
        <span v-if="data.metadata.tags.length > 4" class="text-[9px] text-muted-foreground">+{{ data.metadata.tags.length - 4 }}</span>
      </div>
    </div>
  </BaseNode>
</template>
