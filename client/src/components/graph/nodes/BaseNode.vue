<script setup lang="ts">
import { computed } from 'vue';
import { Handle, Position } from '@vue-flow/core';
import type { GraphNodeType, NodeData } from '@/types/graph';
import { NODE_CONFIG, CONNECTION_RULES } from '@/types/graph';
import { useGraphStore } from '@/stores/graph';
import { X } from 'lucide-vue-next';

const props = defineProps<{
  id: string;
  data: NodeData;
  selected?: boolean;
}>();

const graph = useGraphStore();

const config = computed(() => NODE_CONFIG[props.data.nodeType]);

// Determine which source handles this node type has
const sourceHandles = computed(() => {
  const rules = CONNECTION_RULES[props.data.nodeType];
  const handles: { id: string; label: string; position: Position }[] = [];
  const seen = new Set<string>();
  for (const rule of rules) {
    const handleId = `${rule.edgeType}-out`;
    if (!seen.has(handleId)) {
      seen.add(handleId);
      handles.push({
        id: handleId,
        label: rule.edgeType.replace(/-/g, ' '),
        position: Position.Bottom,
      });
    }
  }
  return handles;
});

// Determine which target handles this node type accepts
const targetHandles = computed(() => {
  const type = props.data.nodeType;
  const handles: { id: string; label: string; position: Position }[] = [];
  const seen = new Set<string>();

  // Check all node types to find which ones can connect to us
  for (const [, rules] of Object.entries(CONNECTION_RULES)) {
    for (const rule of rules) {
      if (rule.targets.includes(type)) {
        const handleId = `${rule.edgeType}-in`;
        if (!seen.has(handleId)) {
          seen.add(handleId);
          handles.push({
            id: handleId,
            label: rule.edgeType.replace(/-/g, ' '),
            position: Position.Top,
          });
        }
      }
    }
  }
  return handles;
});

function onDelete() {
  graph.removeNode(props.id);
}
</script>

<template>
  <div
    class="relative min-w-[200px] max-w-[280px] rounded-lg border bg-card text-card-foreground shadow-md transition-all"
    :class="[
      selected ? 'ring-2 ring-primary shadow-lg shadow-primary/10' : 'hover:shadow-lg',
    ]"
  >
    <!-- Target handles (top) -->
    <Handle
      v-for="handle in targetHandles"
      :key="handle.id"
      :id="handle.id"
      type="target"
      :position="handle.position"
      class="!h-2.5 !w-2.5 !rounded-full !border-2 !border-card"
      :style="{ backgroundColor: config.accentVar }"
    />

    <!-- Header -->
    <div
      class="flex items-center gap-2 rounded-t-lg border-b px-3 py-2"
      :class="config.accentClass"
    >
      <slot name="icon" />
      <span class="flex-1 truncate text-sm font-semibold">{{ data.label }}</span>
      <button
        class="rounded p-0.5 opacity-0 transition-opacity hover:bg-background/50 group-hover:opacity-100"
        :class="selected ? 'opacity-100' : ''"
        @click.stop="onDelete"
      >
        <X class="h-3.5 w-3.5" />
      </button>
    </div>

    <!-- Body -->
    <div class="px-3 py-2 text-xs text-muted-foreground">
      <slot />
    </div>

    <!-- Source handles (bottom) -->
    <Handle
      v-for="(handle, i) in sourceHandles"
      :key="handle.id"
      :id="handle.id"
      type="source"
      :position="handle.position"
      class="!h-2.5 !w-2.5 !rounded-full !border-2 !border-card"
      :style="{
        backgroundColor: config.accentVar,
        left: sourceHandles.length > 1
          ? `${((i + 1) / (sourceHandles.length + 1)) * 100}%`
          : '50%',
      }"
    />
  </div>
</template>
