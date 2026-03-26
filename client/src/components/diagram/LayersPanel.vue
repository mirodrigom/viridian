<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Eye, EyeOff, GripVertical, Layers, ChevronsUp, ChevronUp, ChevronDown, ChevronsDown } from 'lucide-vue-next';
import { useDiagramsStore, type AWSServiceNodeData, type AWSGroupNodeData } from '@/stores/diagrams';

const diagrams = useDiagramsStore();

// ─── Visibility tracking (skip recomputation when panel is hidden/collapsed) ──
const panelRef = ref<HTMLElement | null>(null);
const isVisible = ref(true);
let observer: IntersectionObserver | null = null;

onMounted(() => {
  if (panelRef.value) {
    observer = new IntersectionObserver(
      ([entry]) => { isVisible.value = entry?.isIntersecting ?? false; },
      { threshold: 0.01 },
    );
    observer.observe(panelRef.value);
  }
});

onUnmounted(() => {
  observer?.disconnect();
  closeContextMenu();
});

interface LayerItem {
  id: string;
  label: string;
  type: 'aws-service' | 'aws-group';
  zIndex: number;
  depth: number;
  parentId: string | undefined;
  color: string;
  borderStyle?: string;
  iconUrl?: string;
  iconPath?: string;
  hidden: boolean;
  children: LayerItem[];
}

// Internal computeds that do the real work
const _layerTree = computed((): LayerItem[] => {
  function buildItem(node: any): LayerItem {
    const data = node.data;
    const isService = data.nodeType === 'aws-service';
    return {
      id: node.id,
      label: data.customLabel || data.label,
      type: data.nodeType,
      zIndex: node.zIndex ?? 0,
      depth: diagrams.getNodeDepth(node.id),
      parentId: node.parentNode,
      color: isService ? (data as AWSServiceNodeData).service.color : (data as AWSGroupNodeData).groupType.color,
      borderStyle: !isService ? (data as AWSGroupNodeData).groupType.borderStyle : undefined,
      iconUrl: isService ? (data as AWSServiceNodeData).service.iconUrl : undefined,
      iconPath: isService ? (data as AWSServiceNodeData).service.iconPath : undefined,
      hidden: node.hidden ?? false,
      children: [],
    };
  }

  const items = diagrams.nodes.map(buildItem);
  const itemMap = new Map(items.map(i => [i.id, i]));

  for (const item of items) {
    if (item.parentId && itemMap.has(item.parentId)) {
      itemMap.get(item.parentId)!.children.push(item);
    }
  }

  function sortByZ(list: LayerItem[]) {
    list.sort((a, b) => b.zIndex - a.zIndex);
    for (const item of list) {
      if (item.children.length > 0) sortByZ(item.children);
    }
  }

  const roots = items.filter(i => !i.parentId);
  sortByZ(roots);

  return roots;
});

const _flatLayers = computed((): LayerItem[] => {
  const result: LayerItem[] = [];
  function walk(items: LayerItem[]) {
    for (const item of items) {
      result.push(item);
      if (item.children.length > 0) walk(item.children);
    }
  }
  walk(_layerTree.value);
  return result;
});

// Cached version that only updates when the panel is visible
let cachedFlatLayers: LayerItem[] = [];

const flatLayers = computed((): LayerItem[] => {
  if (isVisible.value) {
    cachedFlatLayers = _flatLayers.value;
  }
  return cachedFlatLayers;
});

// ─── Drag and drop ─────────────────────────────────────────────────────────
const draggedId = ref<string | null>(null);
const dropTargetId = ref<string | null>(null);
const dropOnRoot = ref(false);

/** Returns true if `ancestorId` is an ancestor of `nodeId` (or equal) — prevents circular nesting. */
function isAncestorOf(ancestorId: string, nodeId: string): boolean {
  if (ancestorId === nodeId) return true;
  const node = diagrams.nodeById.get(nodeId);
  if (!node?.parentNode) return false;
  return isAncestorOf(ancestorId, node.parentNode);
}

function onDragStart(event: DragEvent, id: string) {
  draggedId.value = id;
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', id);
  }
}

