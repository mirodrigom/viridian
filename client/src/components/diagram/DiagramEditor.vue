<script setup lang="ts">
import { ref, watch, nextTick, onMounted, onUnmounted, computed } from 'vue';
import { VueFlow, useVueFlow, MarkerType } from '@vue-flow/core';
import { MiniMap } from '@vue-flow/minimap';
import { Controls } from '@vue-flow/controls';
import { Background } from '@vue-flow/background';
import type { Connection, NodeDragEvent } from '@vue-flow/core';
import { useDiagramsStore, type DiagramNodeType, type DiagramEdgeData } from '@/stores/diagrams';
import { useChatStore } from '@/stores/chat';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { Button } from '@/components/ui/button';
import { Plus, X } from 'lucide-vue-next';
import { toast } from 'vue-sonner';

import DiagramToolbar from './DiagramToolbar.vue';
import NodePalette from './NodePalette.vue';
import PropertiesPanel from './PropertiesPanel.vue';
import SaveDiagramDialog from './dialogs/SaveDiagramDialog.vue';
import LoadDiagramDialog from './dialogs/LoadDiagramDialog.vue';
import AWSServiceNode from './nodes/AWSServiceNode.vue';
import AWSGroupNode from './nodes/AWSGroupNode.vue';
import AnimatedFlowEdge from './edges/AnimatedFlowEdge.vue';
import ExportGifDialog from './dialogs/ExportGifDialog.vue';

import '@vue-flow/core/dist/style.css';
import '@vue-flow/core/dist/theme-default.css';
import '@vue-flow/minimap/dist/style.css';
import '@vue-flow/controls/dist/style.css';
import '@vue-flow/node-resizer/dist/style.css';

const diagrams = useDiagramsStore();
const chat = useChatStore();
const showSaveDialog = ref(false);
const showLoadDialog = ref(false);
const showGifDialog = ref(false);
const flowContainer = ref<HTMLDivElement>();
const snapToGrid = ref(true);
const hoveredGroupId = ref<string | null>(null);

// Mobile responsive
const isMobile = ref(false);
const showMobilePalette = ref(false);

// Multi-select count
const selectedCount = computed(() => {
  return getSelectedNodes.value.length;
});

function onResize() {
  isMobile.value = window.innerWidth < 768;
  if (!isMobile.value) {
    showMobilePalette.value = false;
  }
}

const {
  fitView, onConnect, onNodeDragStop, onPaneClick, onNodeClick, onEdgeClick,
  addNodes, removeNodes, addEdges, removeEdges, project,
  getNodes, getSelectedNodes, setNodes, setEdges, findNode,
  getViewport, setViewport, onNodeDragStart,
} = useVueFlow('diagram-editor');

// ─── Sync VueFlow when store changes ──────────────────────────────
watch(
  () => diagrams.diagramVersion,
  async () => {
    // Sort: group nodes before service nodes for correct z-order
    const sorted = [...diagrams.nodes].sort((a, b) => {
      if (a.parentNode && !b.parentNode) return 1;
      if (!a.parentNode && b.parentNode) return -1;
      return 0;
    });
    setNodes(sorted.map(n => ({ ...n })));
    setEdges(diagrams.edges.map(e => ({ ...e })));
    await nextTick();
    setTimeout(() => {
      if (diagrams.savedViewport) {
        setViewport(diagrams.savedViewport);
      } else {
        fitView();
      }
    }, 50);
  },
);

// ─── Sync individual node data changes ──────────────────────────────
watch(
  () => diagrams.nodes.map(n => n.data),
  () => {
    for (const storeNode of diagrams.nodes) {
      const vfNode = findNode(storeNode.id);
      if (vfNode && vfNode.data !== storeNode.data) {
        vfNode.data = storeNode.data;
      }
    }
  },
  { deep: true },
);

// ─── Events ──────────────────────────────────────────────────────────

onConnect((connection: Connection) => {
  diagrams.addEdge(connection);
  const lastEdge = diagrams.edges[diagrams.edges.length - 1];
  if (lastEdge) addEdges([lastEdge]);
});

onNodeDragStop((event: NodeDragEvent) => {
  for (const node of event.nodes) {
    diagrams.updateNodePosition(node.id, node.position);

    // Check if a service node was dropped onto a group
    if (node.type === 'aws-service' && !node.parentNode) {
      const absPos = node.position;
      const groupId = diagrams.findGroupAtPosition(absPos, node.id);
      if (groupId) {
        diagrams.setNodeParent(node.id, groupId);
        // Force VueFlow to re-render with the new parent
        const storeNode = diagrams.nodes.find(n => n.id === node.id);
        if (storeNode) {
          const vfNode = findNode(node.id);
          if (vfNode) {
            vfNode.parentNode = storeNode.parentNode;
            vfNode.extent = storeNode.extent as 'parent' | undefined;
            vfNode.position = { ...storeNode.position };
          }
        }
      }
    }
  }
  hoveredGroupId.value = null;
});

