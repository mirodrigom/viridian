<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';

const props = defineProps<{ sessionId?: string }>();
import { useTracesStore, type LangfuseTrace, type LangfuseObservation } from '@/stores/traces';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import {
  Activity, Zap, Wrench, ChevronDown, ChevronRight,
  AlertCircle, Coins, Bot, MessageSquare, RefreshCw,
} from 'lucide-vue-next';

const store = useTracesStore();

onMounted(() => {
  // Only fetch if we already have a session ID — for new conversations
  // claudeSessionId is null until stream_end, so the watch below handles it.
  if (props.sessionId) store.fetchTraces(props.sessionId);
});

watch(() => props.sessionId, (id) => {
  if (id) store.fetchTraces(id);
});

// Expanded trace / observation
const expandedTraceId = ref<string | null>(null);
const expandedObsId = ref<string | null>(null);

function toggleTrace(trace: LangfuseTrace) {
  if (expandedTraceId.value === trace.id) {
    expandedTraceId.value = null;
    expandedObsId.value = null;
    return;
  }
  expandedTraceId.value = trace.id;
  expandedObsId.value = null;
  store.fetchTrace(trace.id);
}

function toggleObs(id: string) {
  expandedObsId.value = expandedObsId.value === id ? null : id;
}

// Reset expanded obs when trace selection changes
watch(expandedTraceId, () => { expandedObsId.value = null; });

