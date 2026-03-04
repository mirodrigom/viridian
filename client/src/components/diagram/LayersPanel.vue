<script setup lang="ts">
import { computed } from 'vue';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { ChevronUp, ChevronDown, ChevronsUp, ChevronsDown, Layers } from 'lucide-vue-next';
import { useDiagramsStore, type AWSServiceNodeData, type AWSGroupNodeData } from '@/stores/diagrams';

const diagrams = useDiagramsStore();

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
  children: LayerItem[];
}

const layerTree = computed((): LayerItem[] => {
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

// Flatten tree depth-first for rendering
const flatLayers = computed((): LayerItem[] => {
  const result: LayerItem[] = [];
  function walk(items: LayerItem[]) {
    for (const item of items) {
      result.push(item);
      if (item.children.length > 0) walk(item.children);
    }
  }
  walk(layerTree.value);
  return result;
});
</script>

<template>
  <div data-testid="layers-panel" class="flex h-full flex-col bg-background" style="min-height: 0;">
    <!-- Header -->
    <div class="flex h-9 shrink-0 items-center gap-1.5 border-b border-border px-2">
      <Layers class="h-3.5 w-3.5 text-muted-foreground" />
      <span class="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Layers</span>
      <div class="flex-1" />
      <span class="text-[9px] tabular-nums text-muted-foreground/60">{{ diagrams.nodeCount }}</span>
    </div>

    <!-- Layer list -->
    <ScrollArea class="flex-1" style="min-height: 0;">
      <div class="p-1">
        <!-- Empty state -->
        <div v-if="diagrams.nodeCount === 0" class="flex items-center justify-center py-8 text-xs text-muted-foreground">
          No layers yet
        </div>

        <!-- Layer rows -->
        <template v-else>
          <div
            v-for="layer in flatLayers"
            :key="layer.id"
            :data-testid="`layer-${layer.id}`"
            class="group flex items-center gap-1.5 rounded py-1 pr-1 transition-colors"
            :class="[
              diagrams.selectedNodeId === layer.id
                ? 'bg-primary/10 text-primary'
                : 'hover:bg-muted/50 text-foreground',
            ]"
            :style="{ paddingLeft: `${8 + layer.depth * 14}px` }"
            @click="diagrams.selectNode(layer.id)"
          >
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

            <!-- Z-index badge -->
            <span class="shrink-0 text-[9px] tabular-nums text-muted-foreground/50">{{ layer.zIndex }}</span>

            <!-- Z-order buttons (visible on hover or when selected) -->
            <TooltipProvider :delay-duration="400">
              <div
                class="flex shrink-0 items-center gap-0.5 transition-opacity"
                :class="diagrams.selectedNodeId === layer.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'"
              >
                <Tooltip>
                  <TooltipTrigger as-child>
                    <button
                      class="flex h-4 w-4 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                      @click.stop="diagrams.bringToFront(layer.id)"
                    >
                      <ChevronsUp class="h-3 w-3" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="left"><p class="text-xs">Bring to Front</p></TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger as-child>
                    <button
                      class="flex h-4 w-4 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                      @click.stop="diagrams.bringForward(layer.id)"
                    >
                      <ChevronUp class="h-3 w-3" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="left"><p class="text-xs">Bring Forward</p></TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger as-child>
                    <button
                      class="flex h-4 w-4 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                      @click.stop="diagrams.sendBackward(layer.id)"
                    >
                      <ChevronDown class="h-3 w-3" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="left"><p class="text-xs">Send Backward</p></TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger as-child>
                    <button
                      class="flex h-4 w-4 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                      @click.stop="diagrams.sendToBack(layer.id)"
                    >
                      <ChevronsDown class="h-3 w-3" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="left"><p class="text-xs">Send to Back</p></TooltipContent>
                </Tooltip>
              </div>
            </TooltipProvider>
          </div>
        </template>
      </div>
    </ScrollArea>
  </div>
</template>
