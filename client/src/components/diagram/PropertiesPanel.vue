<script setup lang="ts">
import { computed, ref } from 'vue';
import { useDebounceFn } from '@vueuse/core';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Plus, Minus, X, ChevronRight, Paintbrush, ArrowRightLeft, Sparkles, ListOrdered } from 'lucide-vue-next';
import { useDiagramsStore, type AWSServiceNodeData, type AWSGroupNodeData, type DiagramEdgeData, type DotDirection } from '@/stores/diagrams';

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

/** Debounced version for text input handlers (typing). */
const updateNodeFieldDebounced = useDebounceFn((field: string, value: string) => {
  updateNodeField(field, value);
}, 300);

function updateEdgeField(field: string, value: string | boolean | number | undefined) {
  if (!diagrams.selectedEdgeId) return;
  diagrams.updateEdgeData(diagrams.selectedEdgeId, { [field]: value } as never);
}

/** Debounced version for text input handlers (typing). */
const updateEdgeFieldDebounced = useDebounceFn((field: string, value: string) => {
  updateEdgeField(field, value);
}, 300);

const currentFlowOrder = computed(() => {
  if (!diagrams.selectedEdgeId) return 0;
  const manual = edgeData.value?.flowOrder;
  if (manual != null) return manual;
  return diagrams.edgeFlowLevels.get(diagrams.selectedEdgeId) || 0;
});

const currentZIndex = computed(() => {
  if (!diagrams.selectedNodeId) return 0;
  return diagrams.getNodeZIndex(diagrams.selectedNodeId);
});

// Collapsible section states
const styleOpen = ref(true);
const markersOpen = ref(true);
const animationOpen = ref(false);
const flowOrderOpen = ref(false);

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

const lineStyleOptions = [
  { value: 'solid', label: 'Solid' },
  { value: 'dashed', label: 'Dashed' },
  { value: 'dotted', label: 'Dotted' },
] as const;

const labelSizeOptions = [
  { value: 'small', label: 'Small' },
  { value: 'medium', label: 'Medium' },
  { value: 'large', label: 'Large' },
] as const;

const dotDirectionOptions: { value: DotDirection; label: string }[] = [
  { value: 'forward', label: 'Forward' },
  { value: 'reverse', label: 'Reverse' },
  { value: 'none', label: 'None' },
];

const dotSpeedOptions = [
  { value: 'slow', label: 'Slow' },
  { value: 'medium', label: 'Medium' },
  { value: 'fast', label: 'Fast' },
] as const;

