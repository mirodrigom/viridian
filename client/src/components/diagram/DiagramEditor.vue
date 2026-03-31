<script setup lang="ts">
import { ref, computed, nextTick, onMounted } from 'vue';
import { VueFlow, useVueFlow, SelectionMode } from '@vue-flow/core';
import { MiniMap } from '@vue-flow/minimap';
import { Controls } from '@vue-flow/controls';
import { Background } from '@vue-flow/background';
import { useDiagramsStore } from '@/stores/diagrams';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { Button } from '@/components/ui/button';
import { Plus, X } from 'lucide-vue-next';

import DiagramToolbar from './DiagramToolbar.vue';
import NodePalette from './NodePalette.vue';
import PropertiesPanel from './PropertiesPanel.vue';
import LayersPanel from './LayersPanel.vue';
import ConnectionsPanel from './ConnectionsPanel.vue';
import SaveDiagramDialog from './dialogs/SaveDiagramDialog.vue';
import LoadDiagramDialog from './dialogs/LoadDiagramDialog.vue';
import AWSServiceNode from './nodes/AWSServiceNode.vue';
import AWSGroupNode from './nodes/AWSGroupNode.vue';
import AnimatedFlowEdge from './edges/AnimatedFlowEdge.vue';
import ExportGifDialog from './dialogs/ExportGifDialog.vue';
import ExportVideoDialog from './dialogs/ExportVideoDialog.vue';
import AddCustomServiceDialog from './dialogs/AddCustomServiceDialog.vue';
import ImportDiagramDialog from './dialogs/ImportDiagramDialog.vue';
import DiagramAIChat from './DiagramAIChat.vue';

import { useCanvasExport } from '@/composables/diagram/useCanvasExport';
import { useVueFlowSync } from '@/composables/diagram/useVueFlowSync';
import { useDiagramEvents } from '@/composables/diagram/useDiagramEvents';
import { useMobileResponsive } from '@/composables/diagram/useMobileResponsive';
import { applyDagreLayout } from '@/composables/diagram/useDiagramAutoLayout';
import type { ImportResult } from '@/lib/import';
import { toast } from 'vue-sonner';

import '@vue-flow/core/dist/style.css';
import '@vue-flow/core/dist/theme-default.css';
import '@vue-flow/minimap/dist/style.css';
import '@vue-flow/controls/dist/style.css';
import '@vue-flow/node-resizer/dist/style.css';

const diagrams = useDiagramsStore();
const showSaveDialog = ref(false);
const showLoadDialog = ref(false);
const showGifDialog = ref(false);
const showVideoDialog = ref(false);
const showCustomServiceDialog = ref(false);
const showImportDialog = ref(false);
const flowContainer = ref<HTMLDivElement>();
const aiChatRef = ref<InstanceType<typeof DiagramAIChat> | null>(null);
const snapToGrid = ref(true);
const hoveredGroupId = ref<string | null>(null);

const {
  fitView, onConnect, onNodeDragStop, onPaneClick, onNodeClick, onNodeDoubleClick,
  onEdgeClick, onEdgeDoubleClick,
  addNodes, removeNodes, addEdges, removeEdges, screenToFlowCoordinate,
  getNodes, getEdges, getSelectedNodes, setNodes, setEdges, findNode, findEdge,
  getViewport, setViewport, onNodeDragStart,
} = useVueFlow('diagram-editor');

// ─── Mobile responsive ───────────────────────────────────────────────
const { isMobile, showMobilePalette } = useMobileResponsive();

// ─── Multi-select count ──────────────────────────────────────────────
const selectedCount = computed(() => {
  return getSelectedNodes.value.length;
});

// ─── Inline edge label editing state ─────────────────────────────────
const inlineEdgeEdit = ref<{ edgeId: string; x: number; y: number; label: string } | null>(null);

// ─── Sync VueFlow with store ─────────────────────────────────────────
useVueFlowSync({
  diagrams,
  getNodes,
  getEdges,
  getSelectedNodes,
  setNodes,
  setEdges,
  findNode,
  findEdge,
  removeNodes,
  removeEdges,
  fitView,
  setViewport,
});

