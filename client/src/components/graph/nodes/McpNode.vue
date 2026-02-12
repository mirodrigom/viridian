<script setup lang="ts">
import { computed } from 'vue';
import type { NodeProps } from '@vue-flow/core';
import type { McpNodeData } from '@/types/graph';
import BaseNode from './BaseNode.vue';
import { Server } from 'lucide-vue-next';

const props = defineProps<NodeProps>();
const data = computed(() => props.data as McpNodeData);
</script>

<template>
  <BaseNode :id="id" :data="data" :selected="selected" class="group">
    <template #icon>
      <Server class="h-4 w-4 shrink-0" />
    </template>
    <div class="space-y-1">
      <div class="flex items-center justify-between">
        <span class="text-muted-foreground">Type</span>
        <span class="font-mono uppercase text-foreground">{{ data.serverType }}</span>
      </div>
      <div v-if="data.command" class="truncate font-mono text-muted-foreground/70">
        {{ data.command }} {{ data.args?.join(' ') || '' }}
      </div>
      <div v-else-if="data.url" class="truncate font-mono text-muted-foreground/70">
        {{ data.url }}
      </div>
      <div v-if="data.tools?.length" class="text-muted-foreground/70">
        {{ data.tools.length }} tools available
      </div>
    </div>
  </BaseNode>
</template>
