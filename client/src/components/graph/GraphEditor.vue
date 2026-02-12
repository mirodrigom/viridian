<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { VueFlow, useVueFlow } from '@vue-flow/core';
import { MiniMap } from '@vue-flow/minimap';
import { Controls } from '@vue-flow/controls';
import { Background } from '@vue-flow/background';
import type { Connection, NodeDragEvent } from '@vue-flow/core';
import type { GraphNodeType } from '@/types/graph';
import { useGraphStore } from '@/stores/graph';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';

import GraphToolbar from './GraphToolbar.vue';
import GraphPalette from './GraphPalette.vue';
import GraphPropertiesPanel from './GraphPropertiesPanel.vue';
import SaveGraphDialog from './dialogs/SaveGraphDialog.vue';
import LoadGraphDialog from './dialogs/LoadGraphDialog.vue';

import AgentNode from './nodes/AgentNode.vue';
import SubagentNode from './nodes/SubagentNode.vue';
import ExpertNode from './nodes/ExpertNode.vue';
import SkillNode from './nodes/SkillNode.vue';
import McpNode from './nodes/McpNode.vue';
import RuleNode from './nodes/RuleNode.vue';
import CustomEdge from './edges/CustomEdge.vue';

import '@vue-flow/core/dist/style.css';
import '@vue-flow/core/dist/theme-default.css';
import '@vue-flow/minimap/dist/style.css';
import '@vue-flow/controls/dist/style.css';

const graph = useGraphStore();
const showSaveDialog = ref(false);
const showLoadDialog = ref(false);
const flowContainer = ref<HTMLDivElement>();

const {
  fitView, onConnect, onNodeDragStop, onPaneClick, onNodeClick,
  addNodes, removeNodes, addEdges, removeEdges, project,
  getNodes,
} = useVueFlow({
  defaultEdgeOptions: { type: 'custom' },
  connectionMode: 1, // ConnectionMode.Loose
  fitViewOnInit: true,
});

// ─── Events ─────────────────────────────────────────────────────────

onConnect((connection: Connection) => {
  graph.addEdge(connection);
  // Sync edge to VueFlow
  const lastEdge = graph.edges[graph.edges.length - 1];
  if (lastEdge) addEdges([lastEdge]);
});

onNodeDragStop((event: NodeDragEvent) => {
  for (const node of event.nodes) {
    graph.updateNodePosition(node.id, node.position);
  }
});

onPaneClick(() => {
  graph.selectNode(null);
});

onNodeClick(({ node }) => {
  graph.selectNode(node.id);
});

// ─── Drop handler ───────────────────────────────────────────────────

function onDragOver(event: DragEvent) {
  event.preventDefault();
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move';
  }
}

function onDrop(event: DragEvent) {
  if (!event.dataTransfer) return;
  const type = event.dataTransfer.getData('application/vueflow') as GraphNodeType;
  if (!type) return;

  const el = flowContainer.value;
  if (!el) return;

  const bounds = el.getBoundingClientRect();
  const position = project({
    x: event.clientX - bounds.left,
    y: event.clientY - bounds.top,
  });

  // Add to store (for persistence/serialization)
  const id = graph.addNode(type, position);

  // Add to VueFlow (for rendering)
  const node = graph.nodes.find(n => n.id === id);
  if (node) {
    addNodes([{ ...node }]);
  }
}

// ─── Keyboard shortcuts ─────────────────────────────────────────────

