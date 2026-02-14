<script setup lang="ts">
import { ref, computed, watch, inject } from 'vue';
import { useAutopilotStore } from '@/stores/autopilot';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Search, RefreshCw, ArrowUpDown, Plus, Clock,
  GitBranch, Loader2, CheckCircle2, AlertCircle, Pause, Square, RotateCcw,
} from 'lucide-vue-next';

const store = useAutopilotStore();
const showConfig = inject<import('vue').Ref<boolean>>('showAutopilotConfig', ref(false));

const searchQuery = ref('');
const visibleCount = ref(10);
const sortBy = ref<'date' | 'name'>('date');
const isRefreshing = ref(false);

// Fetch runs on mount
store.fetchRunHistory();

// Refresh after a run completes
watch(() => store.currentRun?.status, (status, prev) => {
  if (prev && !['completed', 'failed', 'aborted'].includes(prev) &&
    status && ['completed', 'failed', 'aborted'].includes(status)) {
    store.fetchRunHistory();
  }
});

// Filter out the currently active live run from the DB list to avoid duplication
const filteredRuns = computed(() => {
  let list = store.runs;

  // Exclude the active live run (it's shown separately at the top)
  if (store.currentRun && store.isRunning) {
    list = list.filter(r => r.id !== store.currentRun?.runId);
  }

  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase();
    list = list.filter(r =>
      (r.goalPrompt || '').toLowerCase().includes(q) ||
      (r.branchName || '').toLowerCase().includes(q),
    );
  }

  if (sortBy.value === 'name') {
    list = [...list].sort((a, b) =>
      (a.goalPrompt || '').localeCompare(b.goalPrompt || ''),
    );
  }
  // default: sorted by date DESC from API

  return list;
});

async function refresh() {
  isRefreshing.value = true;
  await store.fetchRunHistory();
  isRefreshing.value = false;
}

function loadMore() {
  visibleCount.value += 10;
}

function selectRun(runId: string) {
  if (store.isLoadingRun) return;
  if (store.currentRun?.runId === runId) return;
  store.loadRun(runId);
}

function startNew() {
  showConfig.value = true;
}

function resumeRun(runId: string, event: Event) {
  event.stopPropagation();
  if (store.isRunning) return;
  // Load the run first if not already loaded, then resume
  if (store.currentRun?.runId !== runId) {
    store.loadRun(runId).then(() => {
      store.resumeFailedRun(runId);
    });
  } else {
    store.resumeFailedRun(runId);
  }
}

function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const now = Date.now();
  const diff = now - date.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}

function statusColor(status: string) {
  switch (status) {
    case 'running': return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
    case 'paused': return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
    case 'rate_limited': return 'bg-orange-500/20 text-orange-400 border-orange-500/30';
    case 'completed': return 'bg-green-500/20 text-green-400 border-green-500/30';
    case 'schedule_timeout': return 'bg-red-500/20 text-red-400 border-red-500/30';
    case 'failed': return 'bg-red-500/20 text-red-400 border-red-500/30';
    case 'aborted': return 'bg-muted text-muted-foreground border-border';
    default: return 'bg-muted text-muted-foreground border-border';
  }
}

function statusIcon(status: string) {
  switch (status) {
    case 'running': return Loader2;
    case 'paused': return Pause;
    case 'completed': return CheckCircle2;
    case 'schedule_timeout': return Clock;
    case 'failed': return AlertCircle;
    case 'aborted': return Square;
    default: return Clock;
  }
}

function truncateGoal(goal: string, max = 60): string {
  if (!goal) return 'Untitled run';
  const firstLine = goal.split('\n')[0].trim();
  if (firstLine.length <= max) return firstLine;
  return firstLine.slice(0, max) + '...';
}

function totalTokens(run: { tokens: { agentA: { inputTokens: number; outputTokens: number }; agentB: { inputTokens: number; outputTokens: number } } }) {
  const t = run.tokens;
  const total = t.agentA.inputTokens + t.agentA.outputTokens + t.agentB.inputTokens + t.agentB.outputTokens;
  if (total >= 1_000_000) return `${(total / 1_000_000).toFixed(1)}M`;
  if (total >= 1_000) return `${(total / 1_000).toFixed(1)}K`;
  return String(total);
}
</script>

