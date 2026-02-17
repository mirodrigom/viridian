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
    </div>
  </BaseNode>
</template>
