<script setup lang="ts">
import { ref, watch, nextTick, onMounted, onUnmounted, computed } from 'vue';
import { VueFlow, useVueFlow, MarkerType, SelectionMode } from '@vue-flow/core';
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
  fitView, onConnect, onNodeDragStop, onPaneClick, onNodeClick, onEdgeClick, onEdgeDoubleClick,
  addNodes, removeNodes, addEdges, removeEdges, screenToFlowCoordinate,
  getNodes, getEdges, getSelectedNodes, setNodes, setEdges, findNode, findEdge,
  getViewport, setViewport, onNodeDragStart,
} = useVueFlow('diagram-editor');

// ─── Inline edge label editing ─────────────────────────────────────
const inlineEdgeEdit = ref<{ edgeId: string; x: number; y: number; label: string } | null>(null);

function commitInlineEdgeLabel() {
  if (!inlineEdgeEdit.value) return;
  diagrams.updateEdgeData(inlineEdgeEdit.value.edgeId, { label: inlineEdgeEdit.value.label });
  inlineEdgeEdit.value = null;
}

function cancelInlineEdgeLabel() {
  inlineEdgeEdit.value = null;
}

// ─── Sync VueFlow when store changes ──────────────────────────────
// Compute nesting depth: 0 for root nodes, 1 for direct children, etc.
function getNodeDepth(nodeId: string): number {
  let depth = 0;
  let current = diagrams.nodes.find(n => n.id === nodeId);
  while (current?.parentNode) {
    depth++;
    current = diagrams.nodes.find(n => n.id === current!.parentNode);
    if (depth > 10) break; // safety guard against cycles
  }
  return depth;
}