onPaneClick(() => {
  diagrams.selectNode(null);
  diagrams.selectEdge(null);
});

onNodeClick(({ node }) => {
  diagrams.selectNode(node.id);
});

onEdgeClick(({ edge }) => {
  diagrams.selectEdge(edge.id);
});

// ─── Drop handler ────────────────────────────────────────────────────

function onDragOver(event: DragEvent) {
  event.preventDefault();
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move';
  }
}

function onDrop(event: DragEvent) {
  if (!event.dataTransfer) return;
  const type = event.dataTransfer.getData('application/diagram-type') as string;
  const itemId = event.dataTransfer.getData('application/diagram-id');
  if (!type || !itemId) return;

  const el = flowContainer.value;
  if (!el) return;

  const bounds = el.getBoundingClientRect();
  const position = project({
    x: event.clientX - bounds.left,
    y: event.clientY - bounds.top,
  });

  let nodeId: string;
  if (type === 'service') {
    nodeId = diagrams.addServiceNode(itemId, position);
  } else if (type === 'group') {
    nodeId = diagrams.addGroupNode(itemId, position);
  } else {
    return;
  }

  // Check if dropped onto a group container
  if (type === 'service') {
    const groupId = diagrams.findGroupAtPosition(position, nodeId);
    if (groupId) {
      diagrams.setNodeParent(nodeId, groupId);
    }
  }

  const node = diagrams.nodes.find(n => n.id === nodeId);
  if (node) {
    addNodes([{ ...node }]);
  }
  hoveredGroupId.value = null;
}

// ─── Keyboard shortcuts ──────────────────────────────────────────────

function onKeyDown(event: KeyboardEvent) {
  const tag = (event.target as HTMLElement).tagName;
  const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

  // Ctrl+A / Cmd+A: select all nodes
  if ((event.ctrlKey || event.metaKey) && event.key === 'a' && !isInput) {
    event.preventDefault();
    for (const node of getNodes.value) {
      node.selected = true;
    }
    return;
  }

  if (event.key === 'Delete' || event.key === 'Backspace') {
    if (isInput) return;

    // Multi-select delete
    const selected = getSelectedNodes.value;
    if (selected.length > 0) {
      for (const node of selected) {
        const connectedEdges = diagrams.edges.filter(e => e.source === node.id || e.target === node.id);
        if (connectedEdges.length) removeEdges(connectedEdges);
      }
      removeNodes(selected);
      diagrams.removeSelectedNodes(selected.map(n => n.id));
      diagrams.selectNode(null);
    } else if (diagrams.selectedNodeId) {
      const id = diagrams.selectedNodeId;
      const connectedEdges = diagrams.edges.filter(e => e.source === id || e.target === id);
      if (connectedEdges.length) removeEdges(connectedEdges);
      const vfNode = getNodes.value.find(n => n.id === id);
      if (vfNode) removeNodes([vfNode]);
      diagrams.removeNode(id);
    } else if (diagrams.selectedEdgeId) {
      const id = diagrams.selectedEdgeId;
      const edge = diagrams.edges.find(e => e.id === id);
      if (edge) removeEdges([edge]);
      diagrams.removeEdge(id);
    }
  }

  if (event.key === 'Escape') {
    diagrams.selectNode(null);
    diagrams.selectEdge(null);
    // Deselect all
    for (const node of getNodes.value) {
      node.selected = false;
    }
  }
}

onMounted(() => {
  document.addEventListener('keydown', onKeyDown);
  onResize();
  window.addEventListener('resize', onResize);
});

onUnmounted(() => {
  document.removeEventListener('keydown', onKeyDown);
  window.removeEventListener('resize', onResize);
});

// ─── Toolbar actions ─────────────────────────────────────────────────

function toggleSnapToGrid() {
  snapToGrid.value = !snapToGrid.value;
}

function onNew() {
  diagrams.newDiagram();
}

function onSave() {
  diagrams.savedViewport = getViewport();
  showSaveDialog.value = true;
}

