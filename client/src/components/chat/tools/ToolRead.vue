<script setup lang="ts">
import { computed } from 'vue';
import type { ToolUseInfo } from '@/stores/chat';
import { FileText } from 'lucide-vue-next';

const props = defineProps<{ toolUse: ToolUseInfo }>();

const filePath = computed(() => {
  const fp = props.toolUse.input.file_path;
  return typeof fp === 'string' ? fp : '';
});

const shortPath = computed(() => {
  const parts = filePath.value.split('/');
  return parts.length > 3 ? '.../' + parts.slice(-3).join('/') : filePath.value;
});

const lineRange = computed(() => {
  const offset = props.toolUse.input.offset;
  const limit = props.toolUse.input.limit;
  if (typeof offset === 'number' && typeof limit === 'number') {
    return `${offset}-${offset + limit}`;
  }
  if (typeof offset === 'number') return `from ${offset}`;
  if (typeof limit === 'number') return `first ${limit} lines`;
  return '';
});
</script>

<template>
  <div class="flex items-center gap-2 rounded-md border border-border bg-muted/20 px-3 py-2">
    <FileText class="h-3.5 w-3.5 shrink-0 text-primary/70" />
    <span class="truncate font-mono text-xs text-foreground" :title="filePath">{{ shortPath }}</span>
    <span v-if="lineRange" class="ml-auto whitespace-nowrap rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
      {{ lineRange }}
    </span>
    <span v-if="toolUse.isInputStreaming" class="ml-auto inline-block h-3 w-1 animate-pulse rounded-sm bg-primary" />
  </div>
</template>
