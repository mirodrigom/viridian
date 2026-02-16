<script setup lang="ts">
import { ref, watch, nextTick, onMounted, onUnmounted } from 'vue';
import { VueFlow, useVueFlow } from '@vue-flow/core';
import { MiniMap } from '@vue-flow/minimap';
import { Controls } from '@vue-flow/controls';
import { Background } from '@vue-flow/background';
import type { Connection, NodeDragEvent } from '@vue-flow/core';
import type { GraphNodeType } from '@/types/graph';
import { useGraphStore } from '@/stores/graph';
import { useGraphRunnerStore } from '@/stores/graphRunner';
import { useGraphRunner } from '@/composables/useGraphRunner';
import { useChatStore } from '@/stores/chat';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';

import GraphToolbar from './GraphToolbar.vue';
import GraphPalette from './GraphPalette.vue';
import GraphPropertiesPanel from './GraphPropertiesPanel.vue';
import GraphRunnerPanel from './GraphRunnerPanel.vue';
import GraphTimelineScrubber from './GraphTimelineScrubber.vue';
import SaveGraphDialog from './dialogs/SaveGraphDialog.vue';
import LoadGraphDialog from './dialogs/LoadGraphDialog.vue';
import RunGraphDialog from './dialogs/RunGraphDialog.vue';
import TemplatesDialog from './dialogs/TemplatesDialog.vue';
import ImportGraphDialog from './dialogs/ImportGraphDialog.vue';

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
const runner = useGraphRunnerStore();
const chat = useChatStore();
const { init: initRunner, runGraph, abort: abortRun } = useGraphRunner();
const showSaveDialog = ref(false);
const showLoadDialog = ref(false);
const showRunDialog = ref(false);
const showTemplatesDialog = ref(false);
const showImportDialog = ref(false);
const flowContainer = ref<HTMLDivElement>();

const {
  fitView, onConnect, onNodeDragStop, onPaneClick, onNodeClick,
  addNodes, removeNodes, addEdges, removeEdges, project,
  getNodes, setNodes, setEdges, findNode,
  getViewport, setViewport,
} = useVueFlow({
  defaultEdgeOptions: { type: 'custom' },
  connectionMode: 1, // ConnectionMode.Loose
  fitViewOnInit: true,
});

// ─── Sync VueFlow when store changes (e.g. after loading/clearing a graph) ──
watch(
  () => graph.graphVersion,
  async () => {
    setNodes(graph.nodes.map(n => ({ ...n })));
    setEdges(graph.edges.map(e => ({ ...e })));
    await nextTick();
    // Allow VueFlow to measure and render nodes before adjusting viewport
    setTimeout(() => {
      if (graph.savedViewport) {
        setViewport(graph.savedViewport);
      } else {
        fitView();
      }
    }, 50);
  },
);

// ─── Sync individual node data changes from store → VueFlow ─────────
watch(
  () => graph.nodes.map(n => n.data),
  () => {
    for (const storeNode of graph.nodes) {
      const vfNode = findNode(storeNode.id);
      if (vfNode && vfNode.data !== storeNode.data) {
        vfNode.data = storeNode.data;
      }
    }
  },
  { deep: true },
);

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
  initRunner();
  // Restore last run after page reload
  if (graph.currentGraphId) {
    runner.restoreLastRun(graph.currentGraphId);
  }
});

// Also restore when switching to a different saved graph
watch(
  () => graph.currentGraphId,
  (graphId) => {
    if (graphId) {
      runner.reset();
      runner.restoreLastRun(graphId);
    }
  },
);

onUnmounted(() => {
  document.removeEventListener('keydown', onKeyDown);
});

// ─── Graph Runner ───────────────────────────────────────────────────

async function onRunGraph(prompt: string) {
  const cwd = chat.projectPath || '/home';

  // Auto-save the graph before running so the run gets a valid graphId
  if (!graph.currentGraphId) {
    try {
      await graph.saveGraph(cwd);
    } catch (e) {
      console.warn('[GraphEditor] Auto-save before run failed:', e);
      // Run anyway — the run just won't appear in history
    }
  }

  runGraph(prompt, cwd);
}

// ─── Connection validation ──────────────────────────────────────────

function isValidConnection(connection: Connection): boolean {
  return graph.canConnect(connection);
}
</script>

<template>
  <div class="flex h-full flex-col">
    <ResizablePanelGroup direction="horizontal" class="flex-1">
      <!-- Left sidebar: Palette + Properties -->
      <ResizablePanel :default-size="16" :min-size="12" :max-size="25">
        <div class="flex h-full flex-col border-r border-border">
          <GraphPalette />
          <GraphPropertiesPanel v-if="graph.selectedNode" class="flex-1" />
        </div>
      </ResizablePanel>

      <ResizableHandle />

      <!-- Canvas -->
      <ResizablePanel :default-size="84" :min-size="35">
        <div class="flex h-full flex-col">
          <GraphToolbar
            @fit-view="fitView()"
            @save="graph.savedViewport = getViewport(); showSaveDialog = true"
            @load="showLoadDialog = true"
            @templates="showTemplatesDialog = true"
            @import="showImportDialog = true"
            @run="showRunDialog = true"
            @abort="abortRun()"
          />

          <GraphTimelineScrubber v-if="runner.currentRun" />

          <div
            ref="flowContainer"
            class="vue-flow-wrapper flex-1"
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
        </div>
      </ResizablePanel>

      <!-- Right sidebar: Runner Panel (collapsed by default) -->
      <template v-if="runner.showRunnerPanel">
        <ResizableHandle />
        <ResizablePanel :default-size="26" :min-size="18" :max-size="40">
          <GraphRunnerPanel />
        </ResizablePanel>
      </template>
    </ResizablePanelGroup>

    <!-- Dialogs -->
    <SaveGraphDialog v-model:open="showSaveDialog" />
    <LoadGraphDialog v-model:open="showLoadDialog" />
    <RunGraphDialog v-model:open="showRunDialog" @run="onRunGraph" />
    <TemplatesDialog v-model:open="showTemplatesDialog" />
    <ImportGraphDialog v-model:open="showImportDialog" />
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
