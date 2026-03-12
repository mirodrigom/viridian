<script setup lang="ts">
import { computed } from 'vue';
import { renderMarkdown } from '@/lib/markdown';
import { ScrollArea } from '@/components/ui/scroll-area';

const props = defineProps<{
  content: string;
  language: string;
  name: string;
}>();

const renderedHtml = computed(() => {
  // Wrap the content in a markdown code block to reuse the existing renderer
  const lang = props.language || 'plaintext';
  const fenced = '```' + lang + '\n' + props.content + '\n```';
  return renderMarkdown(fenced);
});

const lineCount = computed(() => {
  return props.content.split('\n').length;
});

const fileSize = computed(() => {
  const bytes = new Blob([props.content]).size;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
});
</script>

<template>
  <div class="flex h-full flex-col">
    <div class="flex items-center gap-3 border-b border-border bg-muted/30 px-3 py-1.5">
      <span class="text-[11px] font-medium text-muted-foreground">{{ language }}</span>
      <span class="text-[11px] text-muted-foreground/60">{{ lineCount }} lines</span>
      <span class="text-[11px] text-muted-foreground/60">{{ fileSize }}</span>
    </div>
    <ScrollArea class="flex-1">
      <div class="code-preview p-0" v-html="renderedHtml" />
    </ScrollArea>
  </div>
</template>

<style scoped>
.code-preview :deep(.code-block-wrapper) {
  margin: 0;
}

.code-preview :deep(.code-block-wrapper > div:first-child) {
  border-radius: 0;
  border-left: 0;
  border-right: 0;
  border-top: 0;
}

.code-preview :deep(pre) {
  margin: 0;
  border-radius: 0;
  border: 0;
}
</style>
