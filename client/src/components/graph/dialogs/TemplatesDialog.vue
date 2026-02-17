<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useGraphStore } from '@/stores/graph';
import { useGraphRunnerStore } from '@/stores/graphRunner';
import { useGraphRunner } from '@/composables/useGraphRunner';
import { GRAPH_TEMPLATES, TEMPLATE_CATEGORIES, type GraphTemplate, type TemplateCategory } from '@/data/graphTemplates';
import { GOAL_PRESETS } from '@/data/goalPresets';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import ExecutionPreviewTree from '@/components/graph/ExecutionPreviewTree.vue';
import { toast } from 'vue-sonner';
import {
  Bot, GitBranch, Sparkles, Zap, Server, ShieldCheck,
  Download, Play, ArrowLeft, Eye, Loader2, LayoutTemplate,
  // Category icons
  Code, Search, Cog, Gamepad2, Box, Palette, Scale, Calculator, Globe, Cloud, CloudCog,
} from 'lucide-vue-next';

const open = defineModel<boolean>('open', { default: false });
const graph = useGraphStore();
const runner = useGraphRunnerStore();
const { quickRun, init } = useGraphRunner();

const step = ref<'worlds' | 'templates' | 'prompt' | 'preview'>('worlds');
const selectedCategory = ref<TemplateCategory | null>(null);
const selectedTemplate = ref<GraphTemplate | null>(null);
const prompt = ref('');

// Reset when dialog closes
watch(open, (v) => {
  if (!v) {
    step.value = 'worlds';
    selectedCategory.value = null;
    selectedTemplate.value = null;
    prompt.value = '';
    runner.clearPreview();
  } else {
    init();
  }
});

const categoryIcons: Record<string, typeof Bot> = {
  Code, Search, Cog, Gamepad2, Box, Palette, Scale, Calculator, Globe, Cloud, CloudCog,
};

const categoriesWithCounts = computed(() =>
  TEMPLATE_CATEGORIES.map(cat => ({
    ...cat,
    templateCount: GRAPH_TEMPLATES.filter(t => t.category === cat.id).length,
  })).filter(cat => cat.templateCount > 0),
);

const filteredTemplates = computed(() => {
  if (!selectedCategory.value) return GRAPH_TEMPLATES;
  return GRAPH_TEMPLATES.filter(t => t.category === selectedCategory.value);
});

function nodeTypeCounts(template: GraphTemplate) {
  const counts: Record<string, number> = {};
  for (const n of template.nodes) {
    counts[n.type] = (counts[n.type] || 0) + 1;
  }
  return counts;
}

function selectWorld(category: TemplateCategory) {
  selectedCategory.value = category;
  step.value = 'templates';
}

function onImport(template: GraphTemplate) {
  graph.loadTemplate(template);
  toast.success(`Loaded "${template.name}" template`);
  open.value = false;
}

function onRun(template: GraphTemplate) {
  selectedTemplate.value = template;
  step.value = 'prompt';
}

function goToPreview() {
  if (!selectedTemplate.value || !prompt.value.trim()) return;
  step.value = 'preview';
  runner.requestPreview({
    nodes: selectedTemplate.value.nodes,
    edges: selectedTemplate.value.edges,
  });
}

function onExecute() {
  if (!selectedTemplate.value || !prompt.value.trim()) return;
  quickRun(selectedTemplate.value, prompt.value.trim());
  runner.showRunnerPanel = true;
  open.value = false;
}

function onBack() {
  if (step.value === 'preview') step.value = 'prompt';
  else if (step.value === 'prompt') step.value = 'templates';
  else if (step.value === 'templates') {
    step.value = 'worlds';
    selectedCategory.value = null;
  }
}

function onKeyDown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    if (step.value === 'prompt') goToPreview();
    else if (step.value === 'preview') onExecute();
  }
}

const selectedCategoryMeta = computed(() =>
  TEMPLATE_CATEGORIES.find(c => c.id === selectedCategory.value),
);

const stepTitle = computed(() => {
  switch (step.value) {
    case 'worlds': return 'Template Worlds';
    case 'templates': return selectedCategoryMeta.value?.name || 'Templates';
    case 'prompt': return 'Define Your Task';
    case 'preview': return 'Execution Preview';
  }
});

const stepDescription = computed(() => {
  switch (step.value) {
    case 'worlds': return 'Choose a domain to explore templates';
    case 'templates': return selectedCategoryMeta.value?.description || 'Import a template or run it directly';
    case 'prompt': return `Using "${selectedTemplate.value?.name}" template`;
    case 'preview': return 'Review which agents, skills, and rules will execute';
  }
});