function onDragOver(event: DragEvent, layer: LayerItem | null) {
  event.preventDefault();
  if (!event.dataTransfer || !draggedId.value) return;

  if (layer === null) {
    // Root area
    event.dataTransfer.dropEffect = 'move';
    dropOnRoot.value = true;
    dropTargetId.value = null;
    return;
  }

  // Determine the would-be parent
  const wouldBeParent = layer.type === 'aws-group' ? layer.id : (layer.parentId ?? null);

  // Block if dragging onto itself or into its own subtree
  if (wouldBeParent && isAncestorOf(draggedId.value, wouldBeParent)) {
    event.dataTransfer.dropEffect = 'none';
    return;
  }

  event.dataTransfer.dropEffect = 'move';
  dropOnRoot.value = false;
  dropTargetId.value = layer.type === 'aws-group' ? layer.id : (layer.parentId ?? null);
}

function onDragLeave(event: DragEvent) {
  // Only clear if leaving to an element outside this row
  const related = event.relatedTarget as HTMLElement | null;
  if (!related || !(event.currentTarget as HTMLElement).contains(related)) {
    dropTargetId.value = null;
    dropOnRoot.value = false;
  }
}

function onRootDragLeave() {
  dropTargetId.value = null;
  dropOnRoot.value = false;
}

function onDrop(event: DragEvent, layer: LayerItem | null) {
  event.preventDefault();
  event.stopPropagation();
  if (!draggedId.value) return;

  const targetParent = layer === null
    ? null
    : layer.type === 'aws-group'
      ? layer.id
      : (layer.parentId ?? null);

  // Safety: never drop into itself or own subtree
  if (targetParent === null || !isAncestorOf(draggedId.value, targetParent)) {
    diagrams.setNodeParent(draggedId.value, targetParent);
  }

  draggedId.value = null;
  dropTargetId.value = null;
  dropOnRoot.value = false;
}

function onDragEnd() {
  draggedId.value = null;
  dropTargetId.value = null;
  dropOnRoot.value = false;
}

// ─── Context menu (z-order) ────────────────────────────────────────────────
interface ContextMenu {
  x: number;
  y: number;
  layerId: string;
}

const contextMenu = ref<ContextMenu | null>(null);

function openContextMenu(event: MouseEvent, layerId: string) {
  event.preventDefault();
  event.stopPropagation();
  contextMenu.value = { x: event.clientX, y: event.clientY, layerId };
}

function closeContextMenu() {
  contextMenu.value = null;
}

function onContextMenuAction(action: 'bringToFront' | 'bringForward' | 'sendBackward' | 'sendToBack') {
  if (!contextMenu.value) return;
  const id = contextMenu.value.layerId;
  closeContextMenu();
  diagrams[action](id);
}

// Close context menu on outside click or Escape
function onDocumentClick(e: MouseEvent) {
  if (contextMenu.value) {
    const target = e.target as HTMLElement;
    if (!target.closest('[data-context-menu]')) closeContextMenu();
  }
}

function onDocumentKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') closeContextMenu();
}

onMounted(() => {
  document.addEventListener('click', onDocumentClick);
  document.addEventListener('keydown', onDocumentKeydown);
});

onUnmounted(() => {
  document.removeEventListener('click', onDocumentClick);
  document.removeEventListener('keydown', onDocumentKeydown);
});
</script>

