<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import { useManagementStore } from '@/stores/management';
import { useChatStore } from '@/stores/chat';
import type { WidgetConfig } from '@/stores/management';
import { LayoutDashboard } from 'lucide-vue-next';
import ServicesWidget from './widgets/ServicesWidget.vue';
import ScriptsWidget from './widgets/ScriptsWidget.vue';
import EnvWidget from './widgets/EnvWidget.vue';
import ProcessesWidget from './widgets/ProcessesWidget.vue';

const store = useManagementStore();
const chat = useChatStore();

const WIDGET_COMPONENTS: Record<WidgetConfig['id'], unknown> = {
  services: ServicesWidget,
  scripts: ScriptsWidget,
  env: EnvWidget,
  processes: ProcessesWidget,
};

// ─── Drag-to-reorder ──────────────────────────────────────────────────────────
const draggingId = ref<string | null>(null);
const dragOverId = ref<string | null>(null);

function onDragStart(id: string, e: DragEvent) {
  draggingId.value = id;
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
  }
}

function onDragOver(id: string, e: DragEvent) {
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  dragOverId.value = id;
}

function onDrop(targetId: string, e: DragEvent) {
  e.preventDefault();
  const srcId = draggingId.value;
  if (!srcId || srcId === targetId) { reset(); return; }

  const newOrder = [...store.sortedWidgets];
  const srcIdx = newOrder.findIndex(w => w.id === srcId);
  const tgtIdx = newOrder.findIndex(w => w.id === targetId);
  if (srcIdx === -1 || tgtIdx === -1) { reset(); return; }

  const [moved] = newOrder.splice(srcIdx, 1);
  newOrder.splice(tgtIdx, 0, moved);
  store.reorderWidgets(newOrder);
  reset();
}

function onDragEnd() { reset(); }

function reset() {
  draggingId.value = null;
  dragOverId.value = null;
}

onMounted(() => {
  store.connect();
  store.init(chat.projectPath);
});

watch(() => chat.projectPath, (path) => {
  store.init(path);
});
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden bg-background">
    <!-- Topbar -->
    <div class="flex items-center gap-2 border-b px-3 py-2 shrink-0 bg-muted/10">
      <LayoutDashboard class="h-4 w-4 text-primary shrink-0" />
      <span class="text-sm font-semibold">Management</span>
      <span
        v-if="store.projectPath"
        class="text-[10px] font-mono text-muted-foreground truncate max-w-48"
        :title="store.projectPath"
      >{{ store.projectPath.split('/').pop() }}</span>
      <span
        v-if="store.runningCount > 0"
        class="flex h-4 min-w-5 items-center justify-center rounded-full bg-green-500/15 px-1.5 text-[10px] font-semibold text-green-500"
      >
        {{ store.runningCount }} running
      </span>
    </div>

    <!-- Widget grid -->
    <div class="flex-1 overflow-y-auto p-4">
      <div
        class="grid gap-4 auto-rows-[minmax(280px,auto)]"
        style="grid-template-columns: repeat(2, 1fr);"
        @dragover.prevent
      >
        <div
          v-for="widget in store.sortedWidgets"
          :key="widget.id"
          :class="[
            widget.size === 'full' ? 'col-span-2' : 'col-span-1',
            draggingId === widget.id ? 'opacity-40 scale-[0.98]' : 'opacity-100',
            dragOverId === widget.id && draggingId !== widget.id
              ? 'ring-2 ring-primary/50 rounded-xl' : '',
            'transition-all duration-150',
          ]"
          @dragover.prevent="onDragOver(widget.id, $event)"
          @drop="onDrop(widget.id, $event)"
          @dragend="onDragEnd"
        >
          <!-- The widget component — drag handle is inside WidgetShell -->
          <div
            class="h-full"
            :draggable="true"
            @dragstart="(e) => {
              // Only allow drag from the handle
              const target = e.target as HTMLElement;
              if (!target.closest('[data-drag-handle]')) { e.preventDefault(); return; }
              onDragStart(widget.id, e);
            }"
          >
            <component :is="WIDGET_COMPONENTS[widget.id]" :widget="widget" class="h-full" />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