const flowOrderPositionOptions = [
  { value: 'source', label: 'From (Source)' },
  { value: 'target', label: 'To (Target)' },
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
</script>

<template>
  <div data-testid="properties-panel" class="flex h-full min-h-0 flex-col overflow-hidden border-l border-border bg-background">
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

    <ScrollArea class="flex-1 overflow-hidden">
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
                @update:model-value="(v: string | number) => updateNodeFieldDebounced('customLabel', String(v))"
              />
            </div>

            <!-- Icon URL (editable for custom services) -->
            <div v-if="(nodeData as AWSServiceNodeData).serviceId?.startsWith('custom-')" class="space-y-1">
              <Label class="text-[11px]">Icon URL</Label>
              <Input
                :model-value="(nodeData as AWSServiceNodeData).service.iconUrl"
                class="h-7 text-xs"
                placeholder="https://example.com/logo.svg"
                @update:model-value="(v: string | number) => {
                  const svc = { ...(nodeData as AWSServiceNodeData).service, iconUrl: String(v) };
                  diagrams.updateNodeData(diagrams.selectedNodeId!, { service: svc } as any);
                }"
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
                @input="updateNodeFieldDebounced('description', ($event.target as HTMLTextAreaElement).value)"
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
                @input="updateNodeFieldDebounced('notes', ($event.target as HTMLTextAreaElement).value)"
              />
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
                @update:model-value="(v: string | number) => updateNodeFieldDebounced('customLabel', String(v))"
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
                @input="updateNodeFieldDebounced('notes', ($event.target as HTMLTextAreaElement).value)"
              />
            </div>

          </div>
        </template>
      </div>

      <!-- Edge properties -->
      <div v-else-if="edgeData" class="space-y-3 p-3">
        <TooltipProvider :delay-duration="200">
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

        <!-- Label -->
        <div class="space-y-1">
          <Label class="text-[11px]">Label</Label>
          <Input
            :model-value="edgeData.label || ''"
            class="h-7 text-xs"
            placeholder="Connection label..."
            @update:model-value="(v: string | number) => updateEdgeFieldDebounced('label', String(v))"
          />
        </div>

        <Separator />

        <!-- ── Style ── -->
        <Collapsible v-model:open="styleOpen">
          <TooltipProvider :delay-duration="300">
            <Tooltip>
              <TooltipTrigger as-child>
                <CollapsibleTrigger class="flex w-full items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground">
                  <ChevronRight class="h-3 w-3 shrink-0 transition-transform duration-200" :class="{ 'rotate-90': styleOpen }" />
                  <Paintbrush class="h-3.5 w-3.5" />
                  <span class="text-[11px] font-medium">Style</span>
                </CollapsibleTrigger>
              </TooltipTrigger>
              <TooltipContent side="left"><p>Edge type, line style, color</p></TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <CollapsibleContent>
            <div class="mt-2 space-y-2.5">
              <!-- Edge Type — curve shape icons -->
              <div class="flex gap-1">
                <Tooltip v-for="opt in edgeTypeOptions" :key="opt.value">
                  <TooltipTrigger as-child>
                    <button
                      class="flex h-7 flex-1 items-center justify-center rounded-md border transition-colors"
                      :class="(edgeData.edgeType || 'default') === opt.value ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-muted/50'"
                      @click="updateEdgeField('edgeType', opt.value)"
                    >
                      <svg viewBox="0 0 24 14" class="h-3.5 w-5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
                        <path v-if="opt.value === 'default'" d="M2 12 C6 2, 18 2, 22 12" />
                        <path v-else-if="opt.value === 'straight'" d="M2 12 L22 2" />
                        <path v-else-if="opt.value === 'step'" d="M2 10 H12 V4 H22" />
                        <path v-else d="M2 10 C7 10 7 4 12 4 C17 4 17 4 22 4" />
                      </svg>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top"><p>{{ opt.label }}</p></TooltipContent>
                </Tooltip>
              </div>
              <!-- Line Style — stroke pattern icons -->
              <div class="flex gap-1">
                <Tooltip v-for="opt in lineStyleOptions" :key="opt.value">
                  <TooltipTrigger as-child>
                    <button
                      class="flex h-7 flex-1 items-center justify-center rounded-md border transition-colors"
                      :class="(edgeData.style || 'solid') === opt.value ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-muted/50'"
                      @click="updateEdgeField('style', opt.value)"
                    >
                      <svg viewBox="0 0 24 4" class="h-1 w-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                        <line x1="1" y1="2" x2="23" y2="2" :stroke-dasharray="opt.value === 'dashed' ? '4 3' : opt.value === 'dotted' ? '1 3' : undefined" />
                      </svg>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top"><p>{{ opt.label }}</p></TooltipContent>
                </Tooltip>
              </div>
              <!-- Label Size — A in different sizes -->
              <div class="flex gap-1">
                <Tooltip v-for="opt in labelSizeOptions" :key="opt.value">
                  <TooltipTrigger as-child>
                    <button
                      class="flex h-7 flex-1 items-center justify-center rounded-md border font-semibold transition-colors"
                      :class="(edgeData.labelSize || 'small') === opt.value ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-muted/50'"
                      @click="updateEdgeField('labelSize', opt.value)"
                    >
                      <span :class="opt.value === 'small' ? 'text-[9px]' : opt.value === 'medium' ? 'text-[11px]' : 'text-[13px]'">A</span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top"><p>{{ opt.label }}</p></TooltipContent>
                </Tooltip>
              </div>
              <!-- Color swatches -->
              <div class="flex flex-wrap gap-1">
                <Tooltip v-for="c in edgeColors" :key="c.value">
                  <TooltipTrigger as-child>
                    <button
                      class="h-6 w-6 rounded-md border transition-all"
                      :class="(edgeData.color || '') === c.value ? 'ring-2 ring-primary ring-offset-1 ring-offset-background' : 'hover:scale-110'"
                      :style="{ backgroundColor: c.value || 'var(--primary)', borderColor: c.value ? c.value + '60' : 'var(--border)' }"
                      @click="updateEdgeField('color', c.value)"
                    />
                  </TooltipTrigger>
                  <TooltipContent side="top"><p>{{ c.label }}</p></TooltipContent>
                </Tooltip>
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>

        <Separator />

        <!-- ── Markers ── -->
        <Collapsible v-model:open="markersOpen">
          <TooltipProvider :delay-duration="300">
            <Tooltip>
              <TooltipTrigger as-child>
                <CollapsibleTrigger class="flex w-full items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground">
                  <ChevronRight class="h-3 w-3 shrink-0 transition-transform duration-200" :class="{ 'rotate-90': markersOpen }" />
                  <ArrowRightLeft class="h-3.5 w-3.5" />
                  <span class="text-[11px] font-medium">Markers</span>
                </CollapsibleTrigger>
              </TooltipTrigger>
              <TooltipContent side="left"><p>Start & end arrow markers</p></TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <CollapsibleContent>
            <div class="mt-2 space-y-2">
              <!-- Start Marker -->
              <div class="space-y-1">
                <Label class="text-[10px] text-muted-foreground">Start</Label>
                <div class="flex gap-1">
                  <Tooltip v-for="opt in markerOptions" :key="'ms-' + opt.value">
                    <TooltipTrigger as-child>
                      <button
                        class="flex h-7 flex-1 items-center justify-center rounded-md border transition-colors"
                        :class="(edgeData.markerStart || 'none') === opt.value ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-muted/50'"
                        :data-testid="'start-marker-' + opt.value"
                        @click="updateEdgeField('markerStart', opt.value)"
                      >
                        <svg viewBox="0 0 24 12" class="h-3 w-5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                          <line x1="8" y1="6" x2="22" y2="6" />
                          <template v-if="opt.value === 'arrowclosed'">
                            <polygon points="2,6 8,2 8,10" fill="currentColor" stroke="none" />
                          </template>
                          <template v-else-if="opt.value === 'arrow'">
                            <polyline points="8,2 2,6 8,10" />
                          </template>
                          <template v-else>
                            <circle cx="4" cy="6" r="2" stroke="currentColor" fill="none" />
                          </template>
                        </svg>
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top"><p>{{ opt.label }}</p></TooltipContent>
                  </Tooltip>
                </div>
              </div>
              <!-- End Marker -->
              <div class="space-y-1">
                <Label class="text-[10px] text-muted-foreground">End</Label>
                <div class="flex gap-1">
                  <Tooltip v-for="opt in markerOptions" :key="'me-' + opt.value">
                    <TooltipTrigger as-child>
                      <button
                        class="flex h-7 flex-1 items-center justify-center rounded-md border transition-colors"
                        :class="(edgeData.markerEnd || 'arrowclosed') === opt.value ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-muted/50'"
                        :data-testid="'end-marker-' + opt.value"
                        @click="updateEdgeField('markerEnd', opt.value)"
                      >
                        <svg viewBox="0 0 24 12" class="h-3 w-5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                          <line x1="2" y1="6" x2="16" y2="6" />
                          <template v-if="opt.value === 'arrowclosed'">
                            <polygon points="22,6 16,2 16,10" fill="currentColor" stroke="none" />
                          </template>
                          <template v-else-if="opt.value === 'arrow'">
                            <polyline points="16,2 22,6 16,10" />
                          </template>
                          <template v-else>
                            <circle cx="20" cy="6" r="2" stroke="currentColor" fill="none" />
                          </template>
                        </svg>
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top"><p>{{ opt.label }}</p></TooltipContent>
                  </Tooltip>
                </div>
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>

        <Separator />

        <!-- ── Animation ── -->
        <Collapsible v-model:open="animationOpen">
          <TooltipProvider :delay-duration="300">
            <Tooltip>
              <TooltipTrigger as-child>
                <CollapsibleTrigger class="flex w-full items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground">
                  <ChevronRight class="h-3 w-3 shrink-0 transition-transform duration-200" :class="{ 'rotate-90': animationOpen }" />
                  <Sparkles class="h-3.5 w-3.5" />
                  <span class="text-[11px] font-medium">Animation</span>
                </CollapsibleTrigger>
              </TooltipTrigger>
              <TooltipContent side="left"><p>Flow animation & dot settings</p></TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <CollapsibleContent>
            <div class="mt-2 space-y-2.5">
              <div class="flex items-center justify-between">
                <Label class="text-[11px]">Flow</Label>
                <Switch
                  :model-value="!!edgeData.animated"
                  @update:model-value="(v: boolean) => updateEdgeField('animated', v)"
                />
              </div>
              <template v-if="edgeData.animated">
                <div class="flex items-center justify-between">
                  <Label class="text-[11px]">Dots</Label>
                  <Switch
                    :model-value="!!edgeData.dotAnimation"
                    @update:model-value="(v: boolean) => updateEdgeField('dotAnimation', v)"
                  />
                </div>
                <template v-if="edgeData.dotAnimation">
                  <!-- Direction — arrow icons -->
                  <div class="flex gap-1">
                    <Tooltip v-for="opt in dotDirectionOptions" :key="opt.value">
                      <TooltipTrigger as-child>
                        <button
                          class="flex h-7 flex-1 items-center justify-center rounded-md border transition-colors"
                          :class="(edgeData.dotDirection || 'forward') === opt.value ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-muted/50'"
                          :data-testid="'dot-direction-' + opt.value"
                          @click="updateEdgeField('dotDirection', opt.value)"
                        >
                          <svg viewBox="0 0 16 12" class="h-3 w-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                            <template v-if="opt.value === 'forward'">
                              <line x1="2" y1="6" x2="12" y2="6" />
                              <polyline points="9,3 12,6 9,9" />
                            </template>
                            <template v-else-if="opt.value === 'reverse'">
                              <line x1="4" y1="6" x2="14" y2="6" />
                              <polyline points="7,3 4,6 7,9" />
                            </template>
                            <template v-else>
                              <line x1="3" y1="3" x2="13" y2="9" />
                              <line x1="13" y1="3" x2="3" y2="9" />
                            </template>
                          </svg>
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top"><p>{{ opt.label }}</p></TooltipContent>
                    </Tooltip>
                  </div>
                  <!-- Count — dot icons -->
                  <div class="flex gap-1">
                    <Tooltip v-for="n in [1, 2, 3]" :key="'dc-' + n">
                      <TooltipTrigger as-child>
                        <button
                          class="flex h-7 flex-1 items-center justify-center gap-0.5 rounded-md border transition-colors"
                          :class="(edgeData.dotCount || 1) === n ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-muted/50'"
                          @click="updateEdgeField('dotCount', n)"
                        >
                          <span v-for="d in n" :key="d" class="inline-block h-1.5 w-1.5 rounded-full bg-current" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top"><p>{{ n }} {{ n === 1 ? 'dot' : 'dots' }}</p></TooltipContent>
                    </Tooltip>
                  </div>
                  <!-- Speed — chevron icons -->
                  <div class="flex gap-1">
                    <Tooltip v-for="opt in dotSpeedOptions" :key="opt.value">
                      <TooltipTrigger as-child>
                        <button
                          class="flex h-7 flex-1 items-center justify-center rounded-md border transition-colors"
                          :class="(edgeData.dotSpeed || 'medium') === opt.value ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-muted/50'"
                          @click="updateEdgeField('dotSpeed', opt.value)"
                        >
                          <svg viewBox="0 0 16 12" class="h-3 w-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="6,2 10,6 6,10" />
                            <polyline v-if="opt.value === 'medium' || opt.value === 'fast'" points="10,2 14,6 10,10" />
                            <polyline v-if="opt.value === 'fast'" points="2,2 6,6 2,10" />
                          </svg>
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top"><p>{{ opt.label }}</p></TooltipContent>
                    </Tooltip>
                  </div>
                  <!-- Dot Color -->
                  <div class="flex flex-wrap gap-1">
                    <Tooltip v-for="c in edgeColors" :key="'dot-' + c.value">
                      <TooltipTrigger as-child>
                        <button
                          class="h-6 w-6 rounded-md border transition-all"
                          :class="(edgeData.dotColor || '') === c.value ? 'ring-2 ring-primary ring-offset-1 ring-offset-background' : 'hover:scale-110'"
                          :style="{ backgroundColor: c.value || 'var(--primary)', borderColor: c.value ? c.value + '60' : 'var(--border)' }"
                          @click="updateEdgeField('dotColor', c.value)"
                        />
                      </TooltipTrigger>
                      <TooltipContent side="top"><p>{{ c.label }}</p></TooltipContent>
                    </Tooltip>
                  </div>
                </template>
              </template>
            </div>
          </CollapsibleContent>
        </Collapsible>

        <Separator />

        <!-- ── Flow Order ── -->
        <Collapsible v-model:open="flowOrderOpen">
          <TooltipProvider :delay-duration="300">
            <Tooltip>
              <TooltipTrigger as-child>
                <CollapsibleTrigger class="flex w-full items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground">
                  <ChevronRight class="h-3 w-3 shrink-0 transition-transform duration-200" :class="{ 'rotate-90': flowOrderOpen }" />
                  <ListOrdered class="h-3.5 w-3.5" />
                  <span class="text-[11px] font-medium">Flow Order</span>
                </CollapsibleTrigger>
              </TooltipTrigger>
              <TooltipContent side="left"><p>Sequence badge & position</p></TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <CollapsibleContent>
            <div class="mt-2 space-y-2">
              <div class="flex items-center gap-2 rounded-md border border-border p-2">
                <div
                  class="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold"
                  :style="{
                    backgroundColor: (edgeData.color || 'var(--primary)') + '20',
                    color: edgeData.color || 'var(--primary)',
                    border: `1.5px solid ${edgeData.color || 'var(--primary)'}`,
                  }"
                >
                  {{ currentFlowOrder + 1 }}
                </div>
                <span class="flex-1 text-[10px] text-muted-foreground">
                  Step {{ currentFlowOrder + 1 }}
                </span>
                <div class="flex items-center gap-0.5">
                  <Button
                    variant="ghost"
                    size="sm"
                    class="h-5 w-5 p-0"
                    :disabled="currentFlowOrder <= 0"
                    data-testid="flow-order-decrease"
                    @click="updateEdgeField('flowOrder', currentFlowOrder - 1)"
                  >
                    <Minus class="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    class="h-5 w-5 p-0"
                    data-testid="flow-order-increase"
                    @click="updateEdgeField('flowOrder', currentFlowOrder + 1)"
                  >
                    <Plus class="h-3 w-3" />
                  </Button>
                </div>
              </div>
              <button
                v-if="edgeData.flowOrder != null"
                class="text-[10px] text-muted-foreground underline hover:text-foreground"
                data-testid="flow-order-reset"
                @click="updateEdgeField('flowOrder', undefined as any)"
              >
                Reset to auto
              </button>
              <!-- Badge Position — visual icons -->
              <div class="flex gap-1">
                <Tooltip v-for="pos in flowOrderPositionOptions" :key="pos.value">
                  <TooltipTrigger as-child>
                    <button
                      class="flex h-7 flex-1 items-center justify-center rounded-md border transition-colors"
                      :class="(edgeData.flowOrderPosition || 'source') === pos.value ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-muted/50'"
                      :data-testid="`flow-position-${pos.value}`"
                      @click="updateEdgeField('flowOrderPosition', pos.value)"
                    >
                      <svg viewBox="0 0 28 12" class="h-3 w-6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
                        <line x1="4" y1="6" x2="24" y2="6" />
                        <circle v-if="pos.value === 'source'" cx="6" cy="6" r="3.5" fill="currentColor" stroke="none" />
                        <circle v-else cx="22" cy="6" r="3.5" fill="currentColor" stroke="none" />
                      </svg>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top"><p>{{ pos.label }}</p></TooltipContent>
                </Tooltip>
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>

        <Separator />

        <!-- Notes -->
        <div class="space-y-1">
          <Label class="text-[11px]">Notes</Label>
          <textarea
            :value="edgeData.notes || ''"
            class="w-full rounded-md border border-border bg-transparent px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            rows="3"
            placeholder="Connection notes..."
            @input="updateEdgeFieldDebounced('notes', ($event.target as HTMLTextAreaElement).value)"
          />
        </div>
        </TooltipProvider>
      </div>

      <!-- Nothing selected -->
      <div v-else class="flex items-center justify-center py-12 text-xs text-muted-foreground">
        Select a node or edge to view properties
      </div>
    </ScrollArea>
  </div>
</template>
