<script setup lang="ts">
import { computed } from 'vue';
import type { NodeProps } from '@vue-flow/core';
import type { RuleNodeData } from '@/types/graph';
import BaseNode from './BaseNode.vue';
import { ShieldCheck } from 'lucide-vue-next';

const props = defineProps<NodeProps>();
const data = computed(() => props.data as RuleNodeData);
</script>

<template>
  <BaseNode :id="id" :data="data" :selected="selected" class="group">
    <template #icon>
      <ShieldCheck class="h-4 w-4 shrink-0" />
    </template>
    <div class="space-y-1">
      <div class="flex items-center justify-between">
        <span class="text-muted-foreground">Type</span>
        <span class="capitalize text-foreground">{{ data.ruleType }}</span>
      </div>
      <div class="flex items-center justify-between">
        <span class="text-muted-foreground">Scope</span>
        <span class="capitalize text-foreground">{{ data.scope }}</span>
      </div>
      <div v-if="data.ruleText" class="truncate text-muted-foreground/70">
        {{ data.ruleText.slice(0, 80) }}{{ data.ruleText.length > 80 ? '...' : '' }}
      </div>
    </div>
  </BaseNode>
</template>
