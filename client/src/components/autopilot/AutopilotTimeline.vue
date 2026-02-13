<script setup lang="ts">
import { computed, ref, nextTick, watch } from 'vue';
import { Badge } from '@/components/ui/badge';
import {
  Play, CheckCircle2, XCircle, AlertTriangle, Pause,
  GitCommit, Brain, Wrench, Clock, GitPullRequest,
} from 'lucide-vue-next';
import { useAutopilotStore } from '@/stores/autopilot';

const store = useAutopilotStore();
const timelineRef = ref<HTMLElement | null>(null);

// Auto-scroll
watch(
  () => store.timeline.length,
  () => nextTick(() => {
    if (timelineRef.value) timelineRef.value.scrollTop = timelineRef.value.scrollHeight;
  }),
);

function iconFor(type: string) {
  switch (type) {
    case 'run_started': return Play;
    case 'cycle_started': return Clock;
    case 'agent_a_complete': return Brain;
    case 'agent_b_complete': return Wrench;
    case 'commit_made': return GitCommit;
    case 'cycle_completed': return CheckCircle2;
    case 'rate_limited': return AlertTriangle;
    case 'rate_limit_cleared': return Play;
    case 'run_paused': return Pause;
    case 'run_resumed': return Play;
    case 'run_completed': return CheckCircle2;
    case 'run_failed': return XCircle;
    case 'pr_created': return GitPullRequest;
    default: return Clock;
  }
}

function colorFor(type: string): string {
  switch (type) {
    case 'run_started':
    case 'run_resumed':
    case 'rate_limit_cleared':
      return 'text-blue-400';
    case 'cycle_started':
    case 'agent_a_complete':
      return 'text-blue-300';
    case 'agent_b_complete':
      return 'text-emerald-400';
    case 'commit_made':
      return 'text-green-400';
    case 'cycle_completed':
    case 'run_completed':
      return 'text-green-500';
    case 'rate_limited':
      return 'text-orange-400';
    case 'run_paused':
      return 'text-yellow-400';
    case 'run_failed':
      return 'text-red-400';
    case 'pr_created':
      return 'text-purple-400';
    default:
      return 'text-muted-foreground';
  }
}

function timeStr(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
</script>

<template>
  <div ref="timelineRef" class="h-full overflow-y-auto p-3">
    <div v-if="store.timeline.length === 0" class="flex h-full items-center justify-center">
      <p class="text-sm text-muted-foreground">No events yet</p>
    </div>

    <div v-else class="space-y-1">
      <div
        v-for="(entry, i) in store.timeline"
        :key="i"
        class="flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-muted/30 cursor-pointer transition-colors"
        :class="{ 'bg-muted/20': entry.cycleNumber !== null && entry.cycleNumber === store.selectedCycleNumber }"
        @click="entry.cycleNumber !== null && (store.selectedCycleNumber = entry.cycleNumber)"
      >
        <!-- Icon -->
        <component
          :is="iconFor(entry.type)"
          class="h-3.5 w-3.5 mt-0.5 shrink-0"
          :class="colorFor(entry.type)"
        />

        <!-- Content -->
        <div class="min-w-0 flex-1">
          <p class="text-xs leading-snug" :class="colorFor(entry.type)">
            {{ entry.detail }}
          </p>
          <div class="flex items-center gap-2 mt-0.5">
            <span class="text-[10px] text-muted-foreground">{{ timeStr(entry.timestamp) }}</span>
            <Badge
              v-if="entry.cycleNumber !== null"
              variant="outline"
              class="text-[9px] px-1 py-0 h-3.5"
            >
              C{{ entry.cycleNumber + 1 }}
            </Badge>
            <Badge
              v-if="entry.meta?.hash"
              variant="outline"
              class="text-[9px] px-1 py-0 h-3.5 font-mono text-green-400"
            >
              {{ (entry.meta.hash as string).slice(0, 7) }}
            </Badge>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