function exportJson() {
  const data = diagrams.serialize(getViewport());
  const json = JSON.stringify({ name: diagrams.currentDiagramName, ...data }, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${diagrams.currentDiagramName.replace(/\s+/g, '-').toLowerCase()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast.success('Diagram exported as JSON');
}

async function exportPng() {
  try {
    const el = flowContainer.value?.querySelector('.vue-flow__viewport') as HTMLElement | null;
    if (!el) { toast.error('Cannot find canvas element'); return; }

    // Use the canvas API approach via svg foreignObject
    const { width, height } = el.getBoundingClientRect();
    const canvas = document.createElement('canvas');
    canvas.width = width * 2;
    canvas.height = height * 2;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Serialize the SVG content
    const svgEl = el.querySelector('svg');
    if (!svgEl) {
      // Fallback: serialize full HTML
      toast.info('PNG export requires html2canvas (not installed). Use JSON or SVG export instead.');
      return;
    }

    const serializer = new XMLSerializer();
    const svgStr = serializer.serializeToString(svgEl);
    const svgBlob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
    const svgUrl = URL.createObjectURL(svgBlob);

    const img = new Image();
    img.onload = () => {
      ctx.scale(2, 2);
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--background') || '#0a0a0a';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${diagrams.currentDiagramName.replace(/\s+/g, '-').toLowerCase()}.png`;
        a.click();
        URL.revokeObjectURL(url);
        toast.success('Diagram exported as PNG');
      });
      URL.revokeObjectURL(svgUrl);
    };
    img.src = svgUrl;
  } catch {
    toast.error('PNG export failed');
  }
}

