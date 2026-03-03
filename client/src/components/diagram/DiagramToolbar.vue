<script setup lang="ts">
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useDiagramsStore } from '@/stores/diagrams';
import {
  Save, FolderOpen, FilePlus, Maximize2, Download, ImageDown, FileJson, FileType, Grid3x3, MousePointerSquareDashed,
  Minimize2, Maximize, Film,
} from 'lucide-vue-next';

const props = defineProps<{
  snapToGrid: boolean;
  selectedCount: number;
}>();

const diagrams = useDiagramsStore();

const emit = defineEmits<{
  (e: 'fitView'): void;
  (e: 'save'): void;
  (e: 'load'): void;
  (e: 'new'): void;
  (e: 'exportPng'): void;
  (e: 'exportSvg'): void;
  (e: 'exportJson'): void;
  (e: 'exportGif'): void;
  (e: 'toggleSnap'): void;
  (e: 'collapseAll'): void;
  (e: 'expandAll'): void;
}>();

const tools = [
  { event: 'new' as const, icon: FilePlus, label: 'New Diagram' },
  { event: 'save' as const, icon: Save, label: 'Save' },
  { event: 'load' as const, icon: FolderOpen, label: 'Load' },
  { event: 'fitView' as const, icon: Maximize2, label: 'Fit View' },
] as const;

const exportTools = [
  { event: 'exportPng' as const, icon: ImageDown, label: 'Export PNG' },
  { event: 'exportSvg' as const, icon: FileType, label: 'Export SVG' },
  { event: 'exportJson' as const, icon: FileJson, label: 'Export JSON' },
  { event: 'exportGif' as const, icon: Film, label: 'Export GIF' },
] as const;
</script>

<template>
  <div data-testid="diagram-toolbar" class="flex h-9 items-center gap-0.5 border-b border-border bg-muted/30 px-2">
    <TooltipProvider :delay-duration="300">
      <!-- Main tools -->
      <Tooltip v-for="tool in tools" :key="tool.event">
        <TooltipTrigger as-child>
          <Button
            variant="ghost"
            size="sm"
            class="h-7 w-7 p-0"
            :data-testid="`toolbar-${tool.event}`"
            @click="emit(tool.event)"
          >
            <component :is="tool.icon" class="h-3.5 w-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{{ tool.label }}</TooltipContent>
      </Tooltip>

      <!-- Separator -->
      <div class="mx-1 h-4 w-px bg-border" />

      <!-- Snap to grid toggle -->
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="ghost"
            size="sm"
            class="h-7 w-7 p-0"
            data-testid="toolbar-toggleSnap"
            :class="props.snapToGrid ? 'bg-primary/10 text-primary' : ''"
            @click="emit('toggleSnap')"
          >
            <Grid3x3 class="h-3.5 w-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Snap to Grid {{ props.snapToGrid ? '(On)' : '(Off)' }}</TooltipContent>
      </Tooltip>

      <!-- Separator -->
      <div class="mx-1 h-4 w-px bg-border" />

      <!-- Collapse / Expand All -->
      <Tooltip>
        <TooltipTrigger as-child>
          <Button variant="ghost" size="sm" data-testid="toolbar-collapseAll" class="h-7 w-7 p-0" @click="emit('collapseAll')">
            <Minimize2 class="h-3.5 w-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Collapse All Groups</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger as-child>
          <Button variant="ghost" size="sm" data-testid="toolbar-expandAll" class="h-7 w-7 p-0" @click="emit('expandAll')">
            <Maximize class="h-3.5 w-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Expand All Groups</TooltipContent>
      </Tooltip>

      <!-- Separator -->
      <div class="mx-1 h-4 w-px bg-border" />

      <!-- Export tools -->
      <Tooltip v-for="tool in exportTools" :key="tool.event">
        <TooltipTrigger as-child>
          <Button
            variant="ghost"
            size="sm"
            class="h-7 w-7 p-0"
            :data-testid="`toolbar-${tool.event}`"
            @click="emit(tool.event)"
          >
            <component :is="tool.icon" class="h-3.5 w-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{{ tool.label }}</TooltipContent>
      </Tooltip>

      <!-- Spacer -->
      <div class="flex-1" />

      <!-- Selection count badge -->
      <div v-if="props.selectedCount > 1" class="mr-2 flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5">
        <MousePointerSquareDashed class="h-3 w-3 text-primary" />
        <span class="text-[10px] font-medium tabular-nums text-primary">{{ props.selectedCount }} selected</span>
      </div>

      <!-- Stats -->
      <div data-testid="diagram-stats" class="flex items-center gap-2 text-[10px] text-muted-foreground">
        <span>{{ diagrams.nodeCount }} nodes</span>
        <span>{{ diagrams.edgeCount }} edges</span>
      </div>
    </TooltipProvider>
  </div>
</template>