// ─── Events (click, drag, drop, keyboard) ────────────────────────────
const { commitInlineEdgeLabel, cancelInlineEdgeLabel, onDragOver, onDrop } = useDiagramEvents({
  diagrams,
  flowContainer,
  hoveredGroupId,
  inlineEdgeEdit,
  onConnect,
  onNodeDragStop,
  onNodeDragStart,
  onPaneClick,
  onNodeClick,
  onNodeDoubleClick,
  onEdgeClick,
  onEdgeDoubleClick,
  addNodes,
  addEdges,
  removeNodes,
  removeEdges,
  screenToFlowCoordinate,
  getNodes,
  getEdges,
  getSelectedNodes,
  findNode,
  findEdge,
});

// ─── Canvas export (PNG, SVG, JSON, draw.io) ─────────────────────────
const { exportJson, exportPng, exportSvg, importJson, exportDrawio, exportPngAsDataUrl } = useCanvasExport({
  flowContainer,
  diagrams,
  getViewport,
  fitView,
  setViewport,
});

// Register the PNG data URL export function so other components can capture diagrams
onMounted(() => {
  diagrams.registerExportPngAsDataUrl(exportPngAsDataUrl);
});

// ─── Toolbar actions ─────────────────────────────────────────────────

function toggleSnapToGrid() {
  snapToGrid.value = !snapToGrid.value;
}

function onNew() {
  diagrams.newDiagram();
}

function onDuplicate() {
  const selected = getSelectedNodes.value;
  const ids = selected.length > 0
    ? selected.map(n => n.id)
    : diagrams.selectedNodeId ? [diagrams.selectedNodeId] : [];
  if (ids.length === 0) return;

  const newIds = diagrams.duplicateNodes(ids, 40, 40);
  if (newIds.length > 0) {
    for (const node of getNodes.value) {
      node.selected = false;
    }
    const newVfNodes = newIds
      .map(id => diagrams.nodes.find(n => n.id === id))
      .filter(Boolean)
      .map(n => ({ ...n! }));
    addNodes(newVfNodes);
    const newEdges = diagrams.edges
      .filter(e => newIds.includes(e.source) && newIds.includes(e.target))
      .map(e => ({ ...e }));
    if (newEdges.length) addEdges(newEdges);
    nextTick(() => {
      for (const id of newIds) {
        const vfNode = findNode(id);
        if (vfNode) vfNode.selected = true;
      }
    });
  }
}

// ─── Mobile tap-to-add ────────────────────────────────────────────────
function onMobileAddNode(type: 'service' | 'group', id: string) {
  const el = flowContainer.value;
  if (!el) return;
  const bounds = el.getBoundingClientRect();
  const position = screenToFlowCoordinate({
    x: bounds.left + bounds.width / 2,
    y: bounds.top + bounds.height / 2,
  });

  let nodeId: string;
  if (type === 'service') {
    nodeId = diagrams.addServiceNode(id, position);
  } else {
    nodeId = diagrams.addGroupNode(id, position);
  }

  if (type === 'service') {
    const groupId = diagrams.findGroupAtPosition(position, nodeId);
    if (groupId) diagrams.setNodeParent(nodeId, groupId);
  }

  const node = diagrams.nodes.find(n => n.id === nodeId);
  if (node) addNodes([{ ...node }]);

  showMobilePalette.value = false;
}

function onAddCustomService(name: string, iconUrl: string, color: string) {
  const el = flowContainer.value;
  if (!el) return;
  const bounds = el.getBoundingClientRect();
  const position = screenToFlowCoordinate({
    x: bounds.left + bounds.width / 2,
    y: bounds.top + bounds.height / 2,
  });

  const nodeId = diagrams.addCustomServiceNode(name, iconUrl, position, color);
  const node = diagrams.nodes.find(n => n.id === nodeId);
  if (node) addNodes([{ ...node }]);

  showMobilePalette.value = false;
}

function onSave() {
  diagrams.savedViewport = getViewport();
  showSaveDialog.value = true;
}

function onAIImport(prompt: string) {
  showImportDialog.value = false;
  aiChatRef.value?.openWithPrompt(prompt);
}

