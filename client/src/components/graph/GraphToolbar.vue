<script setup lang="ts">
import { useRouter } from 'vue-router';
import { useGraphStore } from '@/stores/graph';
import { useGraphRunnerStore } from '@/stores/graphRunner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import {
  FilePlus, Save, FolderOpen, LayoutGrid, Maximize2,
  Trash2, Circle, Play, Square, PanelRight,
} from 'lucide-vue-next';

const emit = defineEmits<{
  fitView: [];
  save: [];
  load: [];
  run: [];
  abort: [];
}>();

const graph = useGraphStore();
const runner = useGraphRunnerStore();
const router = useRouter();

function onNewGraph() {
  graph.newGraph();
  router.replace({ name: 'graph' });
}
</script>

<template>
  <div class="flex h-10 items-center gap-1.5 border-b border-border bg-muted/30 px-3">
    <!-- Graph name -->
    <Input
      v-model="graph.currentGraphName"
      class="h-7 w-40 border-transparent bg-transparent px-1.5 text-sm font-medium hover:border-border focus:border-border"
      placeholder="Graph name..."
    />

    <!-- Dirty indicator -->
    <Circle
      v-if="graph.isDirty"
      class="h-2 w-2 shrink-0 fill-primary text-primary"
    />

    <div class="flex-1" />

    <!-- Actions -->
    <TooltipProvider :delay-duration="300">
      <Tooltip>
        <TooltipTrigger as-child>
          <Button variant="ghost" size="sm" class="h-7 w-7 p-0" @click="onNewGraph()">
            <FilePlus class="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>New Graph</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger as-child>
          <Button variant="ghost" size="sm" class="h-7 w-7 p-0" @click="emit('save')">
            <Save class="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Save Graph</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger as-child>
          <Button variant="ghost" size="sm" class="h-7 w-7 p-0" @click="emit('load')">
            <FolderOpen class="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Load Graph</TooltipContent>
      </Tooltip>

      <div class="mx-1 h-4 w-px bg-border" />

      <Tooltip>
        <TooltipTrigger as-child>
          <Button variant="ghost" size="sm" class="h-7 w-7 p-0" @click="graph.autoLayout()">
            <LayoutGrid class="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Auto Layout</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger as-child>
          <Button variant="ghost" size="sm" class="h-7 w-7 p-0" @click="emit('fitView')">
            <Maximize2 class="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Fit View</TooltipContent>
      </Tooltip>

      <div class="mx-1 h-4 w-px bg-border" />

      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="ghost"
            size="sm"
            class="h-7 w-7 p-0 text-destructive hover:text-destructive"
            :disabled="!graph.selectedNodeId"
            @click="graph.selectedNodeId && graph.removeNode(graph.selectedNodeId)"
          >
            <Trash2 class="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Delete Selected</TooltipContent>
      </Tooltip>

      <div class="mx-1 h-4 w-px bg-border" />

      <!-- Run / Stop -->
      <Tooltip v-if="!runner.isRunning">
        <TooltipTrigger as-child>
          <Button
            variant="ghost"
            size="sm"
            class="h-7 w-7 p-0 text-green-500 hover:text-green-400"
            :disabled="graph.nodeCount === 0"
            @click="emit('run')"
          >
            <Play class="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Run Graph</TooltipContent>
      </Tooltip>

      <Tooltip v-else>
        <TooltipTrigger as-child>
          <Button
            variant="ghost"
            size="sm"
            class="h-7 w-7 p-0 text-red-500 hover:text-red-400"
            @click="emit('abort')"
          >
            <Square class="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Stop Run</TooltipContent>
      </Tooltip>

      <!-- Toggle Runner Panel -->
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="ghost"
            size="sm"
            class="h-7 w-7 p-0"
            :class="runner.showRunnerPanel ? 'text-primary' : ''"
            @click="runner.togglePanel()"
          >
            <PanelRight class="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{{ runner.showRunnerPanel ? 'Show Properties' : 'Show Runner' }}</TooltipContent>
      </Tooltip>
    </TooltipProvider>

    <!-- Stats -->
    <div class="ml-2 text-[10px] text-muted-foreground">
      {{ graph.nodeCount }} nodes · {{ graph.edgeCount }} edges
    </div>
  </div>
</template>
