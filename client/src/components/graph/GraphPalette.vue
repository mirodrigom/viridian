<script setup lang="ts">
import type { GraphNodeType } from '@/types/graph';
import { NODE_CONFIG } from '@/types/graph';
import { Bot, GitBranch, Sparkles, Zap, Server, ShieldCheck } from 'lucide-vue-next';
import { ScrollArea } from '@/components/ui/scroll-area';

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
</script>

<template>
  <div class="flex h-full flex-col border-r border-border bg-muted/20">
    <div class="border-b border-border px-3 py-2">
      <h3 class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Nodes</h3>
    </div>

    <ScrollArea class="flex-1">
      <div class="space-y-1.5 p-2">
        <div
          v-for="node in nodeTypes"
          :key="node.type"
          class="cursor-grab rounded-md border border-border/50 bg-card p-2.5 transition-all hover:border-border hover:shadow-sm active:cursor-grabbing"
          :class="NODE_CONFIG[node.type].accentClass"
          draggable="true"
          @dragstart="(e) => onDragStart(e, node.type)"
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
