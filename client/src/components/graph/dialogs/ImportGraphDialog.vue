<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useGraphStore } from '@/stores/graph';
import { uuid } from '@/lib/utils';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'vue-sonner';
import {
  Upload, FileJson, AlertTriangle,
  Bot, GitBranch, Sparkles, Zap, Server, ShieldCheck,
} from 'lucide-vue-next';
import type {
  GraphExportData, ExportedNode, ExportedConnection,
  GraphNodeType, EdgeType, NodeData, SerializedNode, SerializedEdge, GraphEdgeData,
} from '@/types/graph';

const open = defineModel<boolean>('open', { default: false });
const graph = useGraphStore();

const fileInput = ref<HTMLInputElement | null>(null);
const parsed = ref<GraphExportData | null>(null);
const parseError = ref<string | null>(null);
const fileName = ref('');

watch(open, (val) => {
  if (!val) {
    parsed.value = null;
    parseError.value = null;
    fileName.value = '';
  }
});

function onPickFile() {
  fileInput.value?.click();
}

function onFileSelected(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;

  fileName.value = file.name;
  parseError.value = null;
  parsed.value = null;

  const reader = new FileReader();
  reader.onload = () => {
    try {
      const json = JSON.parse(reader.result as string);
      parsed.value = validateExport(json);
    } catch (e) {
      parseError.value = e instanceof Error ? e.message : 'Invalid JSON file';
    }
  };
  reader.onerror = () => {
    parseError.value = 'Failed to read file';
  };
  reader.readAsText(file);

  input.value = '';
}

// ─── Validation ───────────────────────────────────────────────────────

const validNodeTypes = new Set<GraphNodeType>(['agent', 'subagent', 'expert', 'skill', 'mcp', 'rule']);
const validEdgeTypes = new Set<EdgeType>(['delegation', 'skill-usage', 'tool-access', 'rule-constraint', 'data-flow']);

function validateExport(data: unknown): GraphExportData {
  if (!data || typeof data !== 'object') {
    throw new Error('File does not contain a valid JSON object');
  }

  const obj = data as Record<string, unknown>;

  if (obj.formatVersion !== 1) {
    throw new Error(
      obj.formatVersion
        ? `Unsupported format version: ${obj.formatVersion}`
        : 'Missing formatVersion — not a valid graph export file',
    );
  }

  if (!Array.isArray(obj.nodes)) {
    throw new Error('Missing or invalid nodes array');
  }
  if (obj.nodes.length === 0) {
    throw new Error('Graph has no nodes');
  }

  // Validate nodes
  const labels = new Set<string>();
  for (const node of obj.nodes as ExportedNode[]) {
    if (!node.type || !node.label) {
      throw new Error('Each node must have a "type" and "label"');
    }
    if (!validNodeTypes.has(node.type)) {
      throw new Error(`Unknown node type: "${node.type}"`);
    }
    if (labels.has(node.label)) {
      throw new Error(`Duplicate node label: "${node.label}". Each label must be unique.`);
    }
    labels.add(node.label);
  }

  // Validate connections (optional — graph can have disconnected nodes)
  const connections = (obj.connections as ExportedConnection[]) || [];
  for (const conn of connections) {
    if (!conn.from || !conn.to || !conn.type) {
      throw new Error('Each connection must have "from", "to", and "type"');
    }
    if (!validEdgeTypes.has(conn.type)) {
      throw new Error(`Unknown connection type: "${conn.type}"`);
    }
    if (!labels.has(conn.from)) {
      throw new Error(`Connection references unknown node: "${conn.from}"`);
    }
    if (!labels.has(conn.to)) {
      throw new Error(`Connection references unknown node: "${conn.to}"`);
    }
  }

  return {
    formatVersion: 1,
    name: (obj.name as string) || 'Imported Graph',
    description: obj.description as string | undefined,
    exportedAt: (obj.exportedAt as string) || new Date().toISOString(),
    nodes: obj.nodes as ExportedNode[],
    connections,
  };
}

// ─── Preview ──────────────────────────────────────────────────────────

const previewStats = computed(() => {
  if (!parsed.value) return null;
  const counts: Record<string, number> = {};
  for (const n of parsed.value.nodes) {
    counts[n.type] = (counts[n.type] || 0) + 1;
  }
  return counts;
});

const typeIcons: Record<string, typeof Bot> = {
  agent: Bot, subagent: GitBranch, expert: Sparkles,
  skill: Zap, mcp: Server, rule: ShieldCheck,
};

const typeColors: Record<string, string> = {
  agent: 'text-primary', subagent: 'text-chart-2', expert: 'text-chart-3',
  skill: 'text-chart-5', mcp: 'text-chart-4', rule: 'text-destructive',
};

// ─── Import: reconstruct internal format from exported data ───────────