function onImportResult(result: ImportResult, options: { autoLayout: boolean }) {
  // Clear existing diagram and load imported data
  diagrams.newDiagram();

  const config = {
    id: '',
    name: 'Imported Diagram',
    nodes: result.nodes,
    edges: result.edges,
  };

  diagrams.deserialize(config);

  if (options.autoLayout) {
    // Small delay for VueFlow to render nodes before layout
    setTimeout(() => {
      applyDagreLayout(diagrams, () => fitView());
    }, 200);
  } else {
    setTimeout(() => fitView(), 100);
  }

  const source = result.format === 'drawio-xml' ? 'draw.io' : 'Lucidchart';
  toast.success(`Imported ${result.nodes.length} nodes from ${source}`);
}
</script>

<template>
  <div data-testid="diagram-editor" class="flex h-full flex-col">
    <!-- Desktop layout -->
    <ResizablePanelGroup v-if="!isMobile" direction="horizontal" class="flex-1">
      <!-- Left sidebar: Palette + Layers -->
      <ResizablePanel :default-size="14" :min-size="10" :max-size="22">
        <div class="flex h-full flex-col border-r border-border">
          <ResizablePanelGroup direction="vertical">
            <ResizablePanel :default-size="45" :min-size="15">
              <NodePalette @add-custom="showCustomServiceDialog = true" />
            </ResizablePanel>
            <ResizableHandle />
            <ResizablePanel :default-size="30" :min-size="12">
              <LayersPanel />
            </ResizablePanel>
            <ResizableHandle />
            <ResizablePanel :default-size="25" :min-size="12">
              <ConnectionsPanel />
            </ResizablePanel>
          </ResizablePanelGroup>
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
            @import="showImportDialog = true"
            @export-png="exportPng"
            @export-svg="exportSvg"
            @export-json="exportJson"
            @export-gif="showGifDialog = true"
            @export-video="showVideoDialog = true"
            @export-drawio="exportDrawio"

            @import-json="importJson"
            @toggle-snap="toggleSnapToGrid"
            @collapse-all="diagrams.collapseAllGroups()"
            @expand-all="diagrams.expandAllGroups()"
            @duplicate="onDuplicate"
          />

          <div
            ref="flowContainer"
            data-testid="diagram-canvas"
            class="vue-flow-wrapper relative flex-1"
            @dragover="onDragOver"
            @drop="onDrop"
          >
            <VueFlow
              id="diagram-editor"
              :fit-view-on-init="true"
              :snap-to-grid="snapToGrid"
              :snap-grid="[15, 15]"
              :selection-on-drag="true"
              :selection-mode="SelectionMode.Partial"
              :pan-on-drag="[1, 2]"
              :multi-selection-key-code="['Shift']"
              :delete-key-code="null"
              :connection-radius="60"
              :connect-on-click="true"
              :elevate-nodes-on-select="false"
              class="diagram-canvas"
            >
              <template #node-aws-service="nodeProps"><AWSServiceNode v-bind="nodeProps" :hovered-group-id="hoveredGroupId" /></template>
              <template #node-aws-group="nodeProps"><AWSGroupNode v-bind="nodeProps" :hovered-group-id="hoveredGroupId" /></template>
              <template #edge-animated-flow="edgeProps"><AnimatedFlowEdge v-bind="edgeProps" /></template>

              <Background :gap="15" :size="1" pattern-color="var(--border)" />
              <MiniMap
                class="!top-4 !right-4 !bottom-auto"
                :node-color="() => 'var(--primary)'"
                :mask-color="'rgba(19, 24, 20, 0.8)'"
              />
              <Controls class="!bottom-4 !left-4" />
            </VueFlow>

            <!-- Inline edge label editor -->
            <div
              v-if="inlineEdgeEdit"
              class="absolute z-50"
              :style="{ left: inlineEdgeEdit.x + 'px', top: inlineEdgeEdit.y + 'px', transform: 'translate(-50%, -50%)' }"
            >
              <input
                v-model="inlineEdgeEdit.label"
                class="inline-edge-input w-40 rounded-md border border-primary bg-card px-2 py-1 text-xs text-foreground shadow-lg outline-none ring-1 ring-primary"
                placeholder="Edge label..."
                @keydown.enter="commitInlineEdgeLabel"
                @keydown.escape="cancelInlineEdgeLabel"
                @blur="commitInlineEdgeLabel"
              />
            </div>

            <!-- AI Architect chat widget -->
            <DiagramAIChat ref="aiChatRef" :fit-view="() => fitView()" />
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
          @import="showImportDialog = true"
          @export-png="exportPng"
          @export-svg="exportSvg"
          @export-json="exportJson"
          @export-gif="showGifDialog = true"
          @export-video="showVideoDialog = true"
          @export-drawio="exportDrawio"
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
            :connection-radius="60"
            :connect-on-click="true"
            :elevate-nodes-on-select="false"
            class="diagram-canvas"
          >
            <template #node-aws-service="nodeProps"><AWSServiceNode v-bind="nodeProps" :hovered-group-id="hoveredGroupId" /></template>
            <template #node-aws-group="nodeProps"><AWSGroupNode v-bind="nodeProps" :hovered-group-id="hoveredGroupId" /></template>
            <template #edge-animated-flow="edgeProps"><AnimatedFlowEdge v-bind="edgeProps" /></template>

            <Background :gap="15" :size="1" pattern-color="var(--border)" />
            <MiniMap class="!top-4 !right-4 !bottom-auto" :node-color="() => 'var(--primary)'" :mask-color="'rgba(19, 24, 20, 0.8)'" />
            <Controls class="!bottom-16 !left-4" />
          </VueFlow>
        </div>

        <!-- AI Architect chat widget (mobile) -->
        <DiagramAIChat :fit-view="() => fitView()" />

        <!-- FAB: Add node -->
        <Button
          class="absolute bottom-20 right-4 z-10 h-12 w-12 rounded-full shadow-lg"
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
            <NodePalette :mobile="true" @add-node="onMobileAddNode" @add-custom="showCustomServiceDialog = true" />
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
    <ExportGifDialog v-model:open="showGifDialog" :flow-container="flowContainer" :get-viewport="getViewport" />
    <ExportVideoDialog v-model:open="showVideoDialog" :flow-container="flowContainer" :get-viewport="getViewport" />
    <AddCustomServiceDialog v-model:open="showCustomServiceDialog" @add="onAddCustomService" />
    <ImportDiagramDialog v-model:open="showImportDialog" @import="onImportResult" @ai-import="onAIImport" />
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

