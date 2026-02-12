<script setup lang="ts">
import { computed } from 'vue';
import { getBezierPath, EdgeLabelRenderer, BaseEdge } from '@vue-flow/core';
import type { EdgeProps } from '@vue-flow/core';
import type { GraphEdgeData } from '@/types/graph';
import { EDGE_STYLES } from '@/types/graph';
import { useGraphStore } from '@/stores/graph';
import { X } from 'lucide-vue-next';

const props = defineProps<EdgeProps>();
const graph = useGraphStore();

const edgeData = computed(() => props.data as GraphEdgeData);

const style = computed(() => {
  const s = EDGE_STYLES[edgeData.value?.edgeType ?? 'delegation'];
  return s;
});

const path = computed(() => {
  return getBezierPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    targetX: props.targetX,
    targetY: props.targetY,
    sourcePosition: props.sourcePosition,
    targetPosition: props.targetPosition,
  });
});

const labelX = computed(() => (props.sourceX + props.targetX) / 2);
const labelY = computed(() => (props.sourceY + props.targetY) / 2);

function onDelete() {
  graph.removeEdge(props.id);
}
</script>

<template>
  <BaseEdge
    :id="id"
    :path="path[0]"
    :style="{
      stroke: style.color,
      strokeWidth: style.strokeWidth,
      ...(style.animated ? { strokeDasharray: '8 4' } : {}),
    }"
    :class="style.animated ? 'animated-edge' : ''"
  />

  <!-- Edge label -->
  <EdgeLabelRenderer v-if="edgeData?.label">
    <div
      class="nodrag nopan group absolute flex items-center gap-1 rounded-full border border-border/50 bg-card/90 px-2 py-0.5 text-[10px] text-muted-foreground backdrop-blur-sm"
      :style="{
        transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
        pointerEvents: 'all',
      }"
    >
      <span class="capitalize">{{ edgeData.label }}</span>
      <button
        class="rounded-full p-0.5 opacity-0 transition-opacity hover:bg-destructive/20 group-hover:opacity-100"
        @click="onDelete"
      >
        <X class="h-2.5 w-2.5 text-destructive" />
      </button>
    </div>
  </EdgeLabelRenderer>
</template>

<style>
.animated-edge {
  animation: edge-dash 1s linear infinite;
}

@keyframes edge-dash {
  to {
    stroke-dashoffset: -12;
  }
}
</style>
