<script setup lang="ts">
import { ref, watch, onMounted, nextTick } from 'vue';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { RefreshCw, AlertTriangle } from 'lucide-vue-next';

const props = defineProps<{ content: string }>();

const containerRef = ref<HTMLDivElement | null>(null);
const error = ref<string | null>(null);
const rendering = ref(false);
let mermaidInstance: typeof import('mermaid') | null = null;
let renderCounter = 0;

async function getMermaid() {
  if (!mermaidInstance) {
    mermaidInstance = await import('mermaid');
    mermaidInstance.default.initialize({
      startOnLoad: false,
      theme: document.documentElement.classList.contains('dark') ? 'dark' : 'default',
      securityLevel: 'strict',
      fontFamily: 'ui-sans-serif, system-ui, sans-serif',
    });
  }
  return mermaidInstance.default;
}

async function renderDiagram() {
  if (!containerRef.value || !props.content.trim()) return;

  rendering.value = true;
  error.value = null;

  try {
    const mermaid = await getMermaid();
    renderCounter++;
    const id = `mermaid-preview-${renderCounter}`;

    const { svg } = await mermaid.render(id, props.content.trim());
    if (containerRef.value) {
      containerRef.value.innerHTML = svg;
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
    if (containerRef.value) {
      containerRef.value.innerHTML = '';
    }
  } finally {
    rendering.value = false;
  }
}

onMounted(() => {
  nextTick(() => renderDiagram());
});

watch(() => props.content, () => {
  renderDiagram();
});
</script>

<template>
  <div class="flex h-full flex-col">
    <div class="flex items-center gap-2 border-b border-border bg-muted/30 px-3 py-1.5">
      <span class="text-[11px] font-medium text-muted-foreground">Mermaid Diagram</span>
      <Button
        variant="ghost"
        size="sm"
        class="ml-auto h-6 w-6 p-0"
        title="Re-render"
        :disabled="rendering"
        @click="renderDiagram"
      >
        <RefreshCw class="h-3 w-3" :class="{ 'animate-spin': rendering }" />
      </Button>
    </div>

    <ScrollArea class="flex-1">
      <div v-if="error" class="flex flex-col items-center justify-center gap-3 p-8 text-center">
        <div class="flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10">
          <AlertTriangle class="h-5 w-5 text-destructive" />
        </div>
        <div>
          <p class="text-sm font-medium text-foreground">Failed to render diagram</p>
          <p class="mt-1 max-w-md text-xs text-muted-foreground">{{ error }}</p>
        </div>
        <Button variant="outline" size="sm" @click="renderDiagram">
          <RefreshCw class="mr-1.5 h-3 w-3" />
          Retry
        </Button>
      </div>

      <div
        v-show="!error"
        ref="containerRef"
        class="flex min-h-[200px] items-center justify-center p-6"
      />
    </ScrollArea>
  </div>
</template>
