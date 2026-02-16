<script setup lang="ts">
import { useRouter } from 'vue-router';
import { useGraphStore } from '@/stores/graph';
import { useGraphRunnerStore } from '@/stores/graphRunner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { toast } from 'vue-sonner';
import type { GraphExportData, ExportedNode, NodeData, EdgeType } from '@/types/graph';
import {
  FilePlus, Save, FolderOpen, LayoutTemplate, Download, Upload,
  LayoutGrid, Maximize2, Trash2, Circle, Play, Square, PanelRight, Rocket,
} from 'lucide-vue-next';

const emit = defineEmits<{
  fitView: [];
  save: [];
  load: [];
  templates: [];
  import: [];
  run: [];
  abort: [];
  quickRun: [];
}>();

const graph = useGraphStore();
const runner = useGraphRunnerStore();
const router = useRouter();

function onNewGraph() {
  graph.newGraph();
  router.replace({ name: 'graph' });
}

function flattenNodeData(data: NodeData): Omit<ExportedNode, 'type' | 'label' | 'description'> {
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(data)) {
    // Skip internal fields and empty values
    if (key === 'nodeType' || key === 'label' || key === 'description') continue;
    if (val === '' || val === undefined || val === null) continue;
    if (Array.isArray(val) && val.length === 0) continue;
    if (typeof val === 'object' && !Array.isArray(val) && Object.keys(val as object).length === 0) continue;
    out[key] = val;
  }
  return out;
}

function onExport() {
  if (graph.nodeCount === 0) {
    toast.error('Nothing to export — graph is empty');
    return;
  }

  const serialized = graph.serialize();

  // Build id→label map for connections
  const idToLabel = new Map<string, string>();
  for (const n of serialized.nodes) {
    idToLabel.set(n.id, n.data.label);
  }

  const exportData: GraphExportData = {
    formatVersion: 1,
    name: graph.currentGraphName,
    exportedAt: new Date().toISOString(),
    nodes: serialized.nodes.map(n => ({
      type: n.data.nodeType,
      label: n.data.label,
      ...(n.data.description ? { description: n.data.description } : {}),
      ...flattenNodeData(n.data),
    })),
    connections: serialized.edges.map(e => ({
      from: idToLabel.get(e.source) || e.source,
      to: idToLabel.get(e.target) || e.target,
      type: e.data.edgeType as EdgeType,
    })),
  };

  const json = JSON.stringify(exportData, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const safeName = graph.currentGraphName
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\s+/g, '-')
    .toLowerCase() || 'graph';

  const a = document.createElement('a');
  a.href = url;
  a.download = `${safeName}.json`;
  a.click();
  URL.revokeObjectURL(url);

  toast.success('Graph exported');
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
      class="h-2 w-2 shrink-0 fill-primary text-primary dirty-pulse"
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

      <Tooltip>
        <TooltipTrigger as-child>
          <Button variant="ghost" size="sm" class="h-7 w-7 p-0" @click="emit('templates')">
            <LayoutTemplate class="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Templates</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger as-child>
          <Button variant="ghost" size="sm" class="h-7 w-7 p-0" :disabled="graph.nodeCount === 0" @click="onExport()">
            <Download class="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Export as JSON</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger as-child>
          <Button variant="ghost" size="sm" class="h-7 w-7 p-0" @click="emit('import')">
            <Upload class="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Import from JSON</TooltipContent>
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

      <!-- Quick Run -->
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="ghost"
            size="sm"
            class="h-7 w-7 p-0 text-primary hover:text-primary/80"
            :disabled="runner.isRunning"
            @click="emit('quickRun')"
          >
            <Rocket class="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Quick Run (from template)</TooltipContent>
      </Tooltip>

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
