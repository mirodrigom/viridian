<script setup lang="ts">
import { computed } from 'vue';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Plus, Minus, X } from 'lucide-vue-next';
import { useDiagramsStore, type AWSServiceNodeData, type AWSGroupNodeData, type DiagramEdgeData } from '@/stores/diagrams';

const diagrams = useDiagramsStore();

const nodeData = computed(() => {
  if (!diagrams.selectedNode) return null;
  return diagrams.selectedNode.data as AWSServiceNodeData | AWSGroupNodeData;
});

const edgeData = computed(() => {
  if (!diagrams.selectedEdge) return null;
  return (diagrams.selectedEdge.data || {}) as DiagramEdgeData;
});

function updateNodeField(field: string, value: string) {
  if (!diagrams.selectedNodeId) return;
  diagrams.updateNodeData(diagrams.selectedNodeId, { [field]: value } as never);
}

function updateEdgeField(field: string, value: string | boolean) {
  if (!diagrams.selectedEdgeId) return;
  diagrams.updateEdgeData(diagrams.selectedEdgeId, { [field]: value } as never);
}

const currentZIndex = computed(() => {
  if (!diagrams.selectedNodeId) return 0;
  return diagrams.getNodeZIndex(diagrams.selectedNodeId);
});

const edgeTypeOptions = [
  { value: 'default', label: 'Bezier' },
  { value: 'straight', label: 'Straight' },
  { value: 'step', label: 'Step' },
  { value: 'smoothstep', label: 'Smooth' },
] as const;

const markerOptions = [
  { value: 'arrowclosed', label: 'Arrow' },
  { value: 'arrow', label: 'Open' },
  { value: 'none', label: 'None' },
] as const;

const edgeColors = [
  { value: '', label: 'Default' },
  { value: '#FF9900', label: 'Orange' },
  { value: '#3F8624', label: 'Green' },
  { value: '#C925D1', label: 'Purple' },
  { value: '#8C4FFF', label: 'Violet' },
  { value: '#DD344C', label: 'Red' },
  { value: '#01A88D', label: 'Teal' },
  { value: '#E7157B', label: 'Pink' },
  { value: '#147EBA', label: 'Blue' },
];

const quickStyles = [
  { label: 'Data Flow', color: '#3F8624', style: 'solid' as const, animated: true, dotAnimation: true, dotSpeed: 'medium' as const, dotCount: 2 },
  { label: 'Request', color: '#FF9900', style: 'dashed' as const, animated: true, dotAnimation: true, dotSpeed: 'fast' as const, dotCount: 1 },
  { label: 'Error', color: '#DD344C', style: 'dotted' as const, animated: true, dotAnimation: true, dotSpeed: 'slow' as const, dotCount: 1 },
  { label: 'Sync', color: '#147EBA', style: 'solid' as const, animated: true, dotAnimation: true, dotSpeed: 'fast' as const, dotCount: 3 },
  { label: 'Async', color: '#C925D1', style: 'dashed' as const, animated: true, dotAnimation: true, dotSpeed: 'medium' as const, dotCount: 2 },
  { label: 'Static', color: '', style: 'solid' as const, animated: false, dotAnimation: false, dotSpeed: 'medium' as const, dotCount: 1 },
];

function applyQuickStyle(qs: typeof quickStyles[number]) {
  if (!diagrams.selectedEdgeId) return;
  diagrams.updateEdgeData(diagrams.selectedEdgeId, {
    color: qs.color,
    style: qs.style,
    animated: qs.animated,
    dotAnimation: qs.dotAnimation,
    dotSpeed: qs.dotSpeed,
    dotCount: qs.dotCount,
  });
}

const labelSizeOptions = [
  { value: 'small' as const, label: 'S' },
  { value: 'medium' as const, label: 'M' },
  { value: 'large' as const, label: 'L' },
];
</script>

