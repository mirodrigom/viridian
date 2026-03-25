<script setup lang="ts">
import { ref, watch, nextTick, onMounted, onUnmounted } from 'vue';
import { VueFlow, useVueFlow } from '@vue-flow/core';
import { MiniMap } from '@vue-flow/minimap';
import { Controls } from '@vue-flow/controls';
import { Background } from '@vue-flow/background';
import type { Connection, NodeDragEvent } from '@vue-flow/core';
import { ConnectionMode } from '@vue-flow/core';
import type { GraphNodeType, RuleNodeData } from '@/types/graph';
import { useGraphStore } from '@/stores/graph';
import { useGraphRunnerStore } from '@/stores/graphRunner';
import { useGraphRunner } from '@/composables/useGraphRunner';
import { useChatStore } from '@/stores/chat';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { Button } from '@/components/ui/button';
import { Plus, X } from 'lucide-vue-next';

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
import ImportProjectAssetsDialog from './dialogs/ImportProjectAssetsDialog.vue';
import SaveToProjectDialog from './dialogs/SaveToProjectDialog.vue';

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
const showImportProjectDialog = ref(false);
const showSaveToProject = ref(false);
const flowContainer = ref<HTMLDivElement>();

// Mobile responsive
const isMobile = ref(false);
const showMobilePalette = ref(false);
const showMobileRunner = ref(false);

function onResize() {
  isMobile.value = window.innerWidth < 768;
  if (!isMobile.value) {
    showMobilePalette.value = false;
    showMobileRunner.value = false;
  }
}

const {
  fitView, onConnect, onNodeDragStop, onPaneClick, onNodeClick,
  addNodes, removeNodes, addEdges, removeEdges, project,
  getNodes, setNodes, setEdges, findNode,
  getViewport, setViewport,
} = useVueFlow('graph-editor');

