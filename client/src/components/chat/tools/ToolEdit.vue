<script setup lang="ts">
import { ref, computed } from 'vue';
import type { ToolUseInfo } from '@/stores/chat';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Pencil, ChevronRight } from 'lucide-vue-next';

const props = defineProps<{ toolUse: ToolUseInfo }>();
const showDiff = ref(false);

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

const removedLines = computed(() => oldString.value ? oldString.value.split('\n').length : 0);
const addedLines = computed(() => newString.value ? newString.value.split('\n').length : 0);
</script>

<template>
  <div class="overflow-hidden rounded-md border border-border">
    <!-- File path -->
    <div class="flex items-center gap-2 border-b border-border bg-muted/20 px-3 py-1.5">
      <Pencil class="h-3 w-3 shrink-0 text-primary/70" />
      <span class="truncate font-mono text-xs text-foreground" :title="filePath">{{ shortPath }}</span>
      <div class="ml-auto flex items-center gap-1.5">
        <span v-if="removedLines" class="rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] text-red-400">-{{ removedLines }}</span>
        <span v-if="addedLines" class="rounded bg-green-500/15 px-1.5 py-0.5 text-[10px] text-green-400">+{{ addedLines }}</span>
        <span v-if="replaceAll" class="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] text-primary">replace all</span>
      </div>
    </div>
    <!-- Collapsible diff view -->
    <Collapsible v-if="oldString || newString" v-model:open="showDiff">
      <CollapsibleTrigger
        class="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/30 hover:text-foreground"
      >
        <ChevronRight
          class="h-3 w-3 shrink-0 transition-transform duration-200"
          :class="{ 'rotate-90': showDiff }"
        />
        <span>View changes</span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div class="max-h-64 overflow-auto border-t border-border font-mono text-xs leading-relaxed">
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
      </CollapsibleContent>
    </Collapsible>
    <div v-else-if="toolUse.isInputStreaming" class="px-3 py-2">
      <span class="inline-block h-3 w-1 animate-pulse rounded-sm bg-primary" />
    </div>
  </div>
</template>
