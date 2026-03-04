<script setup lang="ts">
import { ref, computed, nextTick, onUnmounted } from 'vue';
import type { NodeProps } from '@vue-flow/core';
import { Handle, Position } from '@vue-flow/core';
import { NodeResizer } from '@vue-flow/node-resizer';
import '@vue-flow/node-resizer/dist/style.css';
import type { AWSGroupNodeData } from '@/stores/diagrams';
import { useDiagramsStore } from '@/stores/diagrams';
import { Trash2, ChevronDown, ChevronRight } from 'lucide-vue-next';

const props = defineProps<NodeProps & { hoveredGroupId?: string | null }>();
const diagrams = useDiagramsStore();

const data = computed(() => props.data as AWSGroupNodeData);
const displayLabel = computed(() => data.value.customLabel || data.value.label);
const isCollapsed = computed(() => !!data.value.collapsed);
const childCount = computed(() => diagrams.getGroupChildren(props.id).length);

// Double-click rename
const isEditing = ref(false);
const editInput = ref<HTMLInputElement>();
const editValue = ref('');

function startEditing() {
  editValue.value = data.value.customLabel || data.value.label;
  isEditing.value = true;
  nextTick(() => editInput.value?.focus());
}

function finishEditing() {
  if (!isEditing.value) return;
  isEditing.value = false;
  const trimmed = editValue.value.trim();
  if (trimmed && trimmed !== data.value.label) {
    diagrams.updateNodeData(props.id, { customLabel: trimmed });
  } else if (!trimmed || trimmed === data.value.label) {
    diagrams.updateNodeData(props.id, { customLabel: '' });
  }
}

// Context menu
const showContextMenu = ref(false);
const contextMenuPos = ref({ x: 0, y: 0 });
const menuRef = ref<HTMLElement | null>(null);

function onContextMenu(event: MouseEvent) {
  event.preventDefault();
  event.stopPropagation();
  contextMenuPos.value = { x: event.offsetX, y: event.offsetY };
  showContextMenu.value = true;
  nextTick(() => {
    document.addEventListener('mousedown', handleClickOutside);
  });
}

function closeContextMenu() {
  showContextMenu.value = false;
  document.removeEventListener('mousedown', handleClickOutside);
}

function handleClickOutside(e: MouseEvent) {
  if (menuRef.value && !menuRef.value.contains(e.target as Node)) {
    closeContextMenu();
  }
}

onUnmounted(() => {
  document.removeEventListener('mousedown', handleClickOutside);
});

function toggleCollapse() {
  diagrams.toggleGroupCollapse(props.id);
}

function ungroupChildren() {
  diagrams.ungroupChildren(props.id);
  closeContextMenu();
}

function bringToFront() {
  diagrams.bringToFront(props.id);
  closeContextMenu();
}

function sendToBack() {
  diagrams.sendToBack(props.id);
  closeContextMenu();
}

function bringForward() {
  diagrams.bringForward(props.id);
  closeContextMenu();
}

function sendBackward() {
  diagrams.sendBackward(props.id);
  closeContextMenu();
}

function deleteGroup() {
  diagrams.removeNode(props.id);
  closeContextMenu();
}

// Drop zone highlight
const isDropTarget = computed(() => props.hoveredGroupId === props.id);
</script>