function exportSvg() {
  try {
    const el = flowContainer.value?.querySelector('.vue-flow__viewport svg') as SVGElement | null;
    if (!el) {
      toast.error('Cannot find SVG element');
      return;
    }

    const serializer = new XMLSerializer();
    const svgStr = serializer.serializeToString(el);
    const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${diagrams.currentDiagramName.replace(/\s+/g, '-').toLowerCase()}.svg`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Diagram exported as SVG');
  } catch {
    toast.error('SVG export failed');
  }
}
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- Desktop layout -->
    <ResizablePanelGroup v-if="!isMobile" direction="horizontal" class="flex-1">
      <!-- Left sidebar: Palette -->
      <ResizablePanel :default-size="14" :min-size="10" :max-size="22">
        <div class="flex h-full flex-col border-r border-border">
          <NodePalette />
        </div>
      </ResizablePanel>

      <ResizableHandle />

      <!-- Canvas -->
      <ResizablePanel
        :default-size="(diagrams.selectedNode || diagrams.selectedEdge) ? 66 : 86"
        :min-size="30"
      >
        <div class="flex h-full flex-col">
          <DiagramToolbar
            :snap-to-grid="snapToGrid"
            :selected-count="selectedCount"
            @fit-view="fitView()"
            @save="onSave"
            @load="showLoadDialog = true"
            @new="onNew"
            @export-png="exportPng"
            @export-svg="exportSvg"
            @export-json="exportJson"
            @export-gif="showGifDialog = true"
            @toggle-snap="toggleSnapToGrid"
            @collapse-all="diagrams.collapseAllGroups()"
            @expand-all="diagrams.expandAllGroups()"
          />

          <div
            ref="flowContainer"
            class="vue-flow-wrapper flex-1"
            @dragover="onDragOver"
            @drop="onDrop"
          >
            <VueFlow
              id="diagram-editor"
              :fit-view-on-init="true"
              :snap-to-grid="snapToGrid"
              :snap-grid="[15, 15]"
              :selection-on-drag="true"
              :pan-on-drag="[1, 2]"
              :multi-selection-key-code="['Shift']"
              :delete-key-code="null"
              class="diagram-canvas"
            >
              <template #node-aws-service="nodeProps"><AWSServiceNode v-bind="nodeProps" :hovered-group-id="hoveredGroupId" /></template>
              <template #node-aws-group="nodeProps"><AWSGroupNode v-bind="nodeProps" :hovered-group-id="hoveredGroupId" /></template>
              <template #edge-animated-flow="edgeProps"><AnimatedFlowEdge v-bind="edgeProps" /></template>

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

      <!-- Right sidebar: Properties Panel -->
      <template v-if="diagrams.selectedNode || diagrams.selectedEdge">
        <ResizableHandle />
        <ResizablePanel :default-size="20" :min-size="15" :max-size="30">
          <PropertiesPanel class="h-full" />
        </ResizablePanel>
      </template>
    </ResizablePanelGroup>

    <!-- Mobile layout -->
    <template v-else>
      <div class="relative flex flex-1 flex-col">
        <DiagramToolbar
          :snap-to-grid="snapToGrid"
          :selected-count="selectedCount"
          @fit-view="fitView()"
          @save="onSave"
          @load="showLoadDialog = true"
          @new="onNew"
          @export-png="exportPng"
          @export-svg="exportSvg"
          @export-json="exportJson"
          @export-gif="showGifDialog = true"
          @toggle-snap="toggleSnapToGrid"
          @collapse-all="diagrams.collapseAllGroups()"
          @expand-all="diagrams.expandAllGroups()"
        />

        <div
          ref="flowContainer"
          class="vue-flow-wrapper flex-1"
          @dragover="onDragOver"
          @drop="onDrop"
        >
          <VueFlow
            id="diagram-editor"
            :fit-view-on-init="true"
            :snap-to-grid="snapToGrid"
            :snap-grid="[15, 15]"
            :selection-on-drag="true"
            :pan-on-drag="[1, 2]"
            :multi-selection-key-code="['Shift']"
            :delete-key-code="null"
            class="diagram-canvas"
          >
            <template #node-aws-service="nodeProps"><AWSServiceNode v-bind="nodeProps" :hovered-group-id="hoveredGroupId" /></template>
            <template #node-aws-group="nodeProps"><AWSGroupNode v-bind="nodeProps" :hovered-group-id="hoveredGroupId" /></template>
            <template #edge-animated-flow="edgeProps"><AnimatedFlowEdge v-bind="edgeProps" /></template>

            <Background :gap="15" :size="1" pattern-color="var(--border)" />
            <MiniMap class="!bottom-16 !right-4" :node-color="() => 'var(--primary)'" :mask-color="'oklch(0.13 0.012 155 / 80%)'" />
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
            <div class="flex items-center justify-between border-b border-border px-4 py-3">
              <span class="text-sm font-medium">Add Service</span>
              <Button variant="ghost" size="sm" class="h-7 w-7 p-0" @click="showMobilePalette = false">
                <X class="h-4 w-4" />
              </Button>
            </div>
            <NodePalette />
          </div>
        </Transition>

        <!-- Properties bottom sheet -->
        <Transition name="fade">
          <div v-if="diagrams.selectedNode || diagrams.selectedEdge" class="absolute inset-0 z-20 bg-black/50" @click="diagrams.selectNode(null); diagrams.selectEdge(null)" />
        </Transition>
        <Transition name="slide-up">
          <div v-if="diagrams.selectedNode || diagrams.selectedEdge" class="absolute bottom-0 left-0 right-0 z-30 max-h-[60%] overflow-y-auto rounded-t-xl border-t border-border bg-background shadow-xl">
            <div class="flex items-center justify-between border-b border-border px-4 py-3">
              <span class="text-sm font-medium">Properties</span>
              <Button variant="ghost" size="sm" class="h-7 w-7 p-0" @click="diagrams.selectNode(null); diagrams.selectEdge(null)">
                <X class="h-4 w-4" />
              </Button>
            </div>
            <PropertiesPanel />
          </div>
        </Transition>
      </div>
    </template>

    <!-- Dialogs -->
    <SaveDiagramDialog v-model:open="showSaveDialog" />
    <LoadDiagramDialog v-model:open="showLoadDialog" />
    <ExportGifDialog v-model:open="showGifDialog" :flow-container="flowContainer" />
  </div>
</template>

<style>
/* ─── VueFlow theme overrides for diagram canvas ─── */
.diagram-canvas {
  --vf-node-bg: var(--card);
  --vf-node-text: var(--card-foreground);
  --vf-node-color: var(--foreground);
  --vf-edge: var(--primary);
  --vf-handle: var(--primary);
  --vf-connection-path: var(--primary);
  --vf-box-shadow: none;
}

.diagram-canvas .vue-flow__node {
  border: none;
  background: transparent;
  padding: 0;
  box-shadow: none;
}

.diagram-canvas .vue-flow__handle {
  border-color: var(--card);
}

.diagram-canvas .vue-flow__edge-path {
  stroke: var(--primary);
  stroke-width: 1.5;
}

.diagram-canvas .vue-flow__connection-path {
  stroke: var(--primary);
  stroke-dasharray: 5 5;
}

.diagram-canvas .vue-flow__minimap {
  background-color: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
}

.diagram-canvas .vue-flow__controls {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
}

.diagram-canvas .vue-flow__controls-button {
  background-color: var(--card);
  color: var(--foreground);
  border-color: var(--border);
  fill: var(--foreground);
}

.diagram-canvas .vue-flow__controls-button:hover {
  background-color: var(--accent);
}

.diagram-canvas .vue-flow__background {
  background-color: var(--background);
}

/* ─── Selection box ─── */
.diagram-canvas .vue-flow__selection {
  background: oklch(0.65 0.15 155 / 8%);
  border: 1px solid oklch(0.65 0.15 155 / 40%);
  border-radius: 4px;
}

/* ─── Animated edge flow ─── */
.diagram-canvas .vue-flow__edge-path.animated-edge {
  stroke-dasharray: 8 4;
  animation: edge-flow 0.6s linear infinite;
}

@keyframes edge-flow {
  to {
    stroke-dashoffset: -12;
  }
}

/* ─── Edge style variants ─── */
.diagram-canvas .vue-flow__edge-path[data-style="dashed"] {
  stroke-dasharray: 8 4;
}
.diagram-canvas .vue-flow__edge-path[data-style="dotted"] {
  stroke-dasharray: 2 4;
}
</style>