// ─── Sync VueFlow when store changes (e.g. after loading/clearing a graph) ──
watch(
  () => graph.graphVersion,
  async () => {
    // Sort: parent (container) nodes before children for correct z-order
    const sorted = [...graph.nodes].sort((a, b) => {
      if (a.parentNode && !b.parentNode) return 1;
      if (!a.parentNode && b.parentNode) return -1;
      return 0;
    });
    setNodes(sorted.map(n => ({ ...n })));
    // Hide rule-constraint edges when child is inside the rule container
    setEdges(graph.edges.filter(e => {
      const ed = e.data as { edgeType?: string };
      if (ed?.edgeType === 'rule-constraint') {
        const sourceNode = graph.nodes.find(n => n.id === e.source);
        if (sourceNode?.parentNode === e.target) return false; // containment replaces the edge
      }
      return true;
    }).map(e => ({ ...e })));
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

// ─── Mobile tap-to-add ──────────────────────────────────────────────

function onMobileAddNode(type: GraphNodeType) {
  // Add node at viewport center
  const el = flowContainer.value;
  if (!el) return;
  const bounds = el.getBoundingClientRect();
  const position = project({
    x: bounds.width / 2,
    y: bounds.height / 2,
  });

  const id = graph.addNode(type, position);
  const node = graph.nodes.find(n => n.id === id);
  if (node) addNodes([{ ...node }]);

  graph.selectNode(id);
  showMobilePalette.value = false;
}

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
  onResize();
  window.addEventListener('resize', onResize);
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
  window.removeEventListener('resize', onResize);
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
  <div data-testid="graph-editor" class="flex h-full flex-col">
    <!-- Desktop layout -->
    <ResizablePanelGroup v-if="!isMobile" direction="horizontal" class="flex-1">
      <!-- Left sidebar: Palette only -->
      <ResizablePanel :default-size="12" :min-size="10" :max-size="18">
        <div class="flex h-full flex-col border-r border-border">
          <GraphPalette />
        </div>
      </ResizablePanel>

      <ResizableHandle />

      <!-- Canvas -->
      <ResizablePanel
        :default-size="graph.selectedNode ? (runner.showRunnerPanel ? 46 : 68) : (runner.showRunnerPanel ? 62 : 88)"
        :min-size="30"
      >
        <div class="flex h-full flex-col">
          <GraphToolbar
            @fit-view="fitView()"
            @save="graph.savedViewport = getViewport(); showSaveDialog = true"
            @load="showLoadDialog = true"
            @templates="showTemplatesDialog = true"
            @import="showImportDialog = true"
            @import-project="showImportProjectDialog = true"
            @save-to-project="showSaveToProject = true"
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
            id="graph-editor"
            :default-edge-options="{ type: 'custom' }"
            :connection-mode="ConnectionMode.Loose"
            :fit-view-on-init="true"
            :is-valid-connection="isValidConnection"
            :snap-to-grid="true"
            :snap-grid="[15, 15]"
            class="graph-canvas"
          >
            <template #node-agent="nodeProps"><AgentNode v-bind="nodeProps" /></template>
            <template #node-subagent="nodeProps"><SubagentNode v-bind="nodeProps" /></template>
            <template #node-expert="nodeProps"><ExpertNode v-bind="nodeProps" /></template>
            <template #node-skill="nodeProps"><SkillNode v-bind="nodeProps" /></template>
            <template #node-mcp="nodeProps"><McpNode v-bind="nodeProps" /></template>
            <template #node-rule="nodeProps"><RuleNode v-bind="nodeProps" /></template>
            <template #edge-custom="edgeProps"><CustomEdge v-bind="edgeProps" /></template>

            <Background :gap="15" :size="1" pattern-color="var(--border)" />
            <MiniMap
              class="!bottom-4 !right-4"
              :node-color="(n: any) => (n.data as RuleNodeData)?.isContainer ? 'transparent' : 'var(--primary)'"
              :mask-color="'oklch(0.13 0.012 155 / 80%)'"
            />
            <Controls class="!bottom-4 !left-4" />
          </VueFlow>
          </div>
        </div>
      </ResizablePanel>

      <!-- Right sidebar: Properties Panel (when node selected) -->
      <template v-if="graph.selectedNode">
        <ResizableHandle />
        <ResizablePanel :default-size="20" :min-size="15" :max-size="30">
          <GraphPropertiesPanel class="h-full" />
        </ResizablePanel>
      </template>

      <!-- Right sidebar: Runner Panel (collapsed by default) -->
      <template v-if="runner.showRunnerPanel">
        <ResizableHandle />
        <ResizablePanel :default-size="26" :min-size="18" :max-size="40">
          <GraphRunnerPanel />
        </ResizablePanel>
      </template>
    </ResizablePanelGroup>

    <!-- Mobile layout -->
    <template v-else>
      <div class="relative flex flex-1 flex-col">
        <!-- Toolbar (compact) -->
        <GraphToolbar
          @fit-view="fitView()"
          @save="graph.savedViewport = getViewport(); showSaveDialog = true"
          @load="showLoadDialog = true"
          @templates="showTemplatesDialog = true"
          @import="showImportDialog = true"
          @import-project="showImportProjectDialog = true"
          @save-to-project="showSaveToProject = true"
          @run="showRunDialog = true"
          @abort="abortRun()"
        />

        <GraphTimelineScrubber v-if="runner.currentRun" />

        <!-- Canvas: full width/height -->
        <div
          ref="flowContainer"
          class="vue-flow-wrapper flex-1"
          @dragover="onDragOver"
          @drop="onDrop"
        >
          <VueFlow
            id="graph-editor"
            :default-edge-options="{ type: 'custom' }"
            :connection-mode="ConnectionMode.Loose"
            :fit-view-on-init="true"
            :is-valid-connection="isValidConnection"
            :snap-to-grid="true"
            :snap-grid="[15, 15]"
            class="graph-canvas"
          >
            <template #node-agent="nodeProps"><AgentNode v-bind="nodeProps" /></template>
            <template #node-subagent="nodeProps"><SubagentNode v-bind="nodeProps" /></template>
            <template #node-expert="nodeProps"><ExpertNode v-bind="nodeProps" /></template>
            <template #node-skill="nodeProps"><SkillNode v-bind="nodeProps" /></template>
            <template #node-mcp="nodeProps"><McpNode v-bind="nodeProps" /></template>
            <template #node-rule="nodeProps"><RuleNode v-bind="nodeProps" /></template>
            <template #edge-custom="edgeProps"><CustomEdge v-bind="edgeProps" /></template>

            <Background :gap="15" :size="1" pattern-color="var(--border)" />
            <MiniMap
              class="!bottom-16 !right-4"
              :node-color="(n: any) => (n.data as RuleNodeData)?.isContainer ? 'transparent' : 'var(--primary)'"
              :mask-color="'oklch(0.13 0.012 155 / 80%)'"
            />
            <Controls class="!bottom-16 !left-4" />
          </VueFlow>
        </div>

        <!-- FAB: Add node -->
        <Button
          class="absolute bottom-4 right-4 z-10 h-12 w-12 rounded-full shadow-lg"
          @click="showMobilePalette = true"
        >
          <Plus class="h-5 w-5" />
        </Button>

        <!-- Mobile Palette bottom sheet -->
        <Transition name="fade">
          <div v-if="showMobilePalette" class="absolute inset-0 z-20 bg-black/50" @click="showMobilePalette = false" />
        </Transition>
        <Transition name="slide-up">
          <div v-if="showMobilePalette" class="absolute bottom-0 left-0 right-0 z-30 max-h-[60%] overflow-y-auto rounded-t-xl border-t border-border bg-background shadow-xl">
            <div class="flex items-center justify-between px-4 py-3 border-b border-border">
              <span class="text-sm font-medium">Add Node</span>
              <Button variant="ghost" size="sm" class="h-7 w-7 p-0" @click="showMobilePalette = false">
                <X class="h-4 w-4" />
              </Button>
            </div>
            <GraphPalette :mobile="true" @add-node="onMobileAddNode" />
          </div>
        </Transition>

        <!-- Properties bottom sheet (when node selected) -->
        <Transition name="fade">
          <div v-if="graph.selectedNode" class="absolute inset-0 z-20 bg-black/50" @click="graph.selectNode(null)" />
        </Transition>
        <Transition name="slide-up">
          <div v-if="graph.selectedNode" class="absolute bottom-0 left-0 right-0 z-30 max-h-[60%] overflow-y-auto rounded-t-xl border-t border-border bg-background shadow-xl">
            <div class="flex items-center justify-between px-4 py-3 border-b border-border">
              <span class="text-sm font-medium">Properties</span>
              <Button variant="ghost" size="sm" class="h-7 w-7 p-0" @click="graph.selectNode(null)">
                <X class="h-4 w-4" />
              </Button>
            </div>
            <GraphPropertiesPanel />
          </div>
        </Transition>

        <!-- Runner bottom sheet -->
        <Transition name="fade">
          <div v-if="runner.showRunnerPanel && showMobileRunner" class="absolute inset-0 z-20 bg-black/50" @click="showMobileRunner = false" />
        </Transition>
        <Transition name="slide-up">
          <div v-if="runner.showRunnerPanel && showMobileRunner" class="absolute bottom-0 left-0 right-0 z-30 max-h-[70%] overflow-y-auto rounded-t-xl border-t border-border bg-background shadow-xl">
            <div class="flex items-center justify-between px-4 py-3 border-b border-border">
              <span class="text-sm font-medium">Runner</span>
              <Button variant="ghost" size="sm" class="h-7 w-7 p-0" @click="showMobileRunner = false">
                <X class="h-4 w-4" />
              </Button>
            </div>
            <GraphRunnerPanel />
          </div>
        </Transition>
      </div>
    </template>

    <!-- Dialogs -->
    <SaveGraphDialog v-model:open="showSaveDialog" />
    <LoadGraphDialog v-model:open="showLoadDialog" />
    <RunGraphDialog v-model:open="showRunDialog" @run="onRunGraph" />
    <TemplatesDialog v-model:open="showTemplatesDialog" />
    <ImportGraphDialog v-model:open="showImportDialog" />
    <ImportProjectAssetsDialog v-model:open="showImportProjectDialog" :cwd="chat.projectPath || ''" />
    <SaveToProjectDialog v-model:open="showSaveToProject" />
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
