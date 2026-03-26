<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Eye, EyeOff, ArrowRight } from 'lucide-vue-next';
import { useDiagramsStore, type DiagramEdgeData } from '@/stores/diagrams';

const diagrams = useDiagramsStore();

// ─── Visibility tracking (skip recomputation when panel is hidden/collapsed) ──
const panelRef = ref<HTMLElement | null>(null);
const isVisible = ref(true);
let observer: IntersectionObserver | null = null;

onMounted(() => {
  if (panelRef.value) {
    observer = new IntersectionObserver(
      ([entry]) => { isVisible.value = entry?.isIntersecting ?? false; },
      { threshold: 0.01 },
    );
    observer.observe(panelRef.value);
  }
});

onUnmounted(() => {
  observer?.disconnect();
});

interface EdgeLayerItem {
  id: string;
  label: string;
  sourceLabel: string;
  targetLabel: string;
  color: string;
  hidden: boolean;
  flowLevel: number | null;
}

const _edgeLayers = computed((): EdgeLayerItem[] => {
  return diagrams.edges.map(e => {
    const data = (e.data || {}) as DiagramEdgeData;
    const sourceNode = diagrams.nodeById.get(e.source);
    const targetNode = diagrams.nodeById.get(e.target);
    const sourceLabel = sourceNode?.data?.customLabel || sourceNode?.data?.label || e.source;
    const targetLabel = targetNode?.data?.customLabel || targetNode?.data?.label || e.target;
    const level = diagrams.edgeFlowLevels.get(e.id);
    return {
      id: e.id,
      label: data.label || '',
      sourceLabel,
      targetLabel,
      color: (e.style as any)?.stroke || data.color || 'var(--primary)',
      hidden: e.hidden ?? false,
      flowLevel: level != null ? level + 1 : null,
    };
  });
});

let cachedEdgeLayers: EdgeLayerItem[] = [];
const edgeLayers = computed((): EdgeLayerItem[] => {
  if (isVisible.value) {
    cachedEdgeLayers = _edgeLayers.value;
  }
  return cachedEdgeLayers;
});
</script>

<template>
  <div ref="panelRef" data-testid="connections-panel" class="flex h-full flex-col bg-background" style="min-height: 0;">
    <!-- Header -->
    <div class="flex h-9 shrink-0 items-center gap-1.5 border-b border-border px-2">
      <ArrowRight class="h-3.5 w-3.5 text-muted-foreground" />
      <span class="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Connections</span>
      <div class="flex-1" />
      <span class="text-[9px] tabular-nums text-muted-foreground/60">{{ diagrams.edgeCount }}</span>
    </div>

    <!-- Connection list -->
    <ScrollArea class="flex-1" style="min-height: 0;">
      <div class="p-1">
        <!-- Empty state -->
        <div v-if="diagrams.edgeCount === 0" class="flex items-center justify-center py-8 text-xs text-muted-foreground">
          No connections yet
        </div>

        <!-- Connection rows -->
        <div
          v-for="edge in edgeLayers"
          :key="edge.id"
          class="group flex cursor-default items-center gap-1 rounded py-1 pl-1 pr-1 transition-colors"
          :class="[
            edge.hidden ? 'opacity-50' : '',
            diagrams.selectedEdgeId === edge.id
              ? 'bg-primary/10 text-primary'
              : 'hover:bg-muted/50 text-foreground',
          ]"
          @click="diagrams.selectEdge(edge.id)"
        >
          <!-- Eye visibility toggle -->
          <button
            class="flex h-4 w-4 shrink-0 items-center justify-center rounded transition-opacity"
            :class="edge.hidden
              ? 'text-muted-foreground/40 hover:text-muted-foreground'
              : 'text-muted-foreground/30 hover:text-muted-foreground'"
            :title="edge.hidden ? 'Show connection' : 'Hide connection'"
            @click.stop="diagrams.toggleEdgeVisibility(edge.id)"
          >
            <EyeOff v-if="edge.hidden" class="h-3 w-3" />
            <Eye v-else class="h-3 w-3" />
          </button>

          <!-- Color line indicator -->
          <div
            class="h-0.5 w-3 shrink-0 rounded-full"
            :style="{ backgroundColor: edge.color }"
          />

          <!-- Step badge -->
          <span
            v-if="edge.flowLevel"
            class="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full text-[8px] font-bold"
            :style="{ backgroundColor: edge.color + '20', color: edge.color, border: `1px solid ${edge.color}40` }"
          >{{ edge.flowLevel }}</span>

          <!-- Label or source → target -->
          <span class="min-w-0 flex-1 truncate text-[11px]">
            <template v-if="edge.label">{{ edge.label }}</template>
            <template v-else>
              <span class="text-muted-foreground">{{ edge.sourceLabel }}</span>
              <span class="mx-0.5 text-muted-foreground/50">&rarr;</span>
              <span class="text-muted-foreground">{{ edge.targetLabel }}</span>
            </template>
          </span>
        </div>
      </div>
    </ScrollArea>
  </div>
</template>