/* ─── Selection box (rubber-band during drag) ─── */
.diagram-canvas .vue-flow__selection {
  background: rgba(76, 175, 80, 0.08);
  border: 1px solid rgba(76, 175, 80, 0.4);
  border-radius: 4px;
}

/* ─── Selected nodes overlay: allow clicks through to children inside groups ─── */
.diagram-canvas .vue-flow__nodesselection-rect {
  background: rgba(76, 175, 80, 0.08);
  border: 1px solid rgba(76, 175, 80, 0.4);
  border-radius: 4px;
  pointer-events: none;
}

/* ─── Group nodes: let pointer events pass through to child service nodes ─── */
/* Without this, the group wrapper intercepts mousedown and prevents dragging child nodes */
.diagram-canvas .vue-flow__node-aws-group {
  pointer-events: none;
}
.diagram-canvas .vue-flow__node-aws-group .vue-flow__handle {
  pointer-events: auto;
}
.diagram-canvas .vue-flow__node-aws-group [class*="resize"] {
  pointer-events: auto;
}

/* ─── Handles: larger hit area for easier connection dragging ─── */
.diagram-canvas .vue-flow__handle {
  width: 10px;
  height: 10px;
}
.diagram-canvas .vue-flow__handle::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  width: 28px;
  height: 28px;
  transform: translate(-50%, -50%);
  border-radius: 50%;
}
.diagram-canvas .vue-flow__handle:hover {
  width: 14px;
  height: 14px;
  transition: width 0.15s, height 0.15s;
}

/* ─── Selected edge highlight ─── */
.diagram-canvas .vue-flow__edge.selected .vue-flow__edge-path {
  stroke-width: 3;
  filter: drop-shadow(0 0 4px currentColor);
}
.diagram-canvas .vue-flow__edge.selected .vue-flow__edge-interaction {
  stroke-width: 30;
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
