<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import { useGraphRunnerStore } from '@/stores/graphRunner';
import { useGraphStore } from '@/stores/graph';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { toast } from 'vue-sonner';
import {
  Clock, Play, CheckCircle, XCircle, ArrowRight, Wrench,
  ChevronLeft, Loader2, Brain, ArrowDown, Bot, History, Trash2,
} from 'lucide-vue-next';

const runner = useGraphRunnerStore();
const graph = useGraphStore();
const activeTab = ref('timeline');
const timelineEnd = ref<HTMLDivElement>();

// Auto-scroll timeline (only when not in playback mode)
watch(
  () => runner.effectiveTimeline.length,
  async () => {
    if (runner.playbackMode) return;
    await nextTick();
    timelineEnd.value?.scrollIntoView({ behavior: 'smooth' });
  },
);

// Fetch history when panel opens and a graph is loaded
watch(
  () => runner.showRunnerPanel,
  (shown) => {
    if (shown && graph.currentGraphId) {
      runner.fetchRunHistory(graph.currentGraphId);
    }
  },
  { immediate: true },
);

// Re-fetch when a run completes
watch(
  () => runner.currentRun?.status,
  (status) => {
    if ((status === 'completed' || status === 'failed' || status === 'aborted') && graph.currentGraphId) {
      runner.fetchRunHistory(graph.currentGraphId);
    }
  },
);

const statusLabel = computed(() => {
  if (!runner.currentRun) return 'Idle';
  switch (runner.currentRun.status) {
    case 'running': return 'Running';
    case 'completed': return 'Completed';
    case 'failed': return 'Failed';
    case 'aborted': return 'Aborted';
    default: return 'Idle';
  }
});

const statusColor = computed(() => {
  if (!runner.currentRun) return 'text-muted-foreground';
  switch (runner.currentRun.status) {
    case 'running': return 'text-yellow-500';
    case 'completed': return 'text-green-500';
    case 'failed': return 'text-red-500';
    case 'aborted': return 'text-orange-500';
    default: return 'text-muted-foreground';
  }
});

const duration = computed(() => {
  if (!runner.currentRun?.startedAt) return null;
  const end = runner.currentRun.completedAt ?? Date.now();
  const ms = end - runner.currentRun.startedAt;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
});

function timelineIcon(type: string) {
  switch (type) {
    case 'node_start': return Play;
    case 'node_complete': return CheckCircle;
    case 'node_failed': return XCircle;
    case 'node_delegated': return ArrowRight;
    case 'node_skipped': return CheckCircle;
    case 'delegation': return ArrowRight;
    case 'result_return': return ArrowDown;
    case 'tool_use': return Wrench;
    default: return Clock;
  }
}

function timelineColor(type: string) {
  switch (type) {
    case 'node_start': return 'text-yellow-500';
    case 'node_complete': return 'text-green-500';
    case 'node_failed': return 'text-red-500';
    case 'node_delegated': return 'text-blue-400';
    case 'node_skipped': return 'text-muted-foreground';
    case 'delegation': return 'text-primary';
    case 'result_return': return 'text-chart-2';
    case 'tool_use': return 'text-chart-4';
    default: return 'text-muted-foreground';
  }
}

