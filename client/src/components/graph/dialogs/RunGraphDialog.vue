<script setup lang="ts">
import { ref, computed } from 'vue';
import { useGraphStore } from '@/stores/graph';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Play, Bot, GitBranch, Sparkles, Zap, Server, ShieldCheck } from 'lucide-vue-next';

const open = defineModel<boolean>('open', { default: false });
const emit = defineEmits<{
  run: [prompt: string];
}>();

const graph = useGraphStore();
const prompt = ref('');

// Detect root agent node (agent with no incoming delegation edges)
const rootNode = computed(() => {
  const delegationTargets = new Set<string>();
  for (const edge of graph.edges) {
    const edgeType = (edge.data as Record<string, unknown>)?.edgeType;
    if (edgeType === 'delegation') {
      delegationTargets.add(edge.target);
    }
  }

  const agents = graph.nodes.filter(n => {
    const nodeType = (n.data as Record<string, unknown>)?.nodeType;
    return (nodeType === 'agent' || nodeType === 'subagent' || nodeType === 'expert')
      && !delegationTargets.has(n.id);
  });

  return agents.find(n => (n.data as Record<string, unknown>)?.nodeType === 'agent') || agents[0] || null;
});

const graphStats = computed(() => {
  const counts: Record<string, number> = {};
  for (const node of graph.nodes) {
    const t = (node.data as Record<string, unknown>)?.nodeType as string || 'unknown';
    counts[t] = (counts[t] || 0) + 1;
  }
  return counts;
});

function onRun() {
  if (!prompt.value.trim()) return;
  emit('run', prompt.value.trim());
  open.value = false;
  prompt.value = '';
}

function onKeyDown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    onRun();
  }
}

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
    <DialogContent class="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2">
          <Play class="h-4 w-4 text-primary" />
          Run Graph
        </DialogTitle>
        <DialogDescription>Execute your multi-agent graph</DialogDescription>
      </DialogHeader>

      <div class="space-y-4 py-2">
        <!-- Root node info -->
        <div v-if="rootNode" class="flex items-center gap-2 rounded border border-border bg-muted/30 px-3 py-2 text-sm">
          <Bot class="h-4 w-4 text-primary" />
          <span class="text-muted-foreground">Root:</span>
          <span class="font-medium">{{ (rootNode.data as Record<string, unknown>).label || 'Agent' }}</span>
          <span class="text-xs text-muted-foreground">
            ({{ (rootNode.data as Record<string, unknown>).model as string || 'default model' }})
          </span>
        </div>

        <div v-else class="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
          No root agent node found. Add at least one Agent node.
        </div>

        <!-- Graph summary -->
        <div class="flex flex-wrap gap-1.5">
          <Badge
            v-for="(count, type) in graphStats"
            :key="type"
            variant="outline"
            class="gap-1 text-xs"
          >
            <component :is="typeIcons[type] || Bot" class="h-3 w-3" />
            {{ count }} {{ type }}{{ count > 1 ? 's' : '' }}
          </Badge>
        </div>

        <!-- Prompt -->
        <div class="space-y-1.5">
          <Label class="text-sm">Task Prompt</Label>
          <Textarea
            v-model="prompt"
            placeholder="Describe the task you want the agent graph to perform..."
            class="min-h-[100px] resize-none"
            @keydown="onKeyDown"
          />
          <p class="text-[10px] text-muted-foreground">Ctrl+Enter to run</p>
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" @click="open = false">Cancel</Button>
        <Button :disabled="!prompt.trim() || !rootNode" @click="onRun">
          <Play class="mr-1.5 h-3.5 w-3.5" />
          Run
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
