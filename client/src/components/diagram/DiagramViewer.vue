<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import { VueFlow, useVueFlow } from '@vue-flow/core';
import { MiniMap } from '@vue-flow/minimap';
import { Controls } from '@vue-flow/controls';
import { Background } from '@vue-flow/background';
import type { Node, Edge } from '@vue-flow/core';

import AWSServiceNode from './nodes/AWSServiceNode.vue';
import AWSGroupNode from './nodes/AWSGroupNode.vue';
import AnimatedFlowEdge from './edges/AnimatedFlowEdge.vue';

import { getServiceById, AWS_GROUP_TYPES } from '@/data/aws-services';
import type {
  DiagramNodeData,
  AWSServiceNodeData,
  AWSGroupNodeData,
  DiagramEdgeData,
  SerializedDiagramNode,
  SerializedDiagramEdge,
} from '@/stores/diagrams';

import '@vue-flow/core/dist/style.css';
import '@vue-flow/core/dist/theme-default.css';
import '@vue-flow/minimap/dist/style.css';
import '@vue-flow/controls/dist/style.css';

const props = defineProps<{
  nodes: SerializedDiagramNode[];
  edges: SerializedDiagramEdge[];
  viewport?: { x: number; y: number; zoom: number } | null;
}>();

const flowNodes = ref<Node[]>([]);
const flowEdges = ref<Edge[]>([]);

const { fitView, setViewport } = useVueFlow('diagram-viewer');

function hydrateNodes(serialized: SerializedDiagramNode[]): Node[] {
  const nodes: Node[] = serialized.map(n => {
    const data = { ...n.data };
    if (data.nodeType === 'aws-service') {
      const svc = getServiceById((data as AWSServiceNodeData).serviceId);
      if (svc) (data as AWSServiceNodeData).service = svc;
    } else if (data.nodeType === 'aws-group') {
      const gt = AWS_GROUP_TYPES.find(g => g.id === (data as AWSGroupNodeData).groupTypeId);
      if (gt) (data as AWSGroupNodeData).groupType = gt;
    }

    return {
      id: n.id,
      type: n.data.nodeType,
      position: n.position,
      data,
      ...(n.parentNode && { parentNode: n.parentNode }),
      ...(n.extent && { extent: n.extent as 'parent' }),
      ...(n.style && { style: n.style }),
      ...(n.zIndex != null && { zIndex: n.zIndex }),
    };
  });

  // Auto-set z-index based on nesting depth
  for (const node of nodes) {
    let depth = 0;
    let current: typeof node | undefined = node;
    while (current?.parentNode) {
      depth++;
      current = nodes.find(n => n.id === current!.parentNode);
      if (depth > 10) break;
    }
    if (depth > 0) {
      const currentZ = (node as any).zIndex ?? 0;
      if (currentZ < depth * 10) {
        (node as any).zIndex = depth * 10;
      }
    }
  }

  return nodes;
}

function hydrateEdges(serialized: SerializedDiagramEdge[]): Edge[] {
  return serialized.map(e => {
    const d: DiagramEdgeData = {
      ...e.data,
      label: e.data?.label ?? '',
      style: e.data?.style ?? 'solid',
      animated: e.data?.animated ?? false,
      notes: e.data?.notes ?? '',
      edgeType: e.data?.edgeType ?? 'default',
      color: e.data?.color ?? '',
      markerStart: e.data?.markerStart ?? 'none',
      markerEnd: e.data?.markerEnd ?? 'arrowclosed',
      dotAnimation: e.data?.dotAnimation ?? false,
      dotCount: e.data?.dotCount ?? 1,
      dotSpeed: e.data?.dotSpeed ?? 'medium',
      dotColor: e.data?.dotColor ?? '',
      labelSize: e.data?.labelSize ?? 'small',
      dotDirection: e.data?.dotDirection ?? 'forward',
    };
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle ?? undefined,
      targetHandle: e.targetHandle ?? undefined,
      type: (d.dotAnimation && d.animated) ? 'animated-flow' : (d.edgeType || 'default'),
      data: d,
      label: d.label || '',
      animated: d.animated,
      markerStart: d.markerStart !== 'none' ? { type: d.markerStart === 'arrow' ? 'arrow' as any : 'arrowclosed' as any, color: d.color || undefined } : undefined,
      markerEnd: d.markerEnd !== 'none' ? { type: d.markerEnd === 'arrow' ? 'arrow' as any : 'arrowclosed' as any, color: d.color || undefined } : undefined,
      ...(d.color ? { style: { stroke: d.color } } : {}),
    };
  });
}

