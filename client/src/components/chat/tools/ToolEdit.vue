<script setup lang="ts">
import { computed } from 'vue';
import type { ToolUseInfo } from '@/stores/chat';
import { Pencil } from 'lucide-vue-next';

const props = defineProps<{ toolUse: ToolUseInfo }>();

const filePath = computed(() => {
  const fp = props.toolUse.input.file_path;
  return typeof fp === 'string' ? fp : '';
});

const shortPath = computed(() => {
  const parts = filePath.value.split('/');
  return parts.length > 3 ? '.../' + parts.slice(-3).join('/') : filePath.value;
});

const oldString = computed(() => {
  const s = props.toolUse.input.old_string;
  return typeof s === 'string' ? s : '';
});

const newString = computed(() => {
  const s = props.toolUse.input.new_string;
  return typeof s === 'string' ? s : '';
});

const replaceAll = computed(() => !!props.toolUse.input.replace_all);
</script>

<template>
  <div class="overflow-hidden rounded-md border border-border">
    <!-- File path -->
    <div class="flex items-center gap-2 border-b border-border bg-muted/20 px-3 py-1.5">
      <Pencil class="h-3 w-3 shrink-0 text-primary/70" />
      <span class="truncate font-mono text-xs text-foreground" :title="filePath">{{ shortPath }}</span>
      <span v-if="replaceAll" class="ml-auto rounded bg-primary/15 px-1.5 py-0.5 text-[10px] text-primary">replace all</span>
    </div>
    <!-- Diff view -->
    <div v-if="oldString || newString" class="font-mono text-xs leading-relaxed">
      <div v-if="oldString" class="border-b border-border bg-red-500/10 px-3 py-1.5">
        <div v-for="(line, i) in oldString.split('\n')" :key="'old-'+i" class="flex gap-1.5">
          <span class="select-none text-red-400/70">-</span>
          <span class="whitespace-pre-wrap text-red-300/90">{{ line }}</span>
        </div>
      </div>
      <div v-if="newString" class="bg-green-500/10 px-3 py-1.5">
        <div v-for="(line, i) in newString.split('\n')" :key="'new-'+i" class="flex gap-1.5">
          <span class="select-none text-green-400/70">+</span>
          <span class="whitespace-pre-wrap text-green-300/90">{{ line }}</span>
        </div>
      </div>
    </div>
    <div v-else-if="toolUse.isInputStreaming" class="px-3 py-2">
      <span class="inline-block h-3 w-1 animate-pulse rounded-sm bg-primary" />
    </div>
  </div>
</template>