function formatTime(ts: number) {
  const d = new Date(ts);
  return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function selectNode(nodeId: string) {
  if (nodeId) {
    runner.selectExecution(nodeId);
    activeTab.value = 'detail';
  }
}

// ─── History helpers ──────────────────────────────────────────────────

async function onLoadRun(runId: string) {
  try {
    await runner.loadRun(runId);
    activeTab.value = 'timeline';
  } catch {
    toast.error('Failed to load run');
  }
}

async function onDeleteRun(runId: string) {
  try {
    await runner.deleteRun(runId);
  } catch {
    toast.error('Failed to delete run');
  }
}

function formatDuration(startedAt: string, completedAt: string | null): string {
  if (!completedAt) return 'In progress';
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

function formatDate(isoStr: string): string {
  return new Date(isoStr).toLocaleString('en-US', {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
    hour12: false,
  });
}
</script>

<template>
  <div class="flex h-full flex-col border-l border-border">
    <!-- Header -->
    <div class="flex h-9 items-center gap-2 border-b border-border px-3">
      <!-- Back button when in detail view -->
      <button
        v-if="activeTab === 'detail' && runner.selectedExecution"
        class="rounded p-0.5 hover:bg-accent"
        @click="activeTab = 'timeline'"
      >
        <ChevronLeft class="h-4 w-4" />
      </button>

      <Bot class="h-4 w-4 text-primary" />
      <span class="text-xs font-medium uppercase tracking-wider text-muted-foreground">Runner</span>

      <div class="flex-1" />

      <!-- Status -->
      <div class="flex items-center gap-1.5">
        <Loader2 v-if="runner.isRunning" class="h-3 w-3 animate-spin text-yellow-500" />
        <span class="text-xs" :class="statusColor">{{ statusLabel }}</span>
        <span v-if="duration" class="text-[10px] text-muted-foreground">{{ duration }}</span>
      </div>
    </div>

    <!-- Tabs — always visible so History is accessible even without an active run -->
    <Tabs v-model="activeTab" class="flex flex-1 flex-col overflow-hidden">
      <TabsList class="mx-3 mt-2 h-8">
        <TabsTrigger value="timeline" class="h-6 text-xs">Timeline</TabsTrigger>
        <TabsTrigger value="detail" class="h-6 text-xs" :disabled="!runner.selectedExecution">
          Node Detail
        </TabsTrigger>
        <TabsTrigger value="history" class="h-6 text-xs">
          History
        </TabsTrigger>
      </TabsList>

      <!-- Timeline View -->
      <TabsContent value="timeline" class="flex-1 overflow-hidden m-0 p-0">
        <!-- Empty state when no run -->
        <div v-if="!runner.currentRun" class="flex h-full items-center justify-center p-6">
          <div class="text-center text-sm text-muted-foreground">
            <Play class="mx-auto mb-2 h-8 w-8 opacity-30" />
            <p>No active run</p>
            <p class="mt-1 text-xs">Click Run in the toolbar to execute this graph</p>
          </div>
        </div>

        <ScrollArea v-else class="h-full">
          <TransitionGroup
            tag="div"
            class="space-y-0.5 p-3"
            enter-active-class="slide-in-left-enter-active"
            enter-from-class="slide-in-left-enter-from"
            leave-active-class="slide-in-left-leave-active"
            leave-to-class="slide-in-left-leave-to"
          >
            <div
              v-for="(entry, i) in runner.effectiveTimeline"
              :key="entry.timestamp + '-' + i"
              class="group flex items-start gap-2 rounded px-2 py-1.5 text-xs transition-colors hover:bg-accent/50"
              :class="entry.nodeId ? 'cursor-pointer' : ''"
              @click="selectNode(entry.nodeId)"
            >
              <!-- Icon -->
              <component
                :is="timelineIcon(entry.type)"
                class="mt-0.5 h-3.5 w-3.5 shrink-0"
                :class="timelineColor(entry.type)"
              />

              <!-- Content -->
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-1.5">
                  <span class="font-medium text-foreground">{{ entry.nodeLabel }}</span>
                  <span class="text-[10px] text-muted-foreground">{{ formatTime(entry.timestamp) }}</span>
                </div>
                <p class="truncate text-muted-foreground">{{ entry.detail }}</p>
              </div>
            </div>

            <!-- Active nodes streaming indicator -->
            <div v-for="nodeId in runner.activeNodeIds" :key="'active-' + nodeId" class="flex items-start gap-2 rounded bg-yellow-500/5 px-2 py-1.5 text-xs">
              <Loader2 class="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-yellow-500" />
              <div class="min-w-0 flex-1">
                <span class="font-medium text-foreground">
                  {{ runner.currentRun?.executions[nodeId]?.nodeLabel ?? nodeId }}
                </span>
                <p class="line-clamp-2 text-muted-foreground">
                  {{ (runner.currentRun?.executions[nodeId]?.outputText ?? '').slice(-200) || 'Generating...' }}
                </p>
              </div>
            </div>

            <div ref="timelineEnd" :key="'anchor'" />
          </TransitionGroup>
        </ScrollArea>
      </TabsContent>

      <!-- Node Detail View -->
      <TabsContent value="detail" class="flex-1 overflow-hidden m-0 p-0">
        <ScrollArea v-if="runner.selectedExecution" class="h-full">
          <div class="space-y-3 p-3">
            <!-- Node header -->
            <div class="flex items-center gap-2">
              <Badge
                variant="outline"
                :class="{
                  'border-yellow-500/50 text-yellow-500': runner.selectedExecution.status === 'running',
                  'border-blue-400/50 text-blue-400': runner.selectedExecution.status === 'delegated',
                  'border-green-500/50 text-green-500': runner.selectedExecution.status === 'completed',
                  'border-red-500/50 text-red-500': runner.selectedExecution.status === 'failed',
                }"
              >
                {{ runner.selectedExecution.status }}
              </Badge>
              <span class="text-sm font-semibold">{{ runner.selectedExecution.nodeLabel }}</span>
              <span class="text-xs text-muted-foreground capitalize">{{ runner.selectedExecution.nodeType }}</span>
            </div>

            <!-- Duration & Usage -->
            <div class="flex gap-3 text-[10px] text-muted-foreground">
              <span v-if="runner.selectedExecution.startedAt">
                Started: {{ formatTime(runner.selectedExecution.startedAt) }}
              </span>
              <span v-if="runner.selectedExecution.usage.inputTokens">
                In: {{ runner.selectedExecution.usage.inputTokens.toLocaleString() }}
              </span>
              <span v-if="runner.selectedExecution.usage.outputTokens">
                Out: {{ runner.selectedExecution.usage.outputTokens.toLocaleString() }}
              </span>
            </div>

            <!-- Input Prompt -->
            <div>
              <div class="mb-1 text-[10px] font-medium uppercase text-muted-foreground">Input</div>
              <div class="max-h-32 overflow-auto rounded border border-border bg-muted/30 p-2 text-xs">
                {{ runner.selectedExecution.inputPrompt }}
              </div>
            </div>

            <!-- Thinking (if any) -->
            <div v-if="runner.selectedExecution.thinkingText">
              <div class="mb-1 flex items-center gap-1 text-[10px] font-medium uppercase text-muted-foreground">
                <Brain class="h-3 w-3" /> Thinking
              </div>
              <div class="max-h-40 overflow-auto rounded border border-border bg-purple-500/5 p-2 text-xs text-muted-foreground">
                {{ runner.selectedExecution.thinkingText.slice(-2000) }}
              </div>
            </div>

            <!-- Output -->
            <div>
              <div class="mb-1 text-[10px] font-medium uppercase text-muted-foreground">Output</div>
              <div class="max-h-64 overflow-auto rounded border border-border bg-muted/30 p-2 text-xs whitespace-pre-wrap">
                {{ runner.selectedExecution.outputText || '(no output yet)' }}
              </div>
            </div>

            <!-- Tool Calls -->
            <div v-if="runner.selectedExecution.toolCalls.length">
              <div class="mb-1 text-[10px] font-medium uppercase text-muted-foreground">
                Tool Calls ({{ runner.selectedExecution.toolCalls.length }})
              </div>
              <div class="space-y-1">
                <div
                  v-for="tc in runner.selectedExecution.toolCalls"
                  :key="tc.requestId"
                  class="flex items-center gap-2 rounded border border-border bg-muted/20 px-2 py-1 text-xs"
                >
                  <Wrench class="h-3 w-3 shrink-0 text-chart-4" />
                  <span class="font-mono">{{ tc.tool }}</span>
                  <Badge
                    variant="outline"
                    class="ml-auto text-[10px]"
                    :class="tc.status === 'completed' ? 'text-green-500' : 'text-yellow-500'"
                  >
                    {{ tc.status }}
                  </Badge>
                </div>
              </div>
            </div>

            <!-- Error -->
            <div v-if="runner.selectedExecution.error" class="rounded border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-400">
              {{ runner.selectedExecution.error }}
            </div>
          </div>
        </ScrollArea>
      </TabsContent>

      <!-- History View -->
      <TabsContent value="history" class="flex-1 overflow-hidden m-0 p-0">
        <ScrollArea class="h-full">
          <div class="space-y-1 p-3">
            <!-- Loading -->
            <div v-if="runner.loadingHistory" class="flex items-center justify-center py-8">
              <Loader2 class="h-5 w-5 animate-spin text-muted-foreground" />
            </div>

            <!-- No graph saved -->
            <div v-else-if="!graph.currentGraphId" class="py-8 text-center text-sm text-muted-foreground">
              <History class="mx-auto mb-2 h-8 w-8 opacity-30" />
              <p>Save this graph first to see run history.</p>
            </div>

            <!-- Empty history -->
            <div v-else-if="runner.runHistory.length === 0" class="py-8 text-center text-sm text-muted-foreground">
              <History class="mx-auto mb-2 h-8 w-8 opacity-30" />
              <p>No runs yet</p>
              <p class="mt-1 text-xs">Click Run in the toolbar to execute this graph</p>
            </div>

            <!-- Run list -->
            <div
              v-else
              v-for="run in runner.runHistory"
              :key="run.id"
              class="group flex items-start gap-2 rounded border border-border bg-card/50 px-3 py-2 cursor-pointer transition-colors hover:bg-accent/50"
              @click="onLoadRun(run.id)"
            >
              <!-- Status icon -->
              <CheckCircle v-if="run.status === 'completed'" class="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
              <XCircle v-else-if="run.status === 'failed'" class="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
              <Loader2 v-else-if="run.status === 'running'" class="mt-0.5 h-4 w-4 shrink-0 animate-spin text-yellow-500" />
              <Clock v-else class="mt-0.5 h-4 w-4 shrink-0 text-orange-500" />

              <div class="min-w-0 flex-1">
                <p class="text-xs font-medium truncate">{{ run.prompt }}</p>
                <div class="flex items-center gap-2 text-[10px] text-muted-foreground">
                  <span>{{ formatDate(run.startedAt) }}</span>
                  <span>{{ formatDuration(run.startedAt, run.completedAt) }}</span>
                  <span v-if="run.totalInputTokens || run.totalOutputTokens">
                    {{ (run.totalInputTokens + run.totalOutputTokens).toLocaleString() }} tok
                  </span>
                </div>
              </div>

              <!-- Delete button -->
              <button
                class="rounded p-1 opacity-0 group-hover:opacity-100 hover:bg-destructive/20 transition-opacity"
                title="Delete run"
                @click.stop="onDeleteRun(run.id)"
              >
                <Trash2 class="h-3 w-3 text-muted-foreground hover:text-destructive" />
              </button>
            </div>
          </div>
        </ScrollArea>
      </TabsContent>
    </Tabs>
  </div>
</template>