watch(
  () => diagrams.diagramVersion,
  async () => {
    // Sort by nesting depth: parents first, deeper children last
    // This ensures proper DOM ordering so children render on top of parents
    const sorted = [...diagrams.nodes].sort((a, b) => {
      return getNodeDepth(a.id) - getNodeDepth(b.id);
    });

    // Auto-set z-index based on depth so children are always above parents
    for (const node of sorted) {
      const depth = getNodeDepth(node.id);
      if (depth > 0) {
        const currentZ = (node as any).zIndex ?? 0;
        if (currentZ < depth * 10) {
          (node as any).zIndex = depth * 10;
        }
      }
    }
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

// ─── Sync individual edge data changes ──────────────────────────────
watch(
  () => diagrams.edges.map(e => e.data),
  () => {
    for (const storeEdge of diagrams.edges) {
      const vfEdge = findEdge(storeEdge.id);
      if (vfEdge && vfEdge.data !== storeEdge.data) {
        vfEdge.data = storeEdge.data;
      }
    }
  },
  { deep: true },
);

// ─── Sync node/edge removals from store to Vue Flow ──────────────────
// When nodes are deleted via the trash icon (which only calls store.removeNode),
// this watcher ensures VueFlow's internal graph stays in sync.
watch(
  () => diagrams.nodes.map(n => n.id),
  (storeNodeIds) => {
    const storeIdSet = new Set(storeNodeIds);
    const toRemove = getNodes.value.filter(n => !storeIdSet.has(n.id));
    if (toRemove.length) removeNodes(toRemove);
  },
);

watch(
  () => diagrams.edges.map(e => e.id),
  (storeEdgeIds) => {
    const storeIdSet = new Set(storeEdgeIds);
    const toRemove = getEdges.value.filter(e => !storeIdSet.has(e.id));
    if (toRemove.length) removeEdges(toRemove);
  },
);

// ─── Sync zIndex changes from store to Vue Flow ──────────────────────
watch(
  () => diagrams.nodes.map(n => (n as any).zIndex ?? 0),
  () => {
    for (const storeNode of diagrams.nodes) {
      const vfNode = findNode(storeNode.id);
      if (vfNode) {
        const storeZ = (storeNode as any).zIndex ?? 0;
        if (vfNode.zIndex !== storeZ) {
          vfNode.zIndex = storeZ;
        }
      }
    }
  },
);

// ─── Sync store selection to VueFlow visual selection ─────────────────
// When diagrams.selectNode() is called (from onNodeClick, PropertiesPanel, etc.),
// VueFlow's own node.selected must stay in sync to show/hide resize handles correctly.
watch(
  () => diagrams.selectedNodeId,
  (newId) => {
    // Skip during multi-select (getSelectedNodes > 1)
    if (getSelectedNodes.value.length > 1) return;
    for (const node of getNodes.value) {
      const shouldBeSelected = newId ? node.id === newId : false;
      if (node.selected !== shouldBeSelected) {
        node.selected = shouldBeSelected;
      }
      // Prevent VueFlow from boosting group z-index on selection.
      // Selected groups must stay at low z-index so children remain clickable.
      if (node.type === 'aws-group' && shouldBeSelected) {
        const depth = getNodeDepth(node.id);
        node.zIndex = Math.max(depth * 10, 1);
      }
    }
  },
);

// ─── Events ──────────────────────────────────────────────────────────

onConnect(async (connection: Connection) => {
  const prevCount = diagrams.edges.length;
  diagrams.addEdge(connection);
  // Only add to VueFlow if the store actually created a new edge (not a duplicate)
  if (diagrams.edges.length > prevCount) {
    const lastEdge = diagrams.edges[diagrams.edges.length - 1];
    // Spread to break Pinia reactivity proxy — VueFlow needs a plain object
    addEdges([{ ...lastEdge }]);
    // Force VueFlow to compute edge path on the next render cycle
    await nextTick();
  }
});

onNodeDragStop((event: NodeDragEvent) => {
  for (const node of event.nodes) {
    diagrams.updateNodePosition(node.id, node.position);

    // Check if an unparented node was dropped onto a group
    if (!node.parentNode) {
      // Use absolute position from store (handles nested coordinate systems)
      const absPos = diagrams.getAbsolutePosition(node.id);
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
  inlineEdgeEdit.value = null;
});

onNodeClick(({ node, event }) => {
  // VueFlow's internal hit detection may report the wrong node when a parent group
  // is selected — VueFlow boosts selected node z-index to ~1000, which can put the
  // parent above its children in VueFlow's internal logic. Our CSS override
  // (z-index: 1 !important) corrects the visual stacking, so elementsFromPoint
  // returns the actually-visible topmost node.
  const mouseEvent = event as MouseEvent;
  const elements = document.elementsFromPoint(mouseEvent.clientX, mouseEvent.clientY);

  for (const el of elements) {
    const nodeEl = (el as HTMLElement).closest?.('.vue-flow__node');
    if (nodeEl) {
      const id = nodeEl.getAttribute('data-id');
      if (id) {
        diagrams.selectNode(id);
        return;
      }
    }
  }

  // Fallback to VueFlow's reported node
  diagrams.selectNode(node.id);
});

onEdgeClick(({ edge }) => {
  diagrams.selectEdge(edge.id);
});

onEdgeDoubleClick(({ edge, event }) => {
  const container = flowContainer.value;
  if (!container) return;
  const rect = container.getBoundingClientRect();
  const mouseEvent = event as MouseEvent;
  inlineEdgeEdit.value = {
    edgeId: edge.id,
    x: mouseEvent.clientX - rect.left,
    y: mouseEvent.clientY - rect.top,
    label: (edge.data as any)?.label || '',
  };
  diagrams.selectEdge(edge.id);
  nextTick(() => {
    const input = container.querySelector('.inline-edge-input') as HTMLInputElement;
    input?.focus();
    input?.select();
  });
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

  // Convert screen coordinates to graph-space position
  const position = screenToFlowCoordinate({
    x: event.clientX,
    y: event.clientY,
  });

  let nodeId: string;
  if (type === 'service') {
    nodeId = diagrams.addServiceNode(itemId, position);
  } else if (type === 'group') {
    nodeId = diagrams.addGroupNode(itemId, position);
  } else {
    return;
  }

  // Check if dropped onto a group container (both services AND groups)
  const groupId = diagrams.findGroupAtPosition(position, nodeId);
  if (groupId) {
    diagrams.setNodeParent(nodeId, groupId);
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
    const captureTarget = flowContainer.value?.querySelector('.vue-flow__transformationpane') as HTMLElement
      ?? flowContainer.value?.querySelector('.vue-flow__viewport') as HTMLElement
      ?? flowContainer.value;
    if (!captureTarget) { toast.error('Cannot find canvas element'); return; }

    const html2canvas = (await import('html2canvas')).default;
    const bounds = diagrams.getContentBounds(50);
    const viewport = getViewport();

    if (bounds) {
      // Compute the screen-space rect of the content bounds
      const screenX = bounds.x * viewport.zoom + viewport.x;
      const screenY = bounds.y * viewport.zoom + viewport.y;
      const screenW = bounds.width * viewport.zoom;
      const screenH = bounds.height * viewport.zoom;

      const scale = 2;
      const canvas = await html2canvas(captureTarget, {
        x: screenX,
        y: screenY,
        width: screenW,
        height: screenH,
        scale,
        backgroundColor: '#0a0a0a',
        logging: false,
        useCORS: true,
        allowTaint: true,
      });

      canvas.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${diagrams.currentDiagramName.replace(/\s+/g, '-').toLowerCase()}.png`;
        a.click();
        URL.revokeObjectURL(url);
        toast.success('Diagram exported as PNG (cropped to content)');
      });
    } else {
      toast.error('No nodes to export');
    }
  } catch (err) {
    console.error('PNG export error:', err);
    toast.error('PNG export failed');
  }
}

function exportSvg() {
  try {
    const el = flowContainer.value?.querySelector('.vue-flow__viewport svg') as SVGSVGElement | null;
    if (!el) {
      toast.error('Cannot find SVG element');
      return;
    }

    // Clone SVG so we can set a viewBox for content cropping
    const clone = el.cloneNode(true) as SVGSVGElement;
    const bounds = diagrams.getContentBounds(50);
    const viewport = getViewport();

    if (bounds) {
      const vbX = bounds.x * viewport.zoom + viewport.x;
      const vbY = bounds.y * viewport.zoom + viewport.y;
      const vbW = bounds.width * viewport.zoom;
      const vbH = bounds.height * viewport.zoom;
      clone.setAttribute('viewBox', `${vbX} ${vbY} ${vbW} ${vbH}`);
      clone.setAttribute('width', String(Math.round(bounds.width)));
      clone.setAttribute('height', String(Math.round(bounds.height)));
    }

    const serializer = new XMLSerializer();
    const svgStr = serializer.serializeToString(clone);
    const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${diagrams.currentDiagramName.replace(/\s+/g, '-').toLowerCase()}.svg`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Diagram exported as SVG (cropped to content)');
  } catch {
    toast.error('SVG export failed');
  }
}
</script>

<template>
  <div data-testid="diagram-editor" class="flex h-full flex-col">
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
              class="diagram-canvas"
            >
              <template #node-aws-service="nodeProps"><AWSServiceNode v-bind="nodeProps" :hovered-group-id="hoveredGroupId" /></template>
              <template #node-aws-group="nodeProps"><AWSGroupNode v-bind="nodeProps" :hovered-group-id="hoveredGroupId" /></template>
              <template #edge-animated-flow="edgeProps"><AnimatedFlowEdge v-bind="edgeProps" /></template>

              <Background :gap="15" :size="1" pattern-color="var(--border)" />
              <MiniMap
                class="!bottom-4 !right-4"
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
            :connection-radius="60"
            :connect-on-click="true"
            class="diagram-canvas"
          >
            <template #node-aws-service="nodeProps"><AWSServiceNode v-bind="nodeProps" :hovered-group-id="hoveredGroupId" /></template>
            <template #node-aws-group="nodeProps"><AWSGroupNode v-bind="nodeProps" :hovered-group-id="hoveredGroupId" /></template>
            <template #edge-animated-flow="edgeProps"><AnimatedFlowEdge v-bind="edgeProps" /></template>

            <Background :gap="15" :size="1" pattern-color="var(--border)" />
            <MiniMap class="!bottom-16 !right-4" :node-color="() => 'var(--primary)'" :mask-color="'rgba(19, 24, 20, 0.8)'" />
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

/* ─── Group nodes: keep z-index low so children stay clickable ─── */
.diagram-canvas .vue-flow__node-aws-group.selected {
  z-index: 1 !important;
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