<style>
.vf-group-resize-handle {
  width: 11px !important;
  height: 11px !important;
  background: #fff !important;
  border: 2px solid var(--group-color, #64748b) !important;
  border-radius: 2px !important;
  box-shadow: 0 0 0 1px rgba(0,0,0,0.2) !important;
}
.vf-group-resize-handle:hover {
  background: var(--group-color, #64748b) !important;
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--group-color, #64748b) 40%, transparent) !important;
}
.vf-group-resize-line {
  border-color: var(--group-color, #64748b) !important;
  border-width: 1px !important;
  opacity: 0.4;
}
.vf-group-resize-line:hover {
  opacity: 1;
  border-width: 2px !important;
}
</style>

<template>
  <div
    :data-testid="`group-node-${id}`"
    class="group relative h-full w-full rounded-lg transition-all"
    :style="{
      '--group-color': data.groupType.color,
      border: `2px ${data.groupType.borderStyle} ${isDropTarget ? data.groupType.color : data.groupType.color + '60'}`,
      backgroundColor: isDropTarget ? data.groupType.color + '15' : data.groupType.color + '08',
      boxShadow: selected ? `0 0 0 2px ${data.groupType.color}40` : isDropTarget ? `0 0 0 3px ${data.groupType.color}50, inset 0 0 20px ${data.groupType.color}10` : undefined,
    }"
    @contextmenu="onContextMenu"
    @click="closeContextMenu"
  >
    <!-- Resize handles (hidden when collapsed) -->
    <NodeResizer
      :min-width="160"
      :min-height="isCollapsed ? 40 : 80"
      :is-visible="selected && !isCollapsed"
      :color="data.groupType.color"
      handle-class-name="vf-group-resize-handle"
      line-class-name="vf-group-resize-line"
    />

    <!-- Handles -->
    <Handle id="top" type="target" :position="Position.Top" class="!h-2.5 !w-2.5 !rounded-full !border-2 !border-background" :style="{ backgroundColor: data.groupType.color }" />
    <Handle id="bottom" type="source" :position="Position.Bottom" class="!h-2.5 !w-2.5 !rounded-full !border-2 !border-background" :style="{ backgroundColor: data.groupType.color }" />
    <Handle id="left" type="target" :position="Position.Left" class="!h-2.5 !w-2.5 !rounded-full !border-2 !border-background" :style="{ backgroundColor: data.groupType.color }" />
    <Handle id="right" type="source" :position="Position.Right" class="!h-2.5 !w-2.5 !rounded-full !border-2 !border-background" :style="{ backgroundColor: data.groupType.color }" />

    <!-- Label bar (pointer-events re-enabled for drag/select/context-menu) -->
    <div
      class="pointer-events-auto flex items-center gap-2 rounded-t-md px-3 py-1.5"
      :style="{ backgroundColor: data.groupType.color + '20', borderBottom: `1px solid ${data.groupType.color}30` }"
    >
      <!-- Collapse/expand toggle -->
      <button
        data-testid="group-collapse-toggle"
        class="flex h-4 w-4 shrink-0 items-center justify-center rounded transition-colors hover:bg-background/50"
        @click.stop="toggleCollapse"
      >
        <component :is="isCollapsed ? ChevronRight : ChevronDown" class="h-3 w-3" :style="{ color: data.groupType.color }" />
      </button>

      <!-- Editable label -->
      <template v-if="isEditing">
        <input
          ref="editInput"
          v-model="editValue"
          class="min-w-[60px] rounded border border-border bg-background px-1 py-0.5 text-xs font-semibold outline-none focus:ring-1 focus:ring-ring"
          :style="{ color: data.groupType.color }"
          @blur="finishEditing"
          @keydown.enter="finishEditing"
          @keydown.escape="isEditing = false"
          @click.stop
        />
      </template>
      <template v-else>
        <span
          data-testid="group-label"
          class="cursor-text select-none text-xs font-semibold"
          :style="{ color: data.groupType.color }"
          @dblclick.stop="startEditing"
        >
          {{ displayLabel }}
        </span>
      </template>

      <!-- Collapsed badge showing child count -->
      <span
        v-if="isCollapsed && childCount > 0"
        class="rounded-full px-1.5 py-0 text-[9px] font-medium tabular-nums"
        :style="{ backgroundColor: data.groupType.color + '25', color: data.groupType.color }"
      >
        {{ childCount }} node{{ childCount !== 1 ? 's' : '' }}
      </span>

      <span v-if="data.notes && !isEditing && !isCollapsed" class="truncate text-[10px] text-muted-foreground">{{ data.notes }}</span>
      <div class="flex-1" />
      <button
        class="rounded p-0.5 opacity-0 transition-opacity hover:bg-background/50 group-hover:opacity-100"
        :class="selected ? 'opacity-100' : ''"
        @click.stop="diagrams.removeNode(id)"
      >
        <Trash2 class="h-3 w-3 text-destructive" />
      </button>
    </div>

    <!-- Inner area where children can be dropped (hidden when collapsed) -->
    <!-- pointer-events: none lets clicks pass through to edges in the SVG layer beneath -->
    <div v-if="!isCollapsed" class="pointer-events-none relative flex-1 p-2" style="min-height: 150px;">
      <!-- Drop zone indicator -->
      <div
        v-if="isDropTarget"
        class="pointer-events-none absolute inset-2 flex items-center justify-center rounded-md border-2 border-dashed"
        :style="{ borderColor: data.groupType.color + '50' }"
      >
        <span class="text-[10px] font-medium" :style="{ color: data.groupType.color + '80' }">Drop here</span>
      </div>
    </div>

    <!-- Context Menu -->
    <Transition name="fade">
      <div
        v-if="showContextMenu"
        ref="menuRef"
        class="pointer-events-auto absolute z-50 min-w-[160px] rounded-md border border-border bg-popover py-1 shadow-lg"
        :style="{ left: contextMenuPos.x + 'px', top: contextMenuPos.y + 'px' }"
        @click.stop
      >
        <button
          class="flex w-full items-center px-3 py-1.5 text-left text-xs text-foreground hover:bg-muted/50"
          @click="toggleCollapse(); closeContextMenu()"
        >
          {{ isCollapsed ? 'Expand Group' : 'Collapse Group' }}
        </button>
        <button
          class="flex w-full items-center px-3 py-1.5 text-left text-xs text-foreground hover:bg-muted/50"
          @click="startEditing(); closeContextMenu()"
        >
          Rename Group
        </button>
        <button
          class="flex w-full items-center px-3 py-1.5 text-left text-xs text-foreground hover:bg-muted/50"
          @click="ungroupChildren"
        >
          Ungroup Children
        </button>
        <div class="my-1 h-px bg-border" />
        <button
          class="flex w-full items-center px-3 py-1.5 text-left text-xs text-foreground hover:bg-muted/50"
          @click="bringToFront"
        >
          Bring to Front
        </button>
        <button
          class="flex w-full items-center px-3 py-1.5 text-left text-xs text-foreground hover:bg-muted/50"
          @click="sendToBack"
        >
          Send to Back
        </button>
        <button
          class="flex w-full items-center px-3 py-1.5 text-left text-xs text-foreground hover:bg-muted/50"
          @click="bringForward"
        >
          Bring Forward
        </button>
        <button
          class="flex w-full items-center px-3 py-1.5 text-left text-xs text-foreground hover:bg-muted/50"
          @click="sendBackward"
        >
          Send Backward
        </button>
        <div class="my-1 h-px bg-border" />
        <button
          class="flex w-full items-center px-3 py-1.5 text-left text-xs text-destructive hover:bg-destructive/10"
          @click="deleteGroup"
        >
          Delete Group
        </button>
      </div>
    </Transition>
  </div>
</template>
