<script setup lang="ts">
import type { NodeProps } from '@vue-flow/core';
import type { ExpertNodeData } from '@/types/graph';
import BaseNode from './BaseNode.vue';
import { Sparkles } from 'lucide-vue-next';

const props = defineProps<NodeProps>();
const data = props.data as ExpertNodeData;
</script>

<template>
  <BaseNode :id="id" :data="data" :selected="selected" class="group">
    <template #icon>
      <Sparkles class="h-4 w-4 shrink-0" />
    </template>
    <div class="space-y-1">
      <div class="flex items-center justify-between">
        <span class="text-muted-foreground">Specialty</span>
        <span class="text-foreground">{{ data.specialty || 'general' }}</span>
      </div>
      <div class="flex items-center justify-between">
        <span class="text-muted-foreground">Model</span>
        <span class="font-mono text-foreground">{{ data.model?.split('-').slice(-2).join('-') || 'not set' }}</span>
      </div>
      <div v-if="data.systemPrompt" class="truncate text-muted-foreground/70">
        {{ data.systemPrompt.slice(0, 60) }}{{ data.systemPrompt.length > 60 ? '...' : '' }}
      </div>
    </div>
  </BaseNode>
</template>
