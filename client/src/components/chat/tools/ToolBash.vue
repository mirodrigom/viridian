<script setup lang="ts">
import { computed } from 'vue';
import type { ToolUseInfo } from '@/stores/chat';

const props = defineProps<{ toolUse: ToolUseInfo }>();

const command = computed(() => {
  const cmd = props.toolUse.input.command;
  return typeof cmd === 'string' ? cmd : '';
});

const description = computed(() => {
  const desc = props.toolUse.input.description;
  return typeof desc === 'string' ? desc : '';
});

const timeout = computed(() => {
  const t = props.toolUse.input.timeout;
  return typeof t === 'number' ? `${(t / 1000).toFixed(0)}s timeout` : '';
});
</script>

<template>
  <div class="overflow-hidden rounded-md border border-border bg-muted/20">
    <div v-if="description" class="border-b border-border/50 px-3 py-1.5 text-[11px] text-muted-foreground">
      {{ description }}
    </div>
    <div class="px-3 py-2 font-mono text-xs">
      <div class="flex items-start gap-1.5">
        <span class="select-none text-primary">$</span>
        <pre class="whitespace-pre-wrap break-all text-foreground">{{ command }}</pre>
      </div>
      <div v-if="toolUse.isInputStreaming" class="mt-1">
        <span class="inline-block h-3 w-1 animate-pulse rounded-sm bg-primary" />
      </div>
    </div>
    <div v-if="timeout" class="border-t border-border/50 px-3 py-1 text-[10px] text-muted-foreground">
      {{ timeout }}
    </div>
  </div>
</template>
