<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { getBezierPath, getStraightPath, getSmoothStepPath } from '@vue-flow/core';
import type { EdgeProps } from '@vue-flow/core';
import type { DiagramEdgeData } from '@/stores/diagrams';
import { useDiagramsStore } from '@/stores/diagrams';

const props = defineProps<EdgeProps>();
const diagrams = useDiagramsStore();

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

const labelFontSize = computed(() => {
  switch (edgeData.value.labelSize) {
    case 'medium': return 12;
    case 'large': return 14;
    default: return 10;
  }
});
const labelCharWidth = computed(() => labelFontSize.value * 0.6);
const labelPadX = computed(() => labelFontSize.value <= 10 ? 6 : 8);
const labelPadY = computed(() => labelFontSize.value <= 10 ? 4 : 6);

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

// ── Flow cascade: stagger animation based on topological order ──────
const flowLevel = computed(() => diagrams.edgeFlowLevels.get(props.id) || 0);
const flowDelay = computed(() => flowLevel.value * diagrams.flowStagger);

// Generate delay offsets for multiple dots (used in live animateMotion mode)
// flowDelay staggers edges by topological level; dots within the same edge are spaced evenly
const dots = computed(() => {
  const count = dotCount.value;
  const dur = parseFloat(dotDuration.value);
  return Array.from({ length: count }, (_, i) => ({
    key: i,
    delay: `${(flowDelay.value + dur * i / count).toFixed(3)}s`,
  }));
});

// ── GIF export mode: position dots programmatically ──────────────────
const pathRef = ref<SVGPathElement | null>(null);
const pathReady = ref(false);

onMounted(() => {
  pathReady.value = true;
});

const isExportMode = computed(() => diagrams.gifExportProgress !== null);
const maxFlowLevel = computed(() => Math.max(...diagrams.edgeFlowLevels.values(), 0));

// Position for the sequence badge (near the source end of the path)
const badgePos = computed(() => {
  if (!pathRef.value || !pathReady.value || maxFlowLevel.value === 0) return null;
  const len = pathRef.value.getTotalLength();
  return pathRef.value.getPointAtLength(Math.min(24, len * 0.12));
});

const dotPositions = computed(() => {
  const progress = diagrams.gifExportProgress;
  if (progress === null || !pathRef.value || !pathReady.value) return [];
  const pathLength = pathRef.value.getTotalLength();
  const count = dotCount.value;
  return Array.from({ length: count }, (_, i) => {
    const offset = (progress + i / count) % 1;
    const point = pathRef.value!.getPointAtLength(offset * pathLength);
    return { x: point.x, y: point.y, key: i };
  });
});
</script>

<template>
  <g>
    <!-- Invisible wider hit area for easier clicking -->
    <path
      :d="pathData"
      fill="none"
      stroke="transparent"
      stroke-width="20"
      class="vue-flow__edge-interaction"
    />
    <!-- Edge path -->
    <path
      ref="pathRef"
      :id="pathId"
      :d="pathData"
      fill="none"
      :stroke="edgeColor"
      stroke-width="1.5"
      :stroke-dasharray="strokeDasharray"
      class="vue-flow__edge-path"
    />

    <!-- Live mode: native SVG animation (zero JS overhead) -->
    <template v-if="!isExportMode">
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
    </template>

    <!-- Export mode: programmatic positions via getPointAtLength -->
    <template v-else>
      <circle
        v-for="dot in dotPositions"
        :key="dot.key"
        r="4"
        :cx="dot.x"
        :cy="dot.y"
        :fill="dotColor"
        :opacity="0.9"
      />
    </template>

    <!-- Edge label -->
    <g v-if="edgeData.label" :transform="`translate(${labelX}, ${labelY})`">
      <rect
        :x="-(edgeData.label.length * labelCharWidth / 2 + labelPadX)"
        :y="-(labelFontSize / 2 + labelPadY)"
        :width="edgeData.label.length * labelCharWidth + labelPadX * 2"
        :height="labelFontSize + labelPadY * 2"
        :rx="labelFontSize <= 10 ? 4 : 6"
        fill="var(--card)"
        :stroke="edgeColor"
        stroke-width="1"
        :opacity="0.95"
      />
      <text
        text-anchor="middle"
        dominant-baseline="central"
        :style="{ fontSize: labelFontSize + 'px', fontWeight: labelFontSize >= 14 ? 600 : 500 }"
        fill="var(--foreground)"
      >
        {{ edgeData.label }}
      </text>
    </g>

    <!-- Flow sequence badge (shown when multiple topological levels exist) -->
    <g v-if="badgePos && !isExportMode" :transform="`translate(${badgePos.x}, ${badgePos.y})`" class="flow-badge">
      <circle r="9" fill="var(--card)" :stroke="edgeColor" stroke-width="1.5" />
      <text
        text-anchor="middle"
        dominant-baseline="central"
        fill="var(--foreground)"
        style="font-size: 8px; font-weight: 700; font-family: ui-monospace, monospace;"
      >
        {{ flowLevel + 1 }}
      </text>
    </g>
  </g>
</template>
