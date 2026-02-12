<script setup lang="ts">
import type { NodeProps } from '@vue-flow/core';
import type { SkillNodeData } from '@/types/graph';
import BaseNode from './BaseNode.vue';
import { Zap } from 'lucide-vue-next';

const props = defineProps<NodeProps>();
const data = props.data as SkillNodeData;
</script>

<template>
  <BaseNode :id="id" :data="data" :selected="selected" class="group">
    <template #icon>
      <Zap class="h-4 w-4 shrink-0" />
    </template>
    <div class="space-y-1">
      <div v-if="data.command" class="flex items-center justify-between">
        <span class="text-muted-foreground">Command</span>
        <span class="font-mono text-foreground">{{ data.command }}</span>
      </div>
      <div v-if="data.promptTemplate" class="truncate text-muted-foreground/70">
        {{ data.promptTemplate.slice(0, 80) }}{{ data.promptTemplate.length > 80 ? '...' : '' }}
      </div>
      <div v-if="data.allowedTools?.length" class="text-muted-foreground/70">
        {{ data.allowedTools.length }} tools
      </div>
    </div>
  </BaseNode>
</template>
