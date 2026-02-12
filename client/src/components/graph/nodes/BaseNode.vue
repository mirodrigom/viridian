<script setup lang="ts">
import { computed } from 'vue';
import { Handle, Position } from '@vue-flow/core';
import type { NodeData } from '@/types/graph';
import { NODE_CONFIG, CONNECTION_RULES } from '@/types/graph';
import { useGraphStore } from '@/stores/graph';
import { useGraphRunnerStore } from '@/stores/graphRunner';
import { X, Loader2, CheckCircle, XCircle } from 'lucide-vue-next';

const props = defineProps<{
  id: string;
  data: NodeData;
  selected?: boolean;
}>();

const graph = useGraphStore();
const runner = useGraphRunnerStore();

const config = computed(() => NODE_CONFIG[props.data.nodeType]);

// Execution state — uses store method for reliable reactivity
const execStatus = computed(() => runner.nodeExecStatus(props.id));

// Non-executable nodes (skill/mcp/rule) pulse when their parent agent is running
const NON_EXEC_TYPES = new Set(['skill', 'mcp', 'rule']);
const hasRunningParent = computed(() => {
  if (!runner.isRunning || execStatus.value) return false;
  if (!NON_EXEC_TYPES.has(props.data.nodeType)) return false;
  // Check if any edge targeting this node has a source that is actively running
  return graph.edges.some(
    e => e.target === props.id && runner.activeNodeIds.has(e.source),
  );
});

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
      execStatus === 'running' ? 'ring-2 ring-yellow-500/70 shadow-lg shadow-yellow-500/10 exec-pulse' : '',
      execStatus === 'completed' ? 'ring-2 ring-green-500/50 shadow-lg shadow-green-500/10' : '',
      execStatus === 'failed' ? 'ring-2 ring-red-500/50 shadow-lg shadow-red-500/10' : '',
      hasRunningParent ? 'ring-1 ring-yellow-400/30 auxiliary-pulse' : '',
    ]"
    @click="execStatus ? runner.selectExecution(id) : undefined"
  >
    <!-- Execution status badge -->
    <div v-if="execStatus" class="absolute -right-1.5 -top-1.5 z-10">
      <Loader2 v-if="execStatus === 'running'" class="h-4 w-4 animate-spin text-yellow-500 drop-shadow" />
      <CheckCircle v-else-if="execStatus === 'completed'" class="h-4 w-4 text-green-500 drop-shadow" />
      <XCircle v-else-if="execStatus === 'failed'" class="h-4 w-4 text-red-500 drop-shadow" />
    </div>

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

<style>
.exec-pulse {
  animation: exec-glow 2s ease-in-out infinite;
}

@keyframes exec-glow {
  0%, 100% { box-shadow: 0 0 8px oklch(0.8 0.15 85 / 20%); }
  50% { box-shadow: 0 0 16px oklch(0.8 0.15 85 / 40%); }
}

.auxiliary-pulse {
  animation: auxiliary-glow 2.5s ease-in-out infinite;
}

@keyframes auxiliary-glow {
  0%, 100% { box-shadow: 0 0 4px oklch(0.8 0.12 85 / 10%); }
  50% { box-shadow: 0 0 10px oklch(0.8 0.12 85 / 25%); }
}
</style>
