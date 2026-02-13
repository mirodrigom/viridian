<script setup lang="ts">
import { computed } from 'vue';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Coins, GitCommit, FileText, Clock, Brain, Wrench } from 'lucide-vue-next';
import { useAutopilotStore } from '@/stores/autopilot';

const store = useAutopilotStore();

const run = computed(() => store.currentRun);

const totalInputTokens = computed(() => {
  if (!run.value) return 0;
  return run.value.totalTokens.agentA.inputTokens + run.value.totalTokens.agentB.inputTokens;
});

const totalOutputTokens = computed(() => {
  if (!run.value) return 0;
  return run.value.totalTokens.agentA.outputTokens + run.value.totalTokens.agentB.outputTokens;
});

const estimatedCost = computed(() => {
  // Rough estimate: $3/M input, $15/M output for Sonnet
  const inputCost = totalInputTokens.value * 3 / 1_000_000;
  const outputCost = totalOutputTokens.value * 15 / 1_000_000;
  return (inputCost + outputCost).toFixed(3);
});

const totalFilesChanged = computed(() => {
  if (!run.value) return 0;
  const files = new Set<string>();
  for (const cycle of run.value.cycles) {
    if (cycle.commit) {
      cycle.commit.filesChanged.forEach(f => files.add(f));
    }
  }
  return files.size;
});

const duration = computed(() => {
  if (!run.value?.startedAt) return '--';
  const end = run.value.completedAt || Date.now();
  const ms = end - run.value.startedAt;
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
});

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}
</script>

<template>
  <div class="h-full overflow-y-auto p-3 space-y-3">
    <div v-if="!run" class="flex h-full items-center justify-center">
      <p class="text-sm text-muted-foreground">Start an Autopilot run to see metrics</p>
    </div>

    <template v-else>
      <!-- Stats grid -->
      <div class="grid grid-cols-2 gap-2">
        <Card class="border-border/50">
          <CardContent class="p-3">
            <div class="flex items-center gap-2">
              <Clock class="h-4 w-4 text-muted-foreground" />
              <div>
                <p class="text-lg font-semibold leading-none">{{ run.cycles.length }}</p>
                <p class="text-[11px] text-muted-foreground">Cycles</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card class="border-border/50">
          <CardContent class="p-3">
            <div class="flex items-center gap-2">
              <GitCommit class="h-4 w-4 text-green-400" />
              <div>
                <p class="text-lg font-semibold leading-none">{{ run.totalCommits }}</p>
                <p class="text-[11px] text-muted-foreground">Commits</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card class="border-border/50">
          <CardContent class="p-3">
            <div class="flex items-center gap-2">
              <FileText class="h-4 w-4 text-blue-400" />
              <div>
                <p class="text-lg font-semibold leading-none">{{ totalFilesChanged }}</p>
                <p class="text-[11px] text-muted-foreground">Files changed</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card class="border-border/50">
          <CardContent class="p-3">
            <div class="flex items-center gap-2">
              <Coins class="h-4 w-4 text-amber-400" />
              <div>
                <p class="text-lg font-semibold leading-none">${{ estimatedCost }}</p>
                <p class="text-[11px] text-muted-foreground">Est. cost</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <!-- Token breakdown -->
      <Card class="border-border/50">
        <CardHeader class="p-3 pb-1">
          <CardTitle class="text-xs font-medium text-muted-foreground">Token Usage</CardTitle>
        </CardHeader>
        <CardContent class="p-3 pt-1 space-y-2">
          <div class="flex items-center justify-between text-xs">
            <div class="flex items-center gap-1.5">
              <Brain class="h-3.5 w-3.5 text-blue-400" />
              <span>Agent A</span>
            </div>
            <span class="font-mono text-muted-foreground">
              {{ formatTokens(run.totalTokens.agentA.inputTokens) }} in /
              {{ formatTokens(run.totalTokens.agentA.outputTokens) }} out
            </span>
          </div>
          <div class="flex items-center justify-between text-xs">
            <div class="flex items-center gap-1.5">
              <Wrench class="h-3.5 w-3.5 text-emerald-400" />
              <span>Agent B</span>
            </div>
            <span class="font-mono text-muted-foreground">
              {{ formatTokens(run.totalTokens.agentB.inputTokens) }} in /
              {{ formatTokens(run.totalTokens.agentB.outputTokens) }} out
            </span>
          </div>
          <div class="border-t border-border pt-1 flex items-center justify-between text-xs font-medium">
            <span>Total</span>
            <span class="font-mono">
              {{ formatTokens(totalInputTokens) }} in /
              {{ formatTokens(totalOutputTokens) }} out
            </span>
          </div>
        </CardContent>
      </Card>

      <!-- Duration -->
      <Card class="border-border/50">
        <CardContent class="p-3">
          <div class="flex items-center justify-between text-xs">
            <span class="text-muted-foreground">Duration</span>
            <span class="font-mono font-medium">{{ duration }}</span>
          </div>
        </CardContent>
      </Card>

      <!-- Commits list -->
      <Card v-if="run.cycles.some(c => c.commit)" class="border-border/50">
        <CardHeader class="p-3 pb-1">
          <CardTitle class="text-xs font-medium text-muted-foreground">Commits</CardTitle>
        </CardHeader>
        <CardContent class="p-3 pt-1 space-y-1.5">
          <div
            v-for="cycle in run.cycles.filter(c => c.commit)"
            :key="cycle.cycleNumber"
            class="flex items-center gap-2 text-xs cursor-pointer hover:bg-muted/30 rounded px-1.5 py-1"
            @click="store.selectedCycleNumber = cycle.cycleNumber"
          >
            <span class="font-mono text-green-400 shrink-0">
              {{ cycle.commit!.hash.slice(0, 7) }}
            </span>
            <span class="truncate text-muted-foreground">
              {{ cycle.commit!.message }}
            </span>
            <span class="ml-auto shrink-0 text-[10px] text-muted-foreground">
              {{ cycle.commit!.filesChanged.length }}f
            </span>
          </div>
        </CardContent>
      </Card>
    </template>
  </div>
</template>