function loadDiagram() {
  flowNodes.value = hydrateNodes(props.nodes);
  flowEdges.value = hydrateEdges(props.edges);

  setTimeout(() => {
    if (props.viewport) {
      setViewport(props.viewport);
    } else {
      fitView();
    }
  }, 100);
}

watch(() => [props.nodes, props.edges], loadDiagram, { deep: true });
onMounted(loadDiagram);
</script>

<template>
  <div class="diagram-viewer h-full w-full">
    <VueFlow
      id="diagram-viewer"
      v-model:nodes="flowNodes"
      v-model:edges="flowEdges"
      :fit-view-on-init="!props.viewport"
      :nodes-draggable="false"
      :nodes-connectable="false"
      :elements-selectable="false"
      :pan-on-drag="true"
      :zoom-on-scroll="true"
      :delete-key-code="null"
      class="diagram-canvas"
    >
      <template #node-aws-service="nodeProps"><AWSServiceNode v-bind="nodeProps" :hovered-group-id="null" /></template>
      <template #node-aws-group="nodeProps"><AWSGroupNode v-bind="nodeProps" :hovered-group-id="null" /></template>
      <template #edge-animated-flow="edgeProps"><AnimatedFlowEdge v-bind="edgeProps" /></template>

      <Background :gap="15" :size="1" pattern-color="var(--border)" />
      <MiniMap
        class="!top-4 !right-4 !bottom-auto"
        :node-color="() => 'var(--primary)'"
        :mask-color="'rgba(19, 24, 20, 0.8)'"
      />
      <Controls class="!bottom-4 !left-4" />
    </VueFlow>
  </div>
</template>

<style>
/* Reuse the same diagram-canvas styles from DiagramEditor */
.diagram-viewer .diagram-canvas {
  --vf-node-bg: var(--card);
  --vf-node-text: var(--card-foreground);
  --vf-node-color: var(--foreground);
  --vf-edge: var(--primary);
  --vf-handle: var(--primary);
  --vf-connection-path: var(--primary);
  --vf-box-shadow: none;
}

.diagram-viewer .diagram-canvas .vue-flow__node {
  border: none;
  background: transparent;
  padding: 0;
  box-shadow: none;
}

.diagram-viewer .diagram-canvas .vue-flow__handle {
  border-color: var(--card);
  width: 10px;
  height: 10px;
}

.diagram-viewer .diagram-canvas .vue-flow__edge-path {
  stroke: var(--primary);
  stroke-width: 1.5;
}

.diagram-viewer .diagram-canvas .vue-flow__minimap {
  background-color: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
}

.diagram-viewer .diagram-canvas .vue-flow__controls {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
}

.diagram-viewer .diagram-canvas .vue-flow__controls-button {
  background-color: var(--card);
  color: var(--foreground);
  border-color: var(--border);
  fill: var(--foreground);
}

.diagram-viewer .diagram-canvas .vue-flow__controls-button:hover {
  background-color: var(--accent);
}

.diagram-viewer .diagram-canvas .vue-flow__background {
  background-color: var(--background);
}

.diagram-viewer .diagram-canvas .vue-flow__node-aws-group {
  pointer-events: none;
}
.diagram-viewer .diagram-canvas .vue-flow__node-aws-group .vue-flow__handle {
  pointer-events: auto;
}
</style>
