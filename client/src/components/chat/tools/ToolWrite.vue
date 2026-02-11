<script setup lang="ts">
import { ref, computed } from 'vue';
import type { ToolUseInfo } from '@/stores/chat';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { FileOutput, ChevronRight } from 'lucide-vue-next';

const props = defineProps<{ toolUse: ToolUseInfo }>();
const showContent = ref(false);

const filePath = computed(() => {
  const fp = props.toolUse.input.file_path;
  return typeof fp === 'string' ? fp : '';
});

const shortPath = computed(() => {
  const parts = filePath.value.split('/');
  return parts.length > 3 ? '.../' + parts.slice(-3).join('/') : filePath.value;
});

const content = computed(() => {
  const c = props.toolUse.input.content;
  return typeof c === 'string' ? c : '';
});

const lineCount = computed(() => {
  if (!content.value) return 0;
  return content.value.split('\n').length;
});
</script>

<template>
  <div class="overflow-hidden rounded-md border border-border">
    <div class="flex items-center gap-2 border-b border-border bg-muted/20 px-3 py-1.5">
      <FileOutput class="h-3 w-3 shrink-0 text-primary/70" />
      <span class="truncate font-mono text-xs text-foreground" :title="filePath">{{ shortPath }}</span>
      <span v-if="lineCount" class="ml-auto rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
        {{ lineCount }} lines
      </span>
    </div>
    <Collapsible v-if="content" v-model:open="showContent">
      <CollapsibleTrigger
        class="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/30 hover:text-foreground"
      >
        <ChevronRight
          class="h-3 w-3 shrink-0 transition-transform duration-200"
          :class="{ 'rotate-90': showContent }"
        />
        <span>View content</span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <pre class="m-0 max-h-64 overflow-auto border-t border-border bg-muted/10 px-3 py-2 font-mono text-xs leading-relaxed text-foreground">{{ content }}</pre>
      </CollapsibleContent>
    </Collapsible>
    <div v-else-if="toolUse.isInputStreaming" class="px-3 py-2">
      <span class="inline-block h-3 w-1 animate-pulse rounded-sm bg-primary" />
    </div>
  </div>
</template>
