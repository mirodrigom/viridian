<script setup lang="ts">
import { computed } from 'vue';
import type { NodeProps } from '@vue-flow/core';
import type { RuleNodeData } from '@/types/graph';
import BaseNode from './BaseNode.vue';
import { ShieldCheck } from 'lucide-vue-next';

const props = defineProps<NodeProps>();
const data = computed(() => props.data as RuleNodeData);
const isContainer = computed(() => data.value.isContainer === true);
</script>

<template>
  <!-- Container mode: large group rectangle -->
  <div
    v-if="isContainer"
    class="h-full w-full overflow-visible rounded-xl border-2 border-dashed border-destructive/50 bg-destructive/[0.03]"
    :class="{ 'ring-2 ring-destructive/50 shadow-lg shadow-destructive/10': selected }"
  >
    <div class="flex items-center gap-2 rounded-t-[10px] border-b border-destructive/15 bg-destructive/[0.06] px-4 py-2.5">
      <ShieldCheck class="h-4 w-4 shrink-0 text-destructive" />
      <span class="truncate text-sm font-semibold text-destructive">{{ data.label }}</span>
      <span class="ml-auto rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-destructive/70">
        {{ data.ruleType }}
      </span>
    </div>
    <!-- Children render inside this area via Vue Flow parentNode -->
  </div>

  <!-- Card mode: existing small card -->
  <BaseNode v-else :id="id" :data="data" :selected="selected" class="group">
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