<template>
  <div class="flex h-full flex-col border-r border-border bg-card/50">
    <!-- Search + Sort + Refresh -->
    <div class="border-b border-border px-3 py-2">
      <div class="flex items-center gap-1.5">
        <div class="flex flex-1 items-center gap-1.5 rounded-md border border-input bg-background px-2 py-1">
          <Search class="h-3 w-3 shrink-0 text-muted-foreground" />
          <input
            v-model="searchQuery"
            class="h-5 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
            placeholder="Search runs..."
          />
          <Button
            variant="ghost"
            size="sm"
            class="h-5 shrink-0 px-1 text-[10px] text-muted-foreground hover:text-foreground"
            :title="sortBy === 'date' ? 'Sorted by date' : 'Sorted by name'"
            @click="sortBy = sortBy === 'date' ? 'name' : 'date'"
          >
            <ArrowUpDown class="mr-0.5 h-2.5 w-2.5" />
            {{ sortBy === 'date' ? 'Date' : 'Name' }}
          </Button>
        </div>
        <Button variant="ghost" size="sm" class="h-7 w-7 shrink-0 p-0" @click="refresh">
          <RefreshCw
            class="h-3.5 w-3.5 transition-transform duration-300"
            :class="{ 'animate-spin': isRefreshing }"
          />
        </Button>
      </div>
    </div>

    <!-- Runs list -->
    <ScrollArea class="min-h-0 flex-1">
      <!-- Current active/live run (if running and not in the DB list yet) -->
      <div
        v-if="store.currentRun && store.isRunning"
        class="flex w-full cursor-pointer items-start gap-2.5 border-b border-border border-l-2 border-l-primary bg-primary/8 px-3 py-2.5 text-left"
      >
        <Loader2 class="mt-0.5 h-4 w-4 shrink-0 animate-spin text-primary" />
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-medium text-foreground">Active Run</p>
          <p class="flex items-center gap-1 text-[10px] text-primary/70">
            <GitBranch class="h-2.5 w-2.5" />
            {{ store.currentRun.branchName }}
          </p>
          <p class="text-[10px] text-muted-foreground">
            Cycle {{ (store.currentRun.currentCycleNumber || 0) + 1 }}
            <span v-if="store.currentRun.totalCommits > 0">
              · {{ store.currentRun.totalCommits }} commits
            </span>
          </p>
        </div>
      </div>

      <!-- Historical runs -->
      <div
        v-for="run in filteredRuns.slice(0, visibleCount)"
        :key="run.id"
        class="group flex w-full cursor-pointer items-start gap-2.5 px-3 py-2 text-left transition-colors hover:bg-accent"
        :class="{
          'bg-accent border-l-2 border-l-primary': run.id === store.currentRun?.runId && !store.isRunning,
          'border-l-2 border-l-transparent': run.id !== store.currentRun?.runId || store.isRunning,
        }"
        @click="selectRun(run.id)"
      >
        <component
          :is="statusIcon(run.status)"
          class="mt-0.5 h-3.5 w-3.5 shrink-0"
          :class="{
            'animate-spin text-yellow-400': run.status === 'running',
            'text-green-400': run.status === 'completed',
            'text-red-400': run.status === 'failed' || run.status === 'schedule_timeout',
            'text-blue-400': run.status === 'paused',
            'text-muted-foreground': !['running', 'completed', 'failed', 'paused', 'schedule_timeout'].includes(run.status),
          }"
        />
        <div class="min-w-0 flex-1">
          <p class="truncate text-xs text-foreground">{{ truncateGoal(run.goalPrompt) }}</p>
          <div class="mt-0.5 flex items-center gap-1.5">
            <Badge
              variant="outline"
              :class="['h-4 px-1 text-[9px] font-normal', statusColor(run.status)]"
            >
              {{ run.status }}
            </Badge>
            <span class="text-[10px] text-muted-foreground">
              {{ formatRelativeTime(run.startedAt) }}
            </span>
          </div>
          <div class="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground">
            <span v-if="run.branchName" class="flex items-center gap-0.5 truncate">
              <GitBranch class="h-2.5 w-2.5" />
              {{ run.branchName.replace('autopilot/', '') }}
            </span>
            <span v-if="run.cycleCount > 0">{{ run.cycleCount }} cycles</span>
            <span v-if="run.commitCount > 0">{{ run.commitCount }} commits</span>
            <span>{{ totalTokens(run) }} tok</span>
          </div>
        </div>
        <!-- Resume button for failed/aborted runs -->
        <button
          v-if="['failed', 'aborted'].includes(run.status) && !store.isRunning"
          class="mt-0.5 shrink-0 rounded p-0.5 opacity-0 transition-opacity hover:bg-blue-500/20 group-hover:opacity-100"
          title="Resume from last checkpoint"
          @click="resumeRun(run.id, $event)"
        >
          <RotateCcw class="h-3 w-3 text-blue-400" />
        </button>
      </div>

      <!-- Load More -->
      <Button
        v-if="filteredRuns.length > visibleCount"
        variant="ghost"
        size="sm"
        class="w-full text-xs text-muted-foreground"
        @click="loadMore"
      >
        Load {{ Math.min(10, filteredRuns.length - visibleCount) }} more...
      </Button>

      <!-- Empty state -->
      <p
        v-if="filteredRuns.length === 0 && !store.isRunning"
        class="px-3 py-4 text-center text-xs text-muted-foreground"
      >
        {{ searchQuery ? 'No matching runs' : 'No autopilot runs yet' }}
      </p>
    </ScrollArea>

    <!-- Footer -->
    <div class="border-t border-border p-2">
      <Button class="w-full justify-start gap-2" variant="outline" size="sm" @click="startNew">
        <Plus class="h-4 w-4" />
        New Run
      </Button>
    </div>
  </div>
</template>
