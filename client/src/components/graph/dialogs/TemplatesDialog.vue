<script setup lang="ts">
import { useGraphStore } from '@/stores/graph';
import { GRAPH_TEMPLATES, type GraphTemplate } from '@/data/graphTemplates';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'vue-sonner';
import {
  Bot, GitBranch, Sparkles, Zap, Server, ShieldCheck, Download,
} from 'lucide-vue-next';

const open = defineModel<boolean>('open', { default: false });
const graph = useGraphStore();

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

function onLoad(template: GraphTemplate) {
  graph.loadTemplate(template);
  toast.success(`Loaded "${template.name}" template`);
  open.value = false;
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>Graph Templates</DialogTitle>
        <DialogDescription>Import a pre-built agent graph as a starting point</DialogDescription>
      </DialogHeader>

      <ScrollArea class="max-h-[420px]">
        <div class="space-y-3 p-1">
          <div
            v-for="template in GRAPH_TEMPLATES"
            :key="template.id"
            class="group rounded-lg border border-border/60 bg-card p-4 transition-all hover:border-border hover:shadow-md"
          >
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0 flex-1">
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

                <!-- Node counts -->
                <div class="mt-2.5 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground/80">
                  <span v-if="nodeTypeCounts(template).agent" class="flex items-center gap-1">
                    <Bot class="h-3 w-3 text-primary" /> {{ nodeTypeCounts(template).agent }} agent
                  </span>
                  <span v-if="nodeTypeCounts(template).subagent" class="flex items-center gap-1">
                    <GitBranch class="h-3 w-3 text-chart-2" /> {{ nodeTypeCounts(template).subagent }} subagents
                  </span>
                  <span v-if="nodeTypeCounts(template).expert" class="flex items-center gap-1">
                    <Sparkles class="h-3 w-3 text-chart-3" /> {{ nodeTypeCounts(template).expert }} experts
                  </span>
                  <span v-if="nodeTypeCounts(template).skill" class="flex items-center gap-1">
                    <Zap class="h-3 w-3 text-chart-5" /> {{ nodeTypeCounts(template).skill }} skills
                  </span>
                  <span v-if="nodeTypeCounts(template).mcp" class="flex items-center gap-1">
                    <Server class="h-3 w-3 text-chart-4" /> {{ nodeTypeCounts(template).mcp }} MCP
                  </span>
                  <span v-if="nodeTypeCounts(template).rule" class="flex items-center gap-1">
                    <ShieldCheck class="h-3 w-3 text-destructive" /> {{ nodeTypeCounts(template).rule }} rules
                  </span>
                </div>
              </div>

              <Button
                variant="outline"
                size="sm"
                class="mt-0.5 shrink-0 gap-1.5"
                @click="onLoad(template)"
              >
                <Download class="h-3.5 w-3.5" />
                Import
              </Button>
            </div>
          </div>
        </div>
      </ScrollArea>
    </DialogContent>
  </Dialog>
</template>
