<script setup lang="ts">
import { computed } from 'vue';
import { getBezierPath, EdgeLabelRenderer, BaseEdge } from '@vue-flow/core';
import type { EdgeProps } from '@vue-flow/core';
import type { GraphEdgeData } from '@/types/graph';
import { EDGE_STYLES } from '@/types/graph';
import { useGraphStore } from '@/stores/graph';
import { useGraphRunnerStore } from '@/stores/graphRunner';
import { X } from 'lucide-vue-next';

const props = defineProps<EdgeProps>();
const graph = useGraphStore();
const runner = useGraphRunnerStore();

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

// Reverse path for result_return particles (target → source)
const reversePath = computed(() => {
  return getBezierPath({
    sourceX: props.targetX,
    sourceY: props.targetY,
    targetX: props.sourceX,
    targetY: props.sourceY,
    sourcePosition: props.targetPosition,
    targetPosition: props.sourcePosition,
  });
});

const labelX = computed(() => (props.sourceX + props.targetX) / 2);
const labelY = computed(() => (props.sourceY + props.targetY) / 2);

// Edge flow animation state
const edgeFlow = computed(() => runner.activeEdgeFlows[props.id] ?? null);

// Active edge: source or target node is currently running
const isActiveEdge = computed(() => {
  if (!runner.isRunning) return false;
  return runner.activeNodeIds.has(props.source) || runner.activeNodeIds.has(props.target);
});

// Particle path — forward uses normal path, reverse uses reversed path
const particlePath = computed(() => {
  if (!edgeFlow.value) return path.value[0];
  return edgeFlow.value.direction === 'reverse' ? reversePath.value[0] : path.value[0];
});

// Particle color
const particleColor = computed(() => {
  if (!edgeFlow.value) return 'var(--primary)';
  return edgeFlow.value.type === 'delegation' ? 'var(--primary)' : 'var(--chart-2)';
});

function onDelete() {
  graph.removeEdge(props.id);
}
</script>

<template>
  <!-- Glow overlay (rendered behind the main edge) -->
  <path
    v-if="isActiveEdge"
    :d="path[0]"
    fill="none"
    :stroke="style.color"
    :stroke-width="style.strokeWidth + 6"
    stroke-linecap="round"
    class="edge-glow"
    :style="{ filter: `blur(4px)` }"
  />

  <BaseEdge
    :id="id"
    :path="path[0]"
    :style="{
      stroke: style.color,
      strokeWidth: isActiveEdge ? style.strokeWidth + 1 : style.strokeWidth,
      ...(style.animated ? { strokeDasharray: '8 4' } : {}),
      transition: 'stroke-width 0.3s ease',
    }"
    :class="style.animated ? 'animated-edge' : ''"
  />

  <!-- Flow particles -->
  <g v-if="edgeFlow" :key="edgeFlow.startedAt">
    <!-- Main particle -->
    <circle
      :r="4"
      :fill="particleColor"
      class="edge-particle"
    >
      <animateMotion
        :dur="edgeFlow.type === 'delegation' ? '1.2s' : '1s'"
        fill="freeze"
        keyPoints="0;1"
        keyTimes="0;1"
        calcMode="spline"
        keySplines="0.4 0 0.2 1"
      >
        <mpath :href="`#particle-path-${id}-${edgeFlow.startedAt}`" />
      </animateMotion>
    </circle>
    <!-- Trail particle (delayed) -->
    <circle
      :r="2.5"
      :fill="particleColor"
      opacity="0.6"
      class="edge-particle"
    >
      <animateMotion
        :dur="edgeFlow.type === 'delegation' ? '1.2s' : '1s'"
        :begin="'0.08s'"
        fill="freeze"
        keyPoints="0;1"
        keyTimes="0;1"
        calcMode="spline"
        keySplines="0.4 0 0.2 1"
      >
        <mpath :href="`#particle-path-${id}-${edgeFlow.startedAt}`" />
      </animateMotion>
    </circle>
    <!-- Hidden path for animateMotion reference -->
    <path
      :id="`particle-path-${id}-${edgeFlow.startedAt}`"
      :d="particlePath"
      fill="none"
      stroke="none"
    />
  </g>

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

.edge-glow {
  opacity: 0.3;
  animation: edge-glow-pulse 2s ease-in-out infinite;
  pointer-events: none;
}

@keyframes edge-glow-pulse {
  0%, 100% { opacity: 0.15; }
  50% { opacity: 0.35; }
}

.edge-particle {
  filter: drop-shadow(0 0 4px currentColor);
  pointer-events: none;
}
</style>
