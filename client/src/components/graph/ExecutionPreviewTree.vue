<script setup lang="ts">
import type { ExecutionPreview } from '@/types/graph-runner';
import { Badge } from '@/components/ui/badge';
import {
  Bot, GitBranch, Sparkles, Zap, Server, ShieldCheck,
  AlertTriangle, Leaf, Network,
} from 'lucide-vue-next';

defineProps<{
  preview: ExecutionPreview;
}>();

const nodeIcons: Record<string, typeof Bot> = {
  agent: Bot,
  subagent: GitBranch,
  expert: Sparkles,
};

const nodeColors: Record<string, string> = {
  agent: 'text-primary',
  subagent: 'text-chart-2',
  expert: 'text-chart-3',
};
</script>

<template>
  <div class="space-y-1">
    <!-- Summary bar -->
    <div class="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <span class="flex items-center gap-1">
        <Network class="h-3.5 w-3.5" />
        {{ preview.estimatedNodes }} agent{{ preview.estimatedNodes !== 1 ? 's' : '' }}
      </span>
      <span class="text-border">|</span>
      <span>Budget: {{ preview.tokenBudget.toLocaleString() }} tokens</span>
    </div>

    <!-- Node tree -->
    <div
      v-for="node in preview.nodes"
      :key="node.nodeId"
      :style="{ marginLeft: `${node.depth * 20}px` }"
      class="rounded border border-border/60 bg-card/50 p-2 transition-colors hover:bg-card"
    >
      <!-- Node header -->
      <div class="flex items-center gap-2">
        <component
          :is="nodeIcons[node.type] || Bot"
          class="h-4 w-4 shrink-0"
          :class="nodeColors[node.type] || 'text-muted-foreground'"
        />
        <span class="text-sm font-medium">{{ node.label }}</span>
        <Badge variant="outline" class="text-[10px]">{{ node.model }}</Badge>
        <Badge
          v-if="node.isLeaf"
          variant="outline"
          class="gap-0.5 text-[10px] text-chart-2"
        >
          <Leaf class="h-2.5 w-2.5" />
          leaf
        </Badge>
        <Badge
          v-else
          variant="outline"
          class="gap-0.5 text-[10px] text-primary"
        >
          <Network class="h-2.5 w-2.5" />
          orchestrator
        </Badge>
        <AlertTriangle
          v-if="!node.hasSystemPrompt"
          class="h-3.5 w-3.5 text-yellow-500"
          title="Missing system prompt"
        />
      </div>

      <!-- Attachments -->
      <div
        v-if="node.skills.length || node.mcps.length || node.rules.length"
        class="mt-1.5 flex flex-wrap gap-1"
      >
        <Badge
          v-for="s in node.skills"
          :key="s.id"
          variant="outline"
          class="gap-0.5 text-[10px] text-chart-5"
        >
          <Zap class="h-2.5 w-2.5" />
          {{ s.label }}
        </Badge>
        <Badge
          v-for="m in node.mcps"
          :key="m.id"
          variant="outline"
          class="gap-0.5 text-[10px] text-chart-4"
        >
          <Server class="h-2.5 w-2.5" />
          {{ m.label }}
        </Badge>
        <Badge
          v-for="r in node.rules"
          :key="r.id"
          variant="outline"
          class="gap-0.5 text-[10px] text-destructive"
        >
          <ShieldCheck class="h-2.5 w-2.5" />
          {{ r.label }}
        </Badge>
      </div>

      <!-- Delegates -->
      <div
        v-if="node.delegates.length"
        class="mt-1 text-[10px] text-muted-foreground"
      >
        delegates to: {{ node.delegates.map(d => d.label).join(', ') }}
      </div>
    </div>
  </div>
</template>