<template>
  <div data-testid="properties-panel" class="flex h-full flex-col border-l border-border bg-background">
    <div class="flex h-9 items-center justify-between border-b border-border px-3">
      <span class="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Properties</span>
      <Button
        variant="ghost"
        size="sm"
        class="h-6 w-6 p-0"
        @click="diagrams.selectNode(null); diagrams.selectEdge(null)"
      >
        <X class="h-3.5 w-3.5" />
      </Button>
    </div>

    <ScrollArea class="flex-1">
      <!-- Node properties -->
      <div v-if="nodeData" class="space-y-4 p-3">
        <!-- Service node -->
        <template v-if="nodeData.nodeType === 'aws-service'">
          <div class="space-y-3">
            <!-- Service info (read-only) -->
            <div class="flex items-center gap-2 rounded-md border border-border p-2">
              <img v-if="(nodeData as AWSServiceNodeData).service.iconUrl" :src="(nodeData as AWSServiceNodeData).service.iconUrl" :alt="(nodeData as AWSServiceNodeData).service.shortName" class="h-5 w-5 shrink-0" />
              <svg v-else class="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" :stroke="(nodeData as AWSServiceNodeData).service.color" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path :d="(nodeData as AWSServiceNodeData).service.iconPath" />
              </svg>
              <div class="min-w-0">
                <div class="text-xs font-medium">{{ (nodeData as AWSServiceNodeData).service.name }}</div>
                <div class="text-[10px] text-muted-foreground">{{ (nodeData as AWSServiceNodeData).service.category }}</div>
              </div>
            </div>

            <!-- Custom label -->
            <div class="space-y-1">
              <Label class="text-[11px]">Custom Label</Label>
              <Input
                :model-value="nodeData.customLabel"
                data-testid="prop-custom-label"
                class="h-7 text-xs"
                placeholder="Override display name..."
                @update:model-value="(v: string) => updateNodeField('customLabel', v)"
              />
            </div>

            <!-- Description -->
            <div class="space-y-1">
              <Label class="text-[11px]">Description</Label>
              <textarea
                :value="nodeData.description"
                class="w-full rounded-md border border-border bg-transparent px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                rows="2"
                placeholder="Service description..."
                @input="updateNodeField('description', ($event.target as HTMLTextAreaElement).value)"
              />
            </div>

            <!-- Notes -->
            <div class="space-y-1">
              <Label class="text-[11px]">Notes</Label>
              <textarea
                :value="nodeData.notes"
                class="w-full rounded-md border border-border bg-transparent px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                rows="3"
                placeholder="Additional notes..."
                @input="updateNodeField('notes', ($event.target as HTMLTextAreaElement).value)"
              />
            </div>

            <!-- Z-Index Layer -->
            <div class="space-y-1">
              <Label class="text-[11px]">Layer (Z-Index)</Label>
              <div class="flex items-center gap-2 rounded-md border border-border p-2">
                <Button variant="ghost" size="sm" class="h-6 w-6 p-0" @click="diagrams.sendBackward(diagrams.selectedNodeId!)">
                  <Minus class="h-3 w-3" />
                </Button>
                <span class="flex-1 text-center text-xs font-medium tabular-nums">{{ currentZIndex }}</span>
                <Button variant="ghost" size="sm" class="h-6 w-6 p-0" @click="diagrams.bringForward(diagrams.selectedNodeId!)">
                  <Plus class="h-3 w-3" />
                </Button>
              </div>
            </div>
          </div>
        </template>

        <!-- Group node -->
        <template v-if="nodeData.nodeType === 'aws-group'">
          <div class="space-y-3">
            <!-- Group type info -->
            <div class="flex items-center gap-2 rounded-md border border-border p-2">
              <div
                class="h-5 w-5 shrink-0 rounded border"
                :style="{
                  borderColor: (nodeData as AWSGroupNodeData).groupType.color + '80',
                  borderStyle: (nodeData as AWSGroupNodeData).groupType.borderStyle,
                  backgroundColor: (nodeData as AWSGroupNodeData).groupType.color + '15',
                }"
              />
              <div class="min-w-0">
                <div class="text-xs font-medium">{{ (nodeData as AWSGroupNodeData).groupType.name }}</div>
                <div class="text-[10px] text-muted-foreground">{{ (nodeData as AWSGroupNodeData).groupType.description }}</div>
              </div>
            </div>

            <!-- Custom label -->
            <div class="space-y-1">
              <Label class="text-[11px]">Custom Label</Label>
              <Input
                :model-value="nodeData.customLabel"
                data-testid="prop-custom-label"
                class="h-7 text-xs"
                placeholder="Override display name..."
                @update:model-value="(v: string) => updateNodeField('customLabel', v)"
              />
            </div>

            <!-- Children count -->
            <div class="flex items-center justify-between rounded-md border border-border p-2">
              <span class="text-[10px] text-muted-foreground">Children nodes</span>
              <span class="text-xs font-medium tabular-nums">
                {{ diagrams.getGroupChildren(diagrams.selectedNodeId!).length }}
              </span>
            </div>

            <!-- Notes -->
            <div class="space-y-1">
              <Label class="text-[11px]">Notes</Label>
              <textarea
                :value="nodeData.notes"
                class="w-full rounded-md border border-border bg-transparent px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                rows="3"
                placeholder="Additional notes..."
                @input="updateNodeField('notes', ($event.target as HTMLTextAreaElement).value)"
              />
            </div>

            <!-- Z-Index Layer -->
            <div class="space-y-1">
              <Label class="text-[11px]">Layer (Z-Index)</Label>
              <div class="flex items-center gap-2 rounded-md border border-border p-2">
                <Button variant="ghost" size="sm" class="h-6 w-6 p-0" @click="diagrams.sendBackward(diagrams.selectedNodeId!)">
                  <Minus class="h-3 w-3" />
                </Button>
                <span class="flex-1 text-center text-xs font-medium tabular-nums">{{ currentZIndex }}</span>
                <Button variant="ghost" size="sm" class="h-6 w-6 p-0" @click="diagrams.bringForward(diagrams.selectedNodeId!)">
                  <Plus class="h-3 w-3" />
                </Button>
              </div>
            </div>
          </div>
        </template>
      </div>

      <!-- Edge properties -->
      <div v-else-if="edgeData" class="space-y-4 p-3">
        <div class="space-y-3">
          <!-- Quick Styles -->
          <div class="space-y-1">
            <Label class="text-[11px]">Quick Styles</Label>
            <div class="flex flex-wrap gap-1">
              <button
                v-for="qs in quickStyles"
                :key="qs.label"
                class="rounded-full border px-2 py-0.5 text-[10px] font-medium transition-all hover:scale-105"
                :style="{
                  borderColor: (qs.color || 'var(--primary)') + '60',
                  backgroundColor: (qs.color || 'var(--primary)') + '15',
                  color: qs.color || 'var(--primary)',
                }"
                @click="applyQuickStyle(qs)"
              >
                {{ qs.label }}
              </button>
            </div>
          </div>

          <!-- Edge label -->
          <div class="space-y-1">
            <Label class="text-[11px]">Label</Label>
            <Input
              :model-value="edgeData.label || ''"
              class="h-7 text-xs"
              placeholder="Connection label..."
              @update:model-value="(v: string) => updateEdgeField('label', v)"
            />
          </div>

          <!-- Label size -->
          <div class="space-y-1">
            <Label class="text-[11px]">Label Size</Label>
            <div class="flex gap-1">
              <button
                v-for="ls in labelSizeOptions"
                :key="ls.value"
                class="flex-1 rounded-md border px-2 py-1 text-[10px] font-medium transition-colors"
                :class="(edgeData.labelSize || 'small') === ls.value ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-muted/50'"
                @click="updateEdgeField('labelSize', ls.value)"
              >
                {{ ls.label }}
              </button>
            </div>
          </div>

          <!-- Edge type -->
          <div class="space-y-1">
            <Label class="text-[11px]">Edge Type</Label>
            <div class="grid grid-cols-2 gap-1">
              <button
                v-for="opt in edgeTypeOptions"
                :key="opt.value"
                class="rounded-md border px-2 py-1 text-[10px] font-medium transition-colors"
                :class="(edgeData.edgeType || 'default') === opt.value ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-muted/50'"
                @click="updateEdgeField('edgeType', opt.value)"
              >
                {{ opt.label }}
              </button>
            </div>
          </div>

          <!-- Edge style -->
          <div class="space-y-1">
            <Label class="text-[11px]">Line Style</Label>
            <div class="flex gap-1">
              <button
                v-for="style in ['solid', 'dashed', 'dotted'] as const"
                :key="style"
                class="flex-1 rounded-md border px-2 py-1 text-[10px] font-medium capitalize transition-colors"
                :class="edgeData.style === style ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-muted/50'"
                @click="updateEdgeField('style', style)"
              >
                {{ style }}
              </button>
            </div>
          </div>

          <!-- Edge color -->
          <div class="space-y-1">
            <Label class="text-[11px]">Color</Label>
            <div class="flex flex-wrap gap-1">
              <button
                v-for="c in edgeColors"
                :key="c.value"
                class="h-6 w-6 rounded-md border transition-all"
                :class="(edgeData.color || '') === c.value ? 'ring-2 ring-primary ring-offset-1 ring-offset-background' : 'hover:scale-110'"
                :style="{ backgroundColor: c.value || 'var(--primary)', borderColor: c.value ? c.value + '60' : 'var(--border)' }"
                :title="c.label"
                @click="updateEdgeField('color', c.value)"
              />
            </div>
          </div>

          <!-- Arrow markers -->
          <div class="space-y-1">
            <Label class="text-[11px]">Start Marker</Label>
            <div class="flex gap-1">
              <button
                v-for="opt in markerOptions"
                :key="opt.value"
                class="flex-1 rounded-md border px-2 py-1 text-[10px] font-medium transition-colors"
                :class="(edgeData.markerStart || 'none') === opt.value ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-muted/50'"
                @click="updateEdgeField('markerStart', opt.value)"
              >
                {{ opt.label }}
              </button>
            </div>
          </div>

          <div class="space-y-1">
            <Label class="text-[11px]">End Marker</Label>
            <div class="flex gap-1">
              <button
                v-for="opt in markerOptions"
                :key="opt.value"
                class="flex-1 rounded-md border px-2 py-1 text-[10px] font-medium transition-colors"
                :class="(edgeData.markerEnd || 'arrowclosed') === opt.value ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-muted/50'"
                @click="updateEdgeField('markerEnd', opt.value)"
              >
                {{ opt.label }}
              </button>
            </div>
          </div>

          <!-- Animated -->
          <div class="flex items-center justify-between">
            <Label class="text-[11px]">Animated Flow</Label>
            <button
              class="relative h-5 w-9 rounded-full border transition-colors"
              :class="edgeData.animated ? 'border-primary bg-primary' : 'border-border bg-muted'"
              @click="updateEdgeField('animated', !edgeData.animated)"
            >
              <span
                class="absolute left-0.5 top-0.5 h-3.5 w-3.5 rounded-full bg-white transition-transform"
                :class="edgeData.animated ? 'translate-x-4' : ''"
              />
            </button>
          </div>

          <!-- Dot Animation (only when animated is on) -->
          <template v-if="edgeData.animated">
            <div class="flex items-center justify-between">
              <Label class="text-[11px]">Animated Dots</Label>
              <button
                class="relative h-5 w-9 rounded-full border transition-colors"
                :class="edgeData.dotAnimation ? 'border-primary bg-primary' : 'border-border bg-muted'"
                @click="updateEdgeField('dotAnimation', !edgeData.dotAnimation)"
              >
                <span
                  class="absolute left-0.5 top-0.5 h-3.5 w-3.5 rounded-full bg-white transition-transform"
                  :class="edgeData.dotAnimation ? 'translate-x-4' : ''"
                />
              </button>
            </div>

            <template v-if="edgeData.dotAnimation">
              <!-- Dot count -->
              <div class="space-y-1">
                <Label class="text-[11px]">Dot Count</Label>
                <div class="flex gap-1">
                  <button
                    v-for="count in [1, 2, 3]"
                    :key="count"
                    class="flex-1 rounded-md border px-2 py-1 text-[10px] font-medium transition-colors"
                    :class="(edgeData.dotCount || 1) === count ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-muted/50'"
                    @click="updateEdgeField('dotCount', count as any)"
                  >
                    {{ count }}
                  </button>
                </div>
              </div>

              <!-- Dot speed -->
              <div class="space-y-1">
                <Label class="text-[11px]">Dot Speed</Label>
                <div class="flex gap-1">
                  <button
                    v-for="speed in ['slow', 'medium', 'fast'] as const"
                    :key="speed"
                    class="flex-1 rounded-md border px-2 py-1 text-[10px] font-medium capitalize transition-colors"
                    :class="(edgeData.dotSpeed || 'medium') === speed ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-muted/50'"
                    @click="updateEdgeField('dotSpeed', speed)"
                  >
                    {{ speed }}
                  </button>
                </div>
              </div>

              <!-- Dot color -->
              <div class="space-y-1">
                <Label class="text-[11px]">Dot Color</Label>
                <div class="flex flex-wrap gap-1">
                  <button
                    v-for="c in edgeColors"
                    :key="'dot-' + c.value"
                    class="h-6 w-6 rounded-md border transition-all"
                    :class="(edgeData.dotColor || '') === c.value ? 'ring-2 ring-primary ring-offset-1 ring-offset-background' : 'hover:scale-110'"
                    :style="{ backgroundColor: c.value || 'var(--primary)', borderColor: c.value ? c.value + '60' : 'var(--border)' }"
                    :title="c.label"
                    @click="updateEdgeField('dotColor', c.value)"
                  />
                </div>
              </div>
            </template>
          </template>

          <!-- Flow Order -->
          <div class="space-y-1">
            <Label class="text-[11px]">Flow Order</Label>
            <div class="flex items-center gap-2 rounded-md border border-border p-2">
              <div
                class="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold"
                :style="{
                  backgroundColor: (edgeData.color || 'var(--primary)') + '20',
                  color: edgeData.color || 'var(--primary)',
                  border: `1.5px solid ${edgeData.color || 'var(--primary)'}`,
                }"
              >
                {{ (diagrams.edgeFlowLevels.get(diagrams.selectedEdgeId!) || 0) + 1 }}
              </div>
              <span class="text-[10px] text-muted-foreground">
                Step {{ (diagrams.edgeFlowLevels.get(diagrams.selectedEdgeId!) || 0) + 1 }} —
                {{ (diagrams.edgeFlowLevels.get(diagrams.selectedEdgeId!) || 0) === 0 ? 'Source edge' : 'Cascades from upstream' }}
              </span>
            </div>
          </div>

          <!-- Notes -->
          <div class="space-y-1">
            <Label class="text-[11px]">Notes</Label>
            <textarea
              :value="edgeData.notes || ''"
              class="w-full rounded-md border border-border bg-transparent px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              rows="3"
              placeholder="Connection notes..."
              @input="updateEdgeField('notes', ($event.target as HTMLTextAreaElement).value)"
            />
          </div>
        </div>
      </div>

      <!-- Nothing selected -->
      <div v-else class="flex items-center justify-center py-12 text-xs text-muted-foreground">
        Select a node or edge to view properties
      </div>
    </ScrollArea>
  </div>
</template>
