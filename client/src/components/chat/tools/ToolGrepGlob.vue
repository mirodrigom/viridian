<script setup lang="ts">
import { computed } from 'vue';
import type { ToolUseInfo } from '@/stores/chat';
import { Search, FolderSearch } from 'lucide-vue-next';

const props = defineProps<{ toolUse: ToolUseInfo }>();

const isGrep = computed(() => props.toolUse.tool === 'Grep');

const pattern = computed(() => {
  const p = props.toolUse.input.pattern;
  return typeof p === 'string' ? p : '';
});

const path = computed(() => {
  const p = props.toolUse.input.path;
  return typeof p === 'string' ? p : '';
});

const shortPath = computed(() => {
  if (!path.value) return '';
  const parts = path.value.split('/');
  return parts.length > 3 ? '.../' + parts.slice(-3).join('/') : path.value;
});

const glob = computed(() => {
  const g = props.toolUse.input.glob;
  return typeof g === 'string' ? g : '';
});

const fileType = computed(() => {
  const t = props.toolUse.input.type;
  return typeof t === 'string' ? t : '';
});
</script>

<template>
  <div class="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/20 px-3 py-2">
    <component :is="isGrep ? Search : FolderSearch" class="h-3.5 w-3.5 shrink-0 text-primary/70" />
    <code class="rounded bg-primary/10 px-1.5 py-0.5 font-mono text-xs text-primary">{{ pattern }}</code>
    <span v-if="shortPath" class="truncate font-mono text-[11px] text-muted-foreground" :title="path">
      in {{ shortPath }}
    </span>
    <span v-if="glob" class="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
      {{ glob }}
    </span>
    <span v-if="fileType" class="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
      .{{ fileType }}
    </span>
    <span v-if="toolUse.isInputStreaming" class="ml-auto inline-block h-3 w-1 animate-pulse rounded-sm bg-primary" />
  </div>
</template>