const typeIcons: Record<string, typeof Bot> = {
  agent: Bot,
  subagent: GitBranch,
  expert: Sparkles,
  skill: Zap,
  mcp: Server,
  rule: ShieldCheck,
};
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="flex max-h-[85vh] flex-col overflow-hidden sm:max-w-lg" :class="{ 'sm:max-w-2xl': step === 'preview' }" @keydown="onKeyDown">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2">
          <LayoutTemplate class="h-4 w-4 text-primary" />
          {{ stepTitle }}
        </DialogTitle>
        <DialogDescription>{{ stepDescription }}</DialogDescription>
      </DialogHeader>

      <!-- Step 1: World Selection -->
      <ScrollArea v-if="step === 'worlds'" class="min-h-0 flex-1">
        <div class="grid grid-cols-2 gap-2 p-1">
          <button
            v-for="cat in categoriesWithCounts"
            :key="cat.id"
            class="group flex flex-col items-start gap-2 rounded-lg border border-border/60 bg-card p-3 text-left transition-all hover:border-border hover:shadow-md"
            @click="selectWorld(cat.id)"
          >
            <div class="flex w-full items-center gap-2">
              <div
                class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border"
                :class="cat.color"
              >
                <component :is="categoryIcons[cat.icon]" class="h-4 w-4" />
              </div>
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-1.5">
                  <span class="text-sm font-semibold">{{ cat.name }}</span>
                  <Badge variant="outline" class="text-[10px]">
                    {{ cat.templateCount }}
                  </Badge>
                </div>
              </div>
            </div>
            <p class="text-[10px] leading-relaxed text-muted-foreground">
              {{ cat.description }}
            </p>
          </button>
        </div>
      </ScrollArea>

      <!-- Step 2: Templates in category -->
      <ScrollArea v-else-if="step === 'templates'" class="min-h-0 flex-1">
        <div class="space-y-3 p-1">
          <div
            v-for="template in filteredTemplates"
            :key="template.id"
            class="group rounded-lg border border-border/60 bg-card p-4 transition-all hover:border-border hover:shadow-md"
          >
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0 flex-1">
                <span class="text-sm font-semibold">{{ template.name }}</span>
                <p class="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {{ template.description }}
                </p>

                <!-- Node counts -->
                <div class="mt-2.5 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground/80">
                  <span v-for="(count, type) in nodeTypeCounts(template)" :key="type" class="flex items-center gap-1">
                    <component :is="typeIcons[type as string] || Bot" class="h-3 w-3" />
                    {{ count }} {{ type }}{{ (count as number) > 1 ? 's' : '' }}
                  </span>
                </div>
              </div>

              <div class="mt-0.5 flex shrink-0 flex-col gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  class="gap-1.5"
                  @click="onImport(template)"
                >
                  <Download class="h-3.5 w-3.5" />
                  Import
                </Button>
                <Button
                  size="sm"
                  class="gap-1.5"
                  @click="onRun(template)"
                >
                  <Play class="h-3.5 w-3.5" />
                  Run
                </Button>
              </div>
            </div>
          </div>
        </div>
      </ScrollArea>

      <!-- Step 3: Prompt Input -->
      <div v-else-if="step === 'prompt'" class="space-y-4 py-2">
        <!-- Template summary -->
        <div class="flex flex-wrap gap-1.5">
          <Badge
            v-for="(count, type) in nodeTypeCounts(selectedTemplate!)"
            :key="type"
            variant="outline"
            class="gap-1 text-xs"
          >
            <component :is="typeIcons[type as string] || Bot" class="h-3 w-3" />
            {{ count }} {{ type }}{{ (count as number) > 1 ? 's' : '' }}
          </Badge>
        </div>

        <!-- Goal presets -->
        <div class="space-y-1.5">
          <Label class="text-sm">Task Prompt</Label>
          <div class="flex flex-wrap gap-1">
            <Badge
              v-for="preset in GOAL_PRESETS"
              :key="preset.id"
              variant="outline"
              class="cursor-pointer text-[10px] transition-colors hover:bg-accent hover:text-accent-foreground"
              @click="prompt = preset.prompt"
            >
              {{ preset.label }}
            </Badge>
          </div>
          <Textarea
            v-model="prompt"
            placeholder="Describe the task you want the agent graph to perform..."
            class="min-h-[120px] resize-none"
          />
          <p class="text-[10px] text-muted-foreground">Ctrl+Enter to preview</p>
        </div>
      </div>

      <!-- Step 4: Execution Preview -->
      <div v-else-if="step === 'preview'" class="min-h-0 flex-1 overflow-y-auto py-2">
        <div v-if="runner.previewLoading" class="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 class="h-4 w-4 animate-spin" />
          Resolving execution plan...
        </div>

        <ExecutionPreviewTree v-else-if="runner.currentPreview" :preview="runner.currentPreview" />

        <div v-else class="py-8 text-center text-sm text-muted-foreground">
          Failed to generate preview. Try running directly.
        </div>
      </div>

      <DialogFooter v-if="step !== 'worlds'" class="gap-2">
        <Button variant="outline" @click="onBack">
          <ArrowLeft class="mr-1.5 h-3.5 w-3.5" />
          Back
        </Button>

        <div class="flex-1" />

        <Button
          v-if="step === 'prompt'"
          :disabled="!prompt.trim()"
          @click="goToPreview"
        >
          <Eye class="mr-1.5 h-3.5 w-3.5" />
          Preview Plan
        </Button>

        <Button
          v-if="step === 'preview'"
          :disabled="runner.previewLoading"
          @click="onExecute"
        >
          <Play class="mr-1.5 h-3.5 w-3.5" />
          Run
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