// Helpers
function relativeTime(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h`;
}

function duration(obs: LangfuseObservation): string {
  if (!obs.startTime || !obs.endTime) return '';
  const ms = new Date(obs.endTime).getTime() - new Date(obs.startTime).getTime();
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function traceLabel(trace: LangfuseTrace): string {
  return trace.name || 'chat';
}

function traceHasError(trace: LangfuseTrace): boolean {
  return !!trace.observations?.some(o => o.level === 'ERROR');
}

function totalTokens(trace: LangfuseTrace): number {
  const gen = trace.observations?.find(o => o.type === 'GENERATION');
  if (!gen?.usage) return 0;
  return (gen.usage.input || 0) + (gen.usage.output || 0);
}

function labelIcon(name: string) {
  if (name.includes('autopilot')) return Bot;
  return MessageSquare;
}

// Selected trace detail
const detail = computed(() => {
  if (!expandedTraceId.value) return null;
  return store.selectedTrace?.id === expandedTraceId.value ? store.selectedTrace : null;
});

interface ObsNode { obs: LangfuseObservation; depth: number }

const flatObservations = computed<ObsNode[]>(() => {
  const obs = detail.value?.observations;
  if (!obs?.length) return [];

  // Build parent → children map
  const childrenOf = new Map<string | null, LangfuseObservation[]>();
  for (const o of obs) {
    const pid = o.parentObservationId ?? null;
    if (!childrenOf.has(pid)) childrenOf.set(pid, []);
    childrenOf.get(pid)!.push(o);
  }

  // Sort each sibling group by startTime
  childrenOf.forEach(list =>
    list.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()),
  );

  // Flatten depth-first
  const result: ObsNode[] = [];
  function traverse(parentId: string | null, depth: number) {
    for (const child of childrenOf.get(parentId) ?? []) {
      result.push({ obs: child, depth });
      traverse(child.id, depth + 1);
    }
  }
  traverse(null, 0);
  return result;
});

function formatJson(val: unknown): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'string') return val;
  return JSON.stringify(val, null, 2);
}
</script>

<template>
  <div class="flex h-full flex-col bg-card/50">
    <!-- Header -->
    <div class="flex items-center gap-2 border-b border-border px-3 py-2.5">
      <Activity class="h-4 w-4 text-primary" />
      <span class="text-xs font-semibold text-foreground">Traces</span>
      <span v-if="store.traces.length" class="text-[10px] tabular-nums text-muted-foreground ml-auto">
        {{ store.traces.length }}
      </span>
      <Button variant="ghost" size="sm" class="h-5 w-5 p-0 ml-1 text-muted-foreground" @click="store.fetchTraces()">
        <RefreshCw class="h-3 w-3" :class="{ 'animate-spin': store.loading }" />
      </Button>
      <slot name="header-action" />
    </div>

    <!-- Not configured banner -->
    <div v-if="!store.configured" class="flex flex-1 flex-col items-center justify-center gap-2 p-4 text-center">
      <Activity class="h-8 w-8 text-muted-foreground/30" />
      <p class="text-[11px] text-muted-foreground">Langfuse not configured</p>
      <p class="text-[10px] text-muted-foreground/60">Set keys in <code class="bg-muted px-1 rounded">.env</code></p>
    </div>

    <!-- Trace list -->
    <ScrollArea v-else class="flex-1 overflow-hidden">
      <div v-if="store.traces.length === 0 && !store.loading" class="flex flex-col items-center justify-center gap-2 p-6 text-center">
        <Activity class="h-6 w-6 text-muted-foreground/30" />
        <p class="text-[11px] text-muted-foreground">No traces yet</p>
      </div>

      <div class="divide-y divide-border/50">
        <div v-for="trace in store.traces.slice(0, 20)" :key="trace.id">
          <!-- Trace row -->
          <button
            class="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/40"
            :class="{ 'bg-muted/50': expandedTraceId === trace.id }"
            @click="toggleTrace(trace)"
          >
            <component :is="expandedTraceId === trace.id ? ChevronDown : ChevronRight" class="h-3 w-3 shrink-0 text-muted-foreground" />
            <span
              class="h-1.5 w-1.5 shrink-0 rounded-full"
              :class="traceHasError(trace) ? 'bg-destructive' : 'bg-primary/60'"
            />
            <component :is="labelIcon(traceLabel(trace))" class="h-3 w-3 shrink-0 text-muted-foreground" />
            <span class="flex-1 truncate text-[11px] font-medium">{{ traceLabel(trace) }}</span>
            <span v-if="totalTokens(trace) > 0" class="flex items-center gap-0.5 text-[9px] text-muted-foreground">
              <Coins class="h-2.5 w-2.5" />{{ (totalTokens(trace) / 1000).toFixed(1) }}k
            </span>
            <span class="text-[9px] text-muted-foreground shrink-0">{{ relativeTime(trace.timestamp) }}</span>
          </button>

          <!-- Expanded: observations -->
          <div v-if="expandedTraceId === trace.id" class="border-t border-border/30 bg-muted/20">
            <div v-if="store.detailLoading" class="flex items-center gap-1.5 px-4 py-3 text-[10px] text-muted-foreground">
              <RefreshCw class="h-3 w-3 animate-spin" /> Loading...
            </div>

            <div v-else-if="flatObservations.length" class="py-1">
              <div v-for="{ obs, depth } in flatObservations" :key="obs.id" class="py-0.5 pr-3" :style="{ paddingLeft: `${depth * 12 + 12}px` }">
                <button
                  class="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left hover:bg-muted/40 transition-colors"
                  @click="toggleObs(obs.id)"
                >
                  <component :is="expandedObsId === obs.id ? ChevronDown : ChevronRight" class="h-2.5 w-2.5 shrink-0 text-muted-foreground" />
                  <!-- Generation icon -->
                  <Zap v-if="obs.type === 'GENERATION'" class="h-3 w-3 shrink-0 text-primary" />
                  <!-- Agent span icon -->
                  <Bot v-else-if="obs.metadata?.isAgent" class="h-3 w-3 shrink-0 text-primary" />
                  <!-- Regular tool icon -->
                  <Wrench v-else class="h-3 w-3 shrink-0 text-muted-foreground" />

                  <span
                    class="flex-1 truncate text-[10px]"
                    :class="obs.type === 'GENERATION' || obs.metadata?.isAgent ? 'font-semibold' : ''"
                  >
                    {{ obs.type === 'GENERATION' ? (obs.name || 'Generation') : obs.name }}
                  </span>

                  <!-- Generation: model + tokens -->
                  <template v-if="obs.type === 'GENERATION'">
                    <span v-if="obs.model" class="text-[9px] text-muted-foreground truncate max-w-20">{{ obs.model }}</span>
                    <span v-if="obs.usage" class="text-[9px] text-muted-foreground shrink-0">
                      {{ ((obs.usage.input || 0) + (obs.usage.output || 0)).toLocaleString() }}t
                    </span>
                  </template>
                  <!-- Span: duration + error -->
                  <template v-else>
                    <span class="text-[9px] text-muted-foreground shrink-0">{{ duration(obs) }}</span>
                    <AlertCircle v-if="obs.level === 'ERROR'" class="h-3 w-3 shrink-0 text-destructive" />
                  </template>
                </button>

                <!-- Expanded I/O -->
                <div v-if="expandedObsId === obs.id" class="ml-4 mt-1 space-y-1.5 pb-1">
                  <template v-if="obs.type === 'GENERATION' && obs.usage">
                    <div class="flex gap-3 text-[9px] text-muted-foreground">
                      <span>in: {{ obs.usage.input?.toLocaleString() }}</span>
                      <span>out: {{ obs.usage.output?.toLocaleString() }}</span>
                    </div>
                  </template>
                  <div v-if="obs.input">
                    <p class="text-[9px] font-medium uppercase tracking-wider text-muted-foreground mb-0.5">Input</p>
                    <pre class="max-h-24 overflow-auto rounded bg-background p-1.5 text-[10px] leading-relaxed whitespace-pre-wrap break-words">{{ formatJson(obs.input) }}</pre>
                  </div>
                  <div v-if="obs.output">
                    <p class="text-[9px] font-medium uppercase tracking-wider text-muted-foreground mb-0.5">Output</p>
                    <pre class="max-h-24 overflow-auto rounded bg-background p-1.5 text-[10px] leading-relaxed whitespace-pre-wrap break-words">{{ formatJson(obs.output) }}</pre>
                  </div>
                  <div v-if="obs.statusMessage" class="text-[10px] text-destructive">{{ obs.statusMessage }}</div>
                </div>
              </div>
            </div>

            <div v-else class="px-4 py-3 text-[10px] text-muted-foreground">
              No observations yet
            </div>
          </div>
        </div>
      </div>
    </ScrollArea>
  </div>
</template>
