<script setup lang="ts">
import { computed } from 'vue';
import { getBezierPath, getStraightPath, getSmoothStepPath } from '@vue-flow/core';
import type { EdgeProps } from '@vue-flow/core';
import type { DiagramEdgeData } from '@/stores/diagrams';

const props = defineProps<EdgeProps>();

const edgeData = computed(() => (props.data || {}) as DiagramEdgeData);

const pathParams = computed(() => ({
  sourceX: props.sourceX,
  sourceY: props.sourceY,
  sourcePosition: props.sourcePosition,
  targetX: props.targetX,
  targetY: props.targetY,
  targetPosition: props.targetPosition,
}));

const pathResult = computed(() => {
  const p = pathParams.value;
  const baseType = edgeData.value.edgeType || 'default';

  switch (baseType) {
    case 'straight':
      return getStraightPath(p);
    case 'step':
    case 'smoothstep':
      return getSmoothStepPath(p);
    default:
      return getBezierPath(p);
  }
});

const pathData = computed(() => pathResult.value[0]);
const labelX = computed(() => pathResult.value[1]);
const labelY = computed(() => pathResult.value[2]);

const edgeColor = computed(() => edgeData.value.color || 'var(--primary)');
const dotColor = computed(() => edgeData.value.dotColor || edgeColor.value);
const dotCount = computed(() => edgeData.value.dotCount || 1);

const dotDuration = computed(() => {
  switch (edgeData.value.dotSpeed) {
    case 'slow': return '3s';
    case 'fast': return '0.8s';
    default: return '1.5s';
  }
});

const strokeDasharray = computed(() => {
  const style = edgeData.value.style;
  if (style === 'dashed') return '8 4';
  if (style === 'dotted') return '2 4';
  return undefined;
});

const pathId = computed(() => `edge-path-${props.id}`);

// Generate delay offsets for multiple dots
const dots = computed(() => {
  const count = dotCount.value;
  const dur = parseFloat(dotDuration.value);
  return Array.from({ length: count }, (_, i) => ({
    key: i,
    delay: `${(-dur * i / count).toFixed(2)}s`,
  }));
});
</script>

<template>
  <g>
    <!-- Edge path -->
    <path
      :id="pathId"
      :d="pathData"
      fill="none"
      :stroke="edgeColor"
      stroke-width="1.5"
      :stroke-dasharray="strokeDasharray"
      class="vue-flow__edge-path"
    />

    <!-- Animated dots traveling along the path -->
    <circle
      v-for="dot in dots"
      :key="dot.key"
      r="4"
      :fill="dotColor"
      :opacity="0.9"
    >
      <animateMotion
        :dur="dotDuration"
        repeatCount="indefinite"
        rotate="auto"
        :begin="dot.delay"
      >
        <mpath :href="'#' + pathId" />
      </animateMotion>
    </circle>

    <!-- Edge label -->
    <g v-if="edgeData.label" :transform="`translate(${labelX}, ${labelY})`">
      <rect
        :x="-edgeData.label.length * 3.5 - 4"
        y="-10"
        :width="edgeData.label.length * 7 + 8"
        height="20"
        rx="4"
        fill="var(--card)"
        stroke="var(--border)"
        stroke-width="1"
      />
      <text
        text-anchor="middle"
        dominant-baseline="central"
        class="text-[10px]"
        fill="var(--foreground)"
      >
        {{ edgeData.label }}
      </text>
    </g>
  </g>
</template>
