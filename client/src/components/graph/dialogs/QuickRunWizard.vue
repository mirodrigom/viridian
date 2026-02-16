<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { GRAPH_TEMPLATES, type GraphTemplate } from '@/data/graphTemplates';
import { GOAL_PRESETS } from '@/data/goalPresets';
import { useGraphRunnerStore } from '@/stores/graphRunner';
import { useGraphRunner } from '@/composables/useGraphRunner';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import ExecutionPreviewTree from '@/components/graph/ExecutionPreviewTree.vue';
import {
  Bot, GitBranch, Sparkles, Zap, Server, ShieldCheck,
  Play, ArrowLeft, Eye, Rocket, Loader2,
} from 'lucide-vue-next';

const open = defineModel<boolean>('open', { default: false });

const runner = useGraphRunnerStore();
const { quickRun, init } = useGraphRunner();

const step = ref<'template' | 'prompt' | 'preview'>('template');
const selectedTemplate = ref<GraphTemplate | null>(null);
const prompt = ref('');

// Reset when dialog closes
watch(open, (v) => {
  if (!v) {
    step.value = 'template';
    selectedTemplate.value = null;
    prompt.value = '';
    runner.clearPreview();
  } else {
    init();
  }
});

const categoryColors: Record<string, string> = {
  development: 'bg-chart-2/15 text-chart-2 border-chart-2/30',
  analysis: 'bg-chart-4/15 text-chart-4 border-chart-4/30',
  automation: 'bg-chart-5/15 text-chart-5 border-chart-5/30',
};

function nodeTypeCounts(template: GraphTemplate) {
  const counts: Record<string, number> = {};
  for (const n of template.nodes) {
    counts[n.type] = (counts[n.type] || 0) + 1;
  }
  return counts;
}

function selectTemplate(template: GraphTemplate) {
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

function onRun() {
  if (!selectedTemplate.value || !prompt.value.trim()) return;
  quickRun(
    { nodes: selectedTemplate.value.nodes, edges: selectedTemplate.value.edges },
    prompt.value.trim(),
  );
  runner.showRunnerPanel = true;
  open.value = false;
}

function onKeyDown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    if (step.value === 'prompt') goToPreview();
    else if (step.value === 'preview') onRun();
  }
}

const stepTitle = computed(() => {
  switch (step.value) {
    case 'template': return 'Choose a Template';
    case 'prompt': return 'Define Your Task';
    case 'preview': return 'Execution Preview';
  }
});

const stepDescription = computed(() => {
  switch (step.value) {
    case 'template': return 'Select a pre-built agent graph to run';
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
    <DialogContent class="sm:max-w-lg" @keydown="onKeyDown">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2">
          <Rocket class="h-4 w-4 text-primary" />
          {{ stepTitle }}
        </DialogTitle>
        <DialogDescription>{{ stepDescription }}</DialogDescription>
      </DialogHeader>

      <!-- Step 1: Template Picker -->
      <ScrollArea v-if="step === 'template'" class="max-h-[420px]">
        <div class="space-y-2 p-1">
          <div
            v-for="template in GRAPH_TEMPLATES"
            :key="template.id"
            class="group cursor-pointer rounded-lg border border-border/60 bg-card p-3 transition-all hover:border-primary/50 hover:shadow-md"
            @click="selectTemplate(template)"
          >
            <div class="flex items-center gap-2">
              <span class="text-sm font-semibold">{{ template.name }}</span>
              <Badge
                variant="outline"
                class="text-[10px] capitalize"
                :class="categoryColors[template.category]"
              >
                {{ template.category }}
              </Badge>
            </div>
            <p class="mt-1 text-xs leading-relaxed text-muted-foreground">
              {{ template.description }}
            </p>
            <div class="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground/80">
              <span v-for="(count, type) in nodeTypeCounts(template)" :key="type" class="flex items-center gap-1">
                <component :is="typeIcons[type as string] || Bot" class="h-3 w-3" />
                {{ count }} {{ type }}{{ (count as number) > 1 ? 's' : '' }}
              </span>
            </div>
          </div>
        </div>
      </ScrollArea>

      <!-- Step 2: Prompt Input -->
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

      <!-- Step 3: Execution Preview -->
      <div v-else-if="step === 'preview'" class="space-y-3 py-2">
        <!-- Loading -->
        <div v-if="runner.previewLoading" class="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 class="h-4 w-4 animate-spin" />
          Resolving execution plan...
        </div>

        <!-- Preview tree -->
        <ScrollArea v-else-if="runner.currentPreview" class="max-h-[380px]">
          <ExecutionPreviewTree :preview="runner.currentPreview" />
        </ScrollArea>

        <!-- Error fallback -->
        <div v-else class="py-8 text-center text-sm text-muted-foreground">
          Failed to generate preview. Try running directly.
        </div>
      </div>

      <DialogFooter class="gap-2">
        <Button
          v-if="step !== 'template'"
          variant="outline"
          @click="step = step === 'preview' ? 'prompt' : 'template'"
        >
          <ArrowLeft class="mr-1.5 h-3.5 w-3.5" />
          Back
        </Button>
        <Button v-if="step === 'template'" variant="outline" @click="open = false">
          Cancel
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
          @click="onRun"
        >
          <Play class="mr-1.5 h-3.5 w-3.5" />
          Run
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
