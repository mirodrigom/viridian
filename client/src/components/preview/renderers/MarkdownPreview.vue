<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue';
import { renderMarkdown, setupCodeCopyHandler } from '@/lib/markdown';
import { ScrollArea } from '@/components/ui/scroll-area';

const props = defineProps<{ content: string }>();

const renderedHtml = computed(() => renderMarkdown(props.content));

let cleanupCopyHandler: (() => void) | null = null;

onMounted(() => {
  cleanupCopyHandler = setupCodeCopyHandler();
});

onUnmounted(() => {
  cleanupCopyHandler?.();
});
</script>

<template>
  <ScrollArea class="h-full">
    <div
      class="prose prose-sm dark:prose-invert max-w-none p-6"
      v-html="renderedHtml"
    />
  </ScrollArea>
</template>