<template>
  <div ref="panelRef" data-testid="layers-panel" class="flex h-full flex-col bg-background" style="min-height: 0;">
    <!-- Header -->
    <div class="flex h-9 shrink-0 items-center gap-1.5 border-b border-border px-2">
      <Layers class="h-3.5 w-3.5 text-muted-foreground" />
      <span class="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Layers</span>
      <div class="flex-1" />
      <span class="text-[9px] tabular-nums text-muted-foreground/60">{{ diagrams.nodeCount }}</span>
    </div>

    <!-- Layer list -->
    <ScrollArea class="flex-1" style="min-height: 0;">
      <div
        class="p-1"
        @dragover.prevent="onDragOver($event, null)"
        @dragleave="onRootDragLeave"
        @drop="onDrop($event, null)"
      >
        <!-- Empty state -->
        <div v-if="diagrams.nodeCount === 0" class="flex items-center justify-center py-8 text-xs text-muted-foreground">
          No layers yet
        </div>

        <!-- Root drop indicator -->
        <div
          v-if="dropOnRoot && draggedId"
          class="mb-1 h-0.5 rounded bg-primary"
        />

        <!-- Layer rows -->
        <div
          v-for="layer in flatLayers"
          :key="layer.id"
          :data-testid="`layer-${layer.id}`"
          draggable="true"
          class="group flex cursor-default items-center gap-1 rounded py-1 pr-1 transition-colors"
          :class="[
            layer.hidden ? 'opacity-50' : '',
            draggedId === layer.id ? 'opacity-30' : '',
            dropTargetId === layer.id ? 'ring-1 ring-primary bg-primary/5' : '',
            diagrams.selectedNodeId === layer.id
              ? 'bg-primary/10 text-primary'
              : 'hover:bg-muted/50 text-foreground',
          ]"
          :style="{ paddingLeft: `${4 + layer.depth * 14}px` }"
          @click="diagrams.selectNode(layer.id)"
          @contextmenu="openContextMenu($event, layer.id)"
          @dragstart="onDragStart($event, layer.id)"
          @dragover="onDragOver($event, layer)"
          @dragleave="onDragLeave($event)"
          @drop.stop="onDrop($event, layer)"
          @dragend="onDragEnd"
        >
          <!-- Eye visibility toggle — always visible, dimmed when visible -->
          <button
            class="flex h-4 w-4 shrink-0 items-center justify-center rounded transition-opacity"
            :class="layer.hidden
              ? 'text-muted-foreground/40 hover:text-muted-foreground'
              : 'text-muted-foreground/30 hover:text-muted-foreground'"
            :title="layer.hidden ? 'Show layer' : 'Hide layer'"
            @click.stop="diagrams.toggleNodeVisibility(layer.id)"
          >
            <EyeOff v-if="layer.hidden" class="h-3 w-3" />
            <Eye v-else class="h-3 w-3" />
          </button>

          <!-- Type indicator -->
          <template v-if="layer.type === 'aws-group'">
            <div
              class="h-3.5 w-3.5 shrink-0 rounded border"
              :style="{
                borderColor: layer.color + '80',
                borderStyle: layer.borderStyle || 'solid',
                backgroundColor: layer.color + '15',
              }"
            />
          </template>
          <template v-else>
            <img v-if="layer.iconUrl" :src="layer.iconUrl" class="h-3.5 w-3.5 shrink-0" />
            <svg v-else class="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" :stroke="layer.color" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path :d="layer.iconPath" />
            </svg>
          </template>

          <!-- Name -->
          <span class="min-w-0 flex-1 truncate text-[11px]">{{ layer.label }}</span>

          <!-- Drag handle — shown on hover or when selected -->
          <GripVertical
            class="h-3.5 w-3.5 shrink-0 cursor-grab text-muted-foreground/30 transition-opacity active:cursor-grabbing"
            :class="diagrams.selectedNodeId === layer.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'"
          />
        </div>

        <!-- Bottom root drop zone (always present, picks up drops at the bottom of the list) -->
        <div
          v-if="flatLayers.length > 0"
          class="h-4 w-full"
          @dragover.prevent="onDragOver($event, null)"
          @dragleave="onRootDragLeave"
          @drop="onDrop($event, null)"
        />

      </div>
    </ScrollArea>

    <!-- Context menu (z-order) -->
    <Teleport to="body">
      <div
        v-if="contextMenu"
        data-context-menu
        class="fixed z-50 min-w-[160px] rounded-md border border-border bg-popover py-1 shadow-md"
        :style="{ top: `${contextMenu.y}px`, left: `${contextMenu.x}px` }"
        @click.stop
      >
        <div class="px-2 pb-1 pt-0.5 text-[9px] font-medium uppercase tracking-wider text-muted-foreground/60">
          Z-Order
        </div>
        <button
          class="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-foreground hover:bg-muted"
          @click="onContextMenuAction('bringToFront')"
        >
          <ChevronsUp class="h-3.5 w-3.5 text-muted-foreground" />
          Bring to Front
        </button>
        <button
          class="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-foreground hover:bg-muted"
          @click="onContextMenuAction('bringForward')"
        >
          <ChevronUp class="h-3.5 w-3.5 text-muted-foreground" />
          Bring Forward
        </button>
        <button
          class="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-foreground hover:bg-muted"
          @click="onContextMenuAction('sendBackward')"
        >
          <ChevronDown class="h-3.5 w-3.5 text-muted-foreground" />
          Send Backward
        </button>
        <button
          class="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-foreground hover:bg-muted"
          @click="onContextMenuAction('sendToBack')"
        >
          <ChevronsDown class="h-3.5 w-3.5 text-muted-foreground" />
          Send to Back
        </button>
      </div>
    </Teleport>
  </div>
</template>