function buildNodeData(exported: ExportedNode): NodeData {
  switch (exported.type) {
    case 'agent':
      return {
        nodeType: 'agent',
        label: exported.label,
        description: exported.description,
        model: exported.model || 'claude-opus-4-6',
        systemPrompt: exported.systemPrompt || '',
        permissionMode: exported.permissionMode || 'bypassPermissions',
        maxTokens: exported.maxTokens || 200000,
        allowedTools: exported.allowedTools || [],
        disallowedTools: exported.disallowedTools || [],
      };
    case 'subagent':
      return {
        nodeType: 'subagent',
        label: exported.label,
        description: exported.description,
        model: exported.model || 'claude-sonnet-4-5-20250929',
        systemPrompt: exported.systemPrompt || '',
        permissionMode: exported.permissionMode || 'bypassPermissions',
        taskDescription: exported.taskDescription || '',
      };
    case 'expert':
      return {
        nodeType: 'expert',
        label: exported.label,
        description: exported.description,
        model: exported.model || 'claude-opus-4-6',
        systemPrompt: exported.systemPrompt || '',
        specialty: exported.specialty || '',
      };
    case 'skill':
      return {
        nodeType: 'skill',
        label: exported.label,
        description: exported.description,
        command: exported.command || '',
        promptTemplate: exported.promptTemplate || '',
        allowedTools: exported.allowedTools || [],
      };
    case 'mcp':
      return {
        nodeType: 'mcp',
        label: exported.label,
        description: exported.description,
        serverType: exported.serverType || 'stdio',
        command: exported.command,
        args: exported.args,
        url: exported.url,
        env: exported.env,
        headers: exported.headers,
        tools: exported.tools,
      };
    case 'rule':
      return {
        nodeType: 'rule',
        label: exported.label,
        description: exported.description,
        ruleType: exported.ruleType || 'guideline',
        ruleText: exported.ruleText || '',
        scope: exported.scope || 'project',
      };
  }
}

const EDGE_HANDLE_MAP: Record<EdgeType, { sourceHandle: string; targetHandle: string }> = {
  'delegation': { sourceHandle: 'delegation-out', targetHandle: 'delegation-in' },
  'skill-usage': { sourceHandle: 'skill-out', targetHandle: 'skill-in' },
  'tool-access': { sourceHandle: 'tool-out', targetHandle: 'tool-in' },
  'rule-constraint': { sourceHandle: 'rule-out', targetHandle: 'rule-in' },
  'data-flow': { sourceHandle: 'data-out', targetHandle: 'data-in' },
};

function onImport() {
  if (!parsed.value) return;

  const name = parsed.value.name;

  // Assign UUIDs to each node, keyed by label
  const labelToId = new Map<string, string>();
  for (const n of parsed.value.nodes) {
    labelToId.set(n.label, uuid());
  }

  // Build serialized nodes (positions will be set by autoLayout)
  const nodes: SerializedNode[] = parsed.value.nodes.map(n => ({
    id: labelToId.get(n.label)!,
    type: n.type,
    position: { x: 0, y: 0 },
    data: buildNodeData(n),
  }));

  // Build serialized edges from connections
  const edges: SerializedEdge[] = parsed.value.connections.map(conn => {
    const sourceId = labelToId.get(conn.from)!;
    const targetId = labelToId.get(conn.to)!;
    const handles = EDGE_HANDLE_MAP[conn.type];
    const edgeData: GraphEdgeData = {
      edgeType: conn.type,
      label: conn.type,
      animated: conn.type === 'delegation' || conn.type === 'data-flow',
    };
    return {
      id: `e-${sourceId}-${targetId}`,
      source: sourceId,
      target: targetId,
      sourceHandle: handles.sourceHandle,
      targetHandle: handles.targetHandle,
      data: edgeData,
    };
  });

  // Load into store (loadTemplate remaps IDs again, but that's fine — ours are already unique)
  graph.loadTemplate({
    id: 'imported',
    name,
    description: parsed.value.description || '',
    category: 'development',
    nodes,
    edges,
  });

  // Auto-layout since exported data has no positions
  graph.autoLayout();

  toast.success(`Imported "${name}" (${nodes.length} nodes)`);
  open.value = false;
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2">
          <Upload class="h-4 w-4 text-primary" />
          Import Graph
        </DialogTitle>
        <DialogDescription>Load a graph from a JSON export file</DialogDescription>
      </DialogHeader>

      <div class="space-y-4 py-2">
        <!-- Hidden file input -->
        <input
          ref="fileInput"
          type="file"
          accept=".json,application/json"
          class="hidden"
          @change="onFileSelected"
        />

        <!-- File picker -->
        <button
          class="flex w-full flex-col items-center gap-2 rounded-lg border-2 border-dashed
                 border-border px-4 py-8 text-sm text-muted-foreground transition-colors
                 hover:border-primary/50 hover:bg-muted/30"
          @click="onPickFile()"
        >
          <FileJson class="h-8 w-8 text-muted-foreground/50" />
          <span>{{ fileName || 'Click to select a .json file' }}</span>
        </button>

        <!-- Parse error -->
        <div
          v-if="parseError"
          class="flex items-start gap-2 rounded border border-destructive/30
                 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          <AlertTriangle class="mt-0.5 h-4 w-4 shrink-0" />
          <span>{{ parseError }}</span>
        </div>

        <!-- Preview -->
        <div v-if="parsed" class="space-y-3">
          <div class="rounded border border-border bg-muted/30 p-3">
            <div class="text-sm font-medium">{{ parsed.name }}</div>
            <div v-if="parsed.description" class="mt-0.5 text-xs text-muted-foreground">
              {{ parsed.description }}
            </div>
            <div class="mt-1.5 flex items-center gap-3 text-[10px] text-muted-foreground/70">
              <span>{{ parsed.nodes.length }} nodes</span>
              <span>{{ parsed.connections.length }} connections</span>
              <span>Exported {{ new Date(parsed.exportedAt).toLocaleString() }}</span>
            </div>
          </div>

          <div class="flex flex-wrap gap-1.5">
            <Badge
              v-for="(count, type) in previewStats"
              :key="type"
              variant="outline"
              class="gap-1 text-xs"
            >
              <component :is="typeIcons[type as string] || Bot" class="h-3 w-3" :class="typeColors[type as string]" />
              {{ count }} {{ type }}{{ count !== 1 ? 's' : '' }}
            </Badge>
          </div>
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" @click="open = false">Cancel</Button>
        <Button :disabled="!parsed" @click="onImport">
          <Upload class="mr-1.5 h-3.5 w-3.5" />
          Import
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