function onKeyDown(event: KeyboardEvent) {
  if (event.key === 'Delete' || event.key === 'Backspace') {
    // Don't delete if user is typing in an input
    const tag = (event.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    if (graph.selectedNodeId) {
      const id = graph.selectedNodeId;
      // Remove edges connected to this node from VueFlow
      const connectedEdges = graph.edges.filter(e => e.source === id || e.target === id);
      if (connectedEdges.length) removeEdges(connectedEdges);
      // Remove node from VueFlow
      const vfNode = getNodes.value.find(n => n.id === id);
      if (vfNode) removeNodes([vfNode]);
      // Remove from store
      graph.removeNode(id);
    }
  }

  if (event.key === 'Escape') {
    graph.selectNode(null);
  }
}

onMounted(() => {
  document.addEventListener('keydown', onKeyDown);
});

onUnmounted(() => {
  document.removeEventListener('keydown', onKeyDown);
});

// ─── Connection validation ──────────────────────────────────────────

function isValidConnection(connection: Connection): boolean {
  return graph.canConnect(connection);
}
</script>

<template>
  <div class="flex h-full flex-col">
    <GraphToolbar
      @fit-view="fitView()"
      @save="showSaveDialog = true"
      @load="showLoadDialog = true"
    />

    <ResizablePanelGroup direction="horizontal" class="flex-1">
      <!-- Palette -->
      <ResizablePanel :default-size="16" :min-size="12" :max-size="25">
        <GraphPalette />
      </ResizablePanel>

      <ResizableHandle />

      <!-- Canvas -->
      <ResizablePanel :default-size="58" :min-size="35">
        <div
          ref="flowContainer"
          class="vue-flow-wrapper h-full"
          @dragover="onDragOver"
          @drop="onDrop"
        >
          <VueFlow
            :is-valid-connection="isValidConnection"
            :snap-to-grid="true"
            :snap-grid="[15, 15]"
            class="graph-canvas"
          >
            <!-- Custom nodes -->
            <template #node-agent="nodeProps">
              <AgentNode v-bind="nodeProps" />
            </template>
            <template #node-subagent="nodeProps">
              <SubagentNode v-bind="nodeProps" />
            </template>
            <template #node-expert="nodeProps">
              <ExpertNode v-bind="nodeProps" />
            </template>
            <template #node-skill="nodeProps">
              <SkillNode v-bind="nodeProps" />
            </template>
            <template #node-mcp="nodeProps">
              <McpNode v-bind="nodeProps" />
            </template>
            <template #node-rule="nodeProps">
              <RuleNode v-bind="nodeProps" />
            </template>

            <!-- Custom edges -->
            <template #edge-custom="edgeProps">
              <CustomEdge v-bind="edgeProps" />
            </template>

            <Background :gap="15" :size="1" pattern-color="var(--border)" />
            <MiniMap
              class="!bottom-4 !right-4"
              :node-color="() => 'var(--primary)'"
              :mask-color="'oklch(0.13 0.012 155 / 80%)'"
            />
            <Controls class="!bottom-4 !left-4" />
          </VueFlow>
        </div>
      </ResizablePanel>

      <ResizableHandle />

      <!-- Properties -->
      <ResizablePanel :default-size="26" :min-size="18" :max-size="40">
        <GraphPropertiesPanel />
      </ResizablePanel>
    </ResizablePanelGroup>

    <!-- Dialogs -->
    <SaveGraphDialog v-model:open="showSaveDialog" />
    <LoadGraphDialog v-model:open="showLoadDialog" />
  </div>
</template>

<style>
/* ─── VueFlow theme overrides for dark/green palette ─── */
.graph-canvas {
  --vf-node-bg: var(--card);
  --vf-node-text: var(--card-foreground);
  --vf-node-color: var(--foreground);
  --vf-edge: var(--primary);
  --vf-handle: var(--primary);
  --vf-connection-path: var(--primary);
  --vf-box-shadow: none;
}

.graph-canvas .vue-flow__node {
  border: none;
  background: transparent;
  padding: 0;
  box-shadow: none;
}

.graph-canvas .vue-flow__handle {
  border-color: var(--card);
}

.graph-canvas .vue-flow__edge-path {
  stroke: var(--primary);
}

.graph-canvas .vue-flow__connection-path {
  stroke: var(--primary);
  stroke-dasharray: 5 5;
}

.graph-canvas .vue-flow__minimap {
  background-color: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
}

.graph-canvas .vue-flow__controls {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
}

.graph-canvas .vue-flow__controls-button {
  background-color: var(--card);
  color: var(--foreground);
  border-color: var(--border);
  fill: var(--foreground);
}

.graph-canvas .vue-flow__controls-button:hover {
  background-color: var(--accent);
}

.graph-canvas .vue-flow__background {
  background-color: var(--background);
}
</style>
