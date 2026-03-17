<script setup lang="ts">
import { ref, computed, nextTick, onUnmounted } from 'vue';
import type { NodeProps } from '@vue-flow/core';
import { Handle, Position } from '@vue-flow/core';
import { NodeResizer } from '@vue-flow/node-resizer';
import '@vue-flow/node-resizer/dist/style.css';
import type { AWSServiceNodeData } from '@/stores/diagrams';
import { useDiagramsStore } from '@/stores/diagrams';
import { Trash2 } from 'lucide-vue-next';

const props = defineProps<NodeProps>();
const diagrams = useDiagramsStore();

const data = computed(() => props.data as AWSServiceNodeData);
const displayLabel = computed(() => data.value.customLabel || data.value.label);

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

function bringToFront() { diagrams.bringToFront(props.id); closeContextMenu(); }
function sendToBack() { diagrams.sendToBack(props.id); closeContextMenu(); }
function bringForward() { diagrams.bringForward(props.id); closeContextMenu(); }
function sendBackward() { diagrams.sendBackward(props.id); closeContextMenu(); }
function deleteNode() { diagrams.removeNode(props.id); closeContextMenu(); }
</script>

<style>
.vf-resize-handle {
  width: 10px !important;
  height: 10px !important;
  background: #fff !important;
  border: 2px solid #3b82f6 !important;
  border-radius: 2px !important;
  box-shadow: 0 0 0 1px rgba(59,130,246,0.3) !important;
}
.vf-resize-handle:hover {
  background: #3b82f6 !important;
  box-shadow: 0 0 0 3px rgba(59,130,246,0.4) !important;
}
.vf-resize-line {
  border-color: #3b82f6 !important;
  border-width: 1px !important;
  opacity: 0.5;
}
.vf-resize-line:hover {
  opacity: 1;
  border-width: 2px !important;
}
</style>

<template>
  <div
    :data-testid="`service-node-${id}`"
    class="group relative h-full w-full rounded-lg border bg-card text-card-foreground shadow-md transition-all"
    :class="[
      selected ? 'ring-2 shadow-lg' : 'hover:shadow-lg',
    ]"
    :style="{
      borderColor: selected ? data.service.color : undefined,
      '--ring-color': data.service.color,
      boxShadow: selected ? `0 0 0 2px ${data.service.color}40` : undefined,
    }"
    @contextmenu="onContextMenu"
    @click="closeContextMenu"
  >
    <!-- Resize handles -->
    <NodeResizer
      :min-width="120"
      :min-height="60"
      :is-visible="selected"
      color="#3b82f6"
      handle-class-name="vf-resize-handle"
      line-class-name="vf-resize-line"
    />

    <!-- Handles -->
    <Handle id="top" type="target" :position="Position.Top" class="!h-2.5 !w-2.5 !rounded-full !border-2 !border-card !bg-primary" />
    <Handle id="bottom" type="source" :position="Position.Bottom" class="!h-2.5 !w-2.5 !rounded-full !border-2 !border-card !bg-primary" />
    <Handle id="left" type="target" :position="Position.Left" class="!h-2.5 !w-2.5 !rounded-full !border-2 !border-card !bg-primary" />
    <Handle id="right" type="source" :position="Position.Right" class="!h-2.5 !w-2.5 !rounded-full !border-2 !border-card !bg-primary" />

    <!-- Header -->
    <div
      class="flex items-center gap-2 rounded-t-lg border-b px-3 py-2"
      :style="{ backgroundColor: data.service.color + '15', borderColor: data.service.color + '30' }"
    >
      <img v-if="data.service.iconUrl" :src="data.service.iconUrl" :alt="data.service.shortName" class="h-5 w-5 shrink-0 object-contain" />
      <svg v-else-if="data.service.iconPath" class="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" :stroke="data.service.color" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path :d="data.service.iconPath" />
      </svg>
      <div v-else class="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[9px] font-bold" :style="{ backgroundColor: data.service.color + '30', color: data.service.color }">
        {{ (data.customLabel || data.label || '?').charAt(0).toUpperCase() }}
      </div>
      <span class="flex-1 truncate text-xs font-semibold text-foreground">{{ displayLabel }}</span>
      <button
        class="rounded p-0.5 opacity-0 transition-opacity hover:bg-background/50 group-hover:opacity-100"
        :class="selected ? 'opacity-100' : ''"
        @click.stop="diagrams.removeNode(id)"
      >
        <Trash2 class="h-3 w-3 text-destructive" />
      </button>
    </div>

    <!-- Body -->
    <div class="px-3 py-1.5 text-[10px] text-muted-foreground">
      <div class="truncate">{{ data.service.name }}</div>
      <div v-if="data.notes" class="mt-0.5 truncate opacity-70">{{ data.notes }}</div>
    </div>

    <!-- Context Menu -->
    <Transition name="fade">
      <div
        v-if="showContextMenu"
        ref="menuRef"
        class="absolute z-50 min-w-[160px] rounded-md border border-border bg-popover py-1 shadow-lg"
        :style="{ left: contextMenuPos.x + 'px', top: contextMenuPos.y + 'px' }"
        @click.stop
      >
        <button class="flex w-full items-center px-3 py-1.5 text-left text-xs text-foreground hover:bg-muted/50" @click="bringToFront">Bring to Front</button>
        <button class="flex w-full items-center px-3 py-1.5 text-left text-xs text-foreground hover:bg-muted/50" @click="sendToBack">Send to Back</button>
        <button class="flex w-full items-center px-3 py-1.5 text-left text-xs text-foreground hover:bg-muted/50" @click="bringForward">Bring Forward</button>
        <button class="flex w-full items-center px-3 py-1.5 text-left text-xs text-foreground hover:bg-muted/50" @click="sendBackward">Send Backward</button>
        <div class="my-1 h-px bg-border" />
        <button class="flex w-full items-center px-3 py-1.5 text-left text-xs text-destructive hover:bg-destructive/10" @click="deleteNode">Delete Node</button>
      </div>
    </Transition>
  </div>
</template>
