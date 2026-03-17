<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { getBezierPath, getStraightPath, getSmoothStepPath, EdgeLabelRenderer } from '@vue-flow/core';
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

const dotDirection = computed(() => edgeData.value.dotDirection || 'forward');
const showDots = computed(() => dotDirection.value !== 'none');

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
// Manual flowOrder override takes precedence over auto-computed topological level
const flowLevel = computed(() => {
  const manual = edgeData.value.flowOrder;
  if (manual != null) return manual;
  return diagrams.edgeFlowLevels.get(props.id) || 0;
});
const flowDelay = computed(() => flowLevel.value * diagrams.flowStagger);

// ── Flow playback state ───────────────────────────────────────────────
const playbackActive = computed(() => diagrams.playbackStep !== null);
const isCurrentStep = computed(() => !playbackActive.value || flowLevel.value === diagrams.playbackStep);
const isPastStep = computed(() => playbackActive.value && flowLevel.value < diagrams.playbackStep!);
const isFutureStep = computed(() => playbackActive.value && flowLevel.value > diagrams.playbackStep!);

// Opacity and animation gating based on playback state
const edgeOpacity = computed(() => {
  if (isFutureStep.value) return 0.1;
  if (isPastStep.value) return 0.35;
  return 1;
});
const showAnimation = computed(() => showDots.value && !isFutureStep.value && isCurrentStep.value);

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
const maxFlowLevel = computed(() => diagrams.maxFlowLevel);
const hasManualOrder = computed(() => edgeData.value.flowOrder != null);

// Position for the sequence badge — near source or target end of the path
const badgePos = computed(() => {
  // Depend on pathData so badge repositions when nodes move
  const _path = pathData.value;
  void _path;
  if (!pathRef.value || !pathReady.value || (maxFlowLevel.value === 0 && !hasManualOrder.value)) return null;
  const len = pathRef.value.getTotalLength();
  const pos = edgeData.value.flowOrderPosition || 'source';
  if (pos === 'target') {
    return pathRef.value.getPointAtLength(Math.max(len - 24, len * 0.88));
  }
  return pathRef.value.getPointAtLength(Math.min(24, len * 0.12));
});

// ── Custom SVG markers (VueFlow's marker system doesn't react to post-creation changes) ──
const startMarkerUrl = computed(() => {
  const ms = edgeData.value.markerStart;
  return ms && ms !== 'none' ? `url(#ms-${props.id})` : undefined;
});
const endMarkerUrl = computed(() => {
  const me = edgeData.value.markerEnd;
  return me && me !== 'none' ? `url(#me-${props.id})` : undefined;
});

const dotPositions = computed(() => {
  const progress = diagrams.gifExportProgress;
  if (progress === null || !pathRef.value || !pathReady.value) return [];
  const pathLength = pathRef.value.getTotalLength();
  const count = dotCount.value;
  const isReverse = dotDirection.value === 'reverse';
  return Array.from({ length: count }, (_, i) => {
    let offset = (progress + i / count) % 1;
    if (isReverse) offset = 1 - offset;
    const point = pathRef.value!.getPointAtLength(offset * pathLength);
    return { x: point.x, y: point.y, key: i };
  });
});
</script>

<template>
  <g :style="{ opacity: edgeOpacity, transition: 'opacity 0.4s ease' }">
    <!-- Custom marker defs (VueFlow's built-in markers don't react to post-creation changes) -->
    <defs>
      <marker
        v-if="edgeData.markerStart && edgeData.markerStart !== 'none'"
        :id="`ms-${props.id}`"
        viewBox="-10 -5 10 10"
        refX="0" refY="0"
        markerWidth="12" markerHeight="12"
        orient="auto-start-reverse"
      >
        <polyline
          v-if="edgeData.markerStart === 'arrowclosed'"
          points="-5,-4 0,0 -5,4 -5,-4"
          :style="`stroke: ${edgeColor}; fill: ${edgeColor}; stroke-width: 1;`"
          stroke-linecap="round" stroke-linejoin="round"
        />
        <polyline
          v-else
          points="-5,-4 0,0 -5,4"
          :style="`stroke: ${edgeColor}; fill: none; stroke-width: 1;`"
          stroke-linecap="round" stroke-linejoin="round"
        />
      </marker>
      <marker
        v-if="edgeData.markerEnd && edgeData.markerEnd !== 'none'"
        :id="`me-${props.id}`"
        viewBox="-10 -5 10 10"
        refX="0" refY="0"
        markerWidth="12" markerHeight="12"
        orient="auto-start-reverse"
      >
        <polyline
          v-if="edgeData.markerEnd === 'arrowclosed'"
          points="-5,-4 0,0 -5,4 -5,-4"
          :style="`stroke: ${edgeColor}; fill: ${edgeColor}; stroke-width: 1;`"
          stroke-linecap="round" stroke-linejoin="round"
        />
        <polyline
          v-else
          points="-5,-4 0,0 -5,4"
          :style="`stroke: ${edgeColor}; fill: none; stroke-width: 1;`"
          stroke-linecap="round" stroke-linejoin="round"
        />
      </marker>
    </defs>

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
      :style="{ strokeDasharray: strokeDasharray || 'none' }"
      :marker-start="startMarkerUrl"
      :marker-end="endMarkerUrl"
      class="vue-flow__edge-path"
    />

    <!-- Live mode: native SVG animation (zero JS overhead) -->
    <template v-if="!isExportMode && showAnimation">
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
          :keyPoints="dotDirection === 'reverse' ? '1;0' : '0;1'"
          keyTimes="0;1"
          calcMode="linear"
        >
          <mpath :href="'#' + pathId" />
        </animateMotion>
      </circle>
    </template>

    <!-- Export mode: programmatic positions via getPointAtLength -->
    <template v-else-if="showDots">
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

  </g>

  <!-- Edge label and flow badge rendered as HTML so they appear above nodes -->
  <EdgeLabelRenderer>
    <!-- Edge label -->
    <div
      v-if="edgeData.label"
      class="nodrag nopan"
      :style="{
        position: 'absolute',
        transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
        pointerEvents: 'none',
      }"
    >
      <span
        :style="{
          display: 'inline-flex',
          alignItems: 'center',
          padding: `${labelPadY}px ${labelPadX}px`,
          fontSize: labelFontSize + 'px',
          fontWeight: labelFontSize >= 14 ? 600 : 500,
          borderRadius: labelFontSize <= 10 ? '4px' : '6px',
          backgroundColor: 'var(--card)',
          border: `1px solid ${edgeColor}`,
          color: 'var(--foreground)',
          whiteSpace: 'nowrap',
          lineHeight: 1,
          boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
        }"
      >{{ edgeData.label }}</span>
    </div>

    <!-- Flow sequence badge -->
    <div
      v-if="badgePos && !isExportMode"
      class="nodrag nopan flow-badge"
      :style="{
        position: 'absolute',
        transform: `translate(-50%, -50%) translate(${badgePos.x}px, ${badgePos.y}px)`,
        pointerEvents: 'none',
      }"
    >
      <span
        :style="{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '18px',
          height: '18px',
          borderRadius: '50%',
          fontSize: '8px',
          fontWeight: 700,
          fontFamily: 'ui-monospace, monospace',
          backgroundColor: 'var(--card)',
          border: `1.5px solid ${edgeColor}`,
          color: 'var(--foreground)',
          boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
        }"
      >{{ flowLevel + 1 }}</span>
    </div>
  </EdgeLabelRenderer>
</template>
