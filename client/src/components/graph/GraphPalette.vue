<script setup lang="ts">
import type { GraphNodeType } from '@/types/graph';
import { NODE_CONFIG } from '@/types/graph';
import { useGraphStore } from '@/stores/graph';
import { Input } from '@/components/ui/input';
import { Bot, GitBranch, Sparkles, Zap, Server, ShieldCheck, Circle } from 'lucide-vue-next';
import { ScrollArea } from '@/components/ui/scroll-area';

const props = defineProps<{ mobile?: boolean }>();
const emit = defineEmits<{ 'add-node': [type: GraphNodeType] }>();

const graph = useGraphStore();

const nodeTypes: { type: GraphNodeType; icon: typeof Bot }[] = [
  { type: 'agent', icon: Bot },
  { type: 'subagent', icon: GitBranch },
  { type: 'expert', icon: Sparkles },
  { type: 'skill', icon: Zap },
  { type: 'mcp', icon: Server },
  { type: 'rule', icon: ShieldCheck },
];

function onDragStart(event: DragEvent, type: GraphNodeType) {
  if (!event.dataTransfer) return;
  event.dataTransfer.setData('application/vueflow', type);
  event.dataTransfer.effectAllowed = 'move';
}

function onTapAdd(type: GraphNodeType) {
  emit('add-node', type);
}
</script>

<template>
  <div data-testid="graph-palette" class="flex shrink-0 flex-col bg-background">
    <!-- Graph name -->
    <div class="flex h-9 items-center gap-1.5 border-b border-border px-2">
      <Input
        v-model="graph.currentGraphName"
        class="h-6 flex-1 border-transparent bg-transparent px-1 text-xs font-medium hover:border-border focus:border-border"
        placeholder="Graph name..."
      />
      <Circle
        v-if="graph.isDirty"
        class="h-2 w-2 shrink-0 fill-primary text-primary dirty-pulse"
      />
    </div>

    <div class="flex h-7 items-center border-b border-border px-3">
      <span class="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Nodes</span>
    </div>

    <ScrollArea class="flex-1">
      <div class="space-y-1.5 p-2">
        <div
          v-for="node in nodeTypes"
          :key="node.type"
          :data-testid="`graph-node-type-${node.type}`"
          class="rounded-md border border-border/50 bg-card p-2.5 transition-all hover:border-border hover:shadow-sm"
          :class="[NODE_CONFIG[node.type].accentClass, props.mobile ? 'cursor-pointer active:bg-accent' : 'cursor-grab active:cursor-grabbing']"
          :draggable="!props.mobile"
          @dragstart="(e) => !props.mobile && onDragStart(e, node.type)"
          @click="props.mobile && onTapAdd(node.type)"
        >
          <div class="flex items-center gap-2">
            <component :is="node.icon" class="h-4 w-4 shrink-0" />
            <div class="min-w-0 flex-1">
              <div class="text-sm font-medium">{{ NODE_CONFIG[node.type].label }}</div>
              <div class="truncate text-[10px] opacity-70">{{ NODE_CONFIG[node.type].description }}</div>
            </div>
          </div>
        </div>
      </div>
    </ScrollArea>
  </div>
</template>
