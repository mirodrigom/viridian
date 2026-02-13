<script setup lang="ts">
import { ref, computed, inject } from 'vue';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Play, Pause, Square, Settings, GitBranch, Loader2, AlertCircle, CheckCircle2, RotateCcw } from 'lucide-vue-next';
import { useAutopilotStore } from '@/stores/autopilot';

const store = useAutopilotStore();
const showConfig = inject<import('vue').Ref<boolean>>('showAutopilotConfig', ref(false));

const statusColor = computed(() => {
  switch (store.currentRun?.status) {
    case 'running': return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
    case 'paused': return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
    case 'rate_limited': return 'bg-orange-500/20 text-orange-400 border-orange-500/30';
    case 'completed': return 'bg-green-500/20 text-green-400 border-green-500/30';
    case 'failed': return 'bg-red-500/20 text-red-400 border-red-500/30';
    case 'aborted': return 'bg-muted text-muted-foreground border-border';
    default: return 'bg-muted text-muted-foreground border-border';
  }
});

const statusLabel = computed(() => {
  if (!store.currentRun) return 'Idle';
  switch (store.currentRun.status) {
    case 'running': return 'Running';
    case 'paused': return 'Paused';
    case 'rate_limited': return 'Rate Limited';
    case 'completed': return 'Completed';
    case 'failed': return 'Failed';
    case 'aborted': return 'Aborted';
    default: return 'Idle';
  }
});

const isResumable = computed(() =>
  store.currentRun && ['failed', 'aborted'].includes(store.currentRun.status),
);

function openConfig() {
  showConfig.value = true;
}
</script>

<template>
  <div class="flex h-11 items-center gap-2 border-b border-border bg-muted/30 px-3">
    <!-- Action buttons -->
    <div class="flex items-center gap-1">
      <Button
        v-if="isResumable"
        variant="ghost"
        size="sm"
        class="h-7 gap-1 text-xs text-blue-400"
        @click="store.resumeFailedRun(store.currentRun!.runId)"
      >
        <RotateCcw class="h-3.5 w-3.5" />
        Resume
      </Button>

      <Button
        v-if="!store.isRunning && !store.isPaused && !isResumable"
        variant="ghost"
        size="sm"
        class="h-7 gap-1 text-xs"
        @click="openConfig"
      >
        <Play class="h-3.5 w-3.5" />
        Start
      </Button>

      <Button
        v-if="store.isRunning"
        variant="ghost"
        size="sm"
        class="h-7 gap-1 text-xs"
        @click="store.pause()"
      >
        <Pause class="h-3.5 w-3.5" />
        Pause
      </Button>

      <Button
        v-if="store.isPaused"
        variant="ghost"
        size="sm"
        class="h-7 gap-1 text-xs"
        @click="store.resume()"
      >
        <Play class="h-3.5 w-3.5" />
        Resume
      </Button>

      <Button
        v-if="store.isRunning || store.isPaused"
        variant="ghost"
        size="sm"
        class="h-7 gap-1 text-xs text-destructive"
        @click="store.abort()"
      >
        <Square class="h-3.5 w-3.5" />
        Stop
      </Button>
    </div>

    <!-- Status badge -->
    <Badge
      variant="outline"
      :class="['gap-1 text-xs font-normal', statusColor]"
    >
      <Loader2 v-if="store.currentRun?.status === 'running'" class="h-3 w-3 animate-spin" />
      <AlertCircle v-else-if="store.currentRun?.status === 'rate_limited'" class="h-3 w-3" />
      <CheckCircle2 v-else-if="store.currentRun?.status === 'completed'" class="h-3 w-3" />
      {{ statusLabel }}
    </Badge>

    <!-- Branch name -->
    <div
      v-if="store.currentRun?.branchName"
      class="flex items-center gap-1 text-xs text-muted-foreground"
    >
      <GitBranch class="h-3 w-3" />
      {{ store.currentRun.branchName }}
    </div>

    <!-- Cycle counter -->
    <div v-if="store.currentRun" class="text-xs text-muted-foreground">
      Cycle {{ (store.currentRun.currentCycleNumber || 0) + 1 }}
      <span v-if="store.currentRun.totalCommits > 0">
        | {{ store.currentRun.totalCommits }} commits
      </span>
    </div>

    <div class="flex-1" />

    <!-- Settings -->
    <Button variant="ghost" size="icon" class="h-7 w-7" @click="openConfig">
      <Settings class="h-3.5 w-3.5" />
    </Button>
  </div>
</template>
