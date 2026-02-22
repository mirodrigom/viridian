<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useTracesStore, type LangfuseTrace, type LangfuseObservation } from '@/stores/traces';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  RefreshCw, Activity, Zap, Wrench, ChevronDown, ChevronRight,
  AlertCircle, Coins, Bot, MessageSquare, WifiOff,
} from 'lucide-vue-next';

const store = useTracesStore();

onMounted(() => {
  store.fetchStatus();
  store.fetchTraces();
});

// ── Expanded observation state ────────────────────────────────────────────────
const expandedObs = ref<string | null>(null);

function toggleObs(id: string) {
  expandedObs.value = expandedObs.value === id ? null : id;
}

watch(() => store.selectedTrace, () => { expandedObs.value = null; });

// ── Helpers ───────────────────────────────────────────────────────────────────
function relativeTime(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function formatDate(ts: string): string {
  return new Date(ts).toLocaleString();
}

function duration(obs: LangfuseObservation): string {
  if (!obs.startTime || !obs.endTime) return '';
  const ms = new Date(obs.endTime).getTime() - new Date(obs.startTime).getTime();
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function totalTokens(trace: LangfuseTrace): number {
  const gen = trace.observations?.find(o => o.type === 'GENERATION');
  if (!gen?.usage) return 0;
  return (gen.usage.input || 0) + (gen.usage.output || 0);
}

function traceHasError(trace: LangfuseTrace): boolean {
  return !!trace.observations?.some(o => o.level === 'ERROR');
}

function providerFromTags(trace: LangfuseTrace): string {
  return trace.tags?.find(t => !['chat', 'autopilot', 'autopilot:orchestrator', 'autopilot:worker'].includes(t)) || 'claude';
}

function traceLabel(trace: LangfuseTrace): string {
  return trace.name || 'chat';
}

function labelIcon(name: string) {
  if (name.includes('autopilot')) return Bot;
  return MessageSquare;
}

function formatJson(val: unknown): string {
  if (val === null || val === undefined) return '—';
  if (typeof val === 'string') return val;
  return JSON.stringify(val, null, 2);
}

// ── Observation tree for selected trace ──────────────────────────────────────
const generation = computed<LangfuseObservation | undefined>(() =>
  store.selectedTrace?.observations?.find(o => o.type === 'GENERATION'),
);

const spans = computed<LangfuseObservation[]>(() =>
  store.selectedTrace?.observations?.filter(o => o.type === 'SPAN') || [],
);
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden">
    <!-- No config / not reachable banners -->
    <div v-if="!store.configured" class="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <Activity class="h-12 w-12 text-muted-foreground/40" />
      <div>
        <p class="font-medium">Langfuse not configured</p>
        <p class="mt-1 text-sm text-muted-foreground">Add your keys to <code class="rounded bg-muted px-1 py-0.5 text-xs">.env</code> to enable agent tracing.</p>
      </div>
      <div class="rounded-lg border border-border bg-muted/50 px-4 py-3 text-left text-xs font-mono">
        <p class="text-muted-foreground"># .env</p>
        <p>LANGFUSE_BASE_URL=http://localhost:3001</p>
        <p>LANGFUSE_PUBLIC_KEY=pk-lf-...</p>
        <p>LANGFUSE_SECRET_KEY=sk-lf-...</p>
      </div>
      <p class="text-xs text-muted-foreground">Start Langfuse: <code class="rounded bg-muted px-1 py-0.5">podman-compose up -d</code></p>
    </div>

    <div v-else-if="!store.reachable" class="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <WifiOff class="h-10 w-10 text-muted-foreground/40" />
      <p class="font-medium">Cannot reach Langfuse</p>
      <p class="text-sm text-muted-foreground">Make sure Langfuse is running: <code class="rounded bg-muted px-1 py-0.5 text-xs">podman-compose up -d</code></p>
      <Button variant="outline" size="sm" @click="store.fetchStatus(); store.fetchTraces()">
        <RefreshCw class="mr-1.5 h-3.5 w-3.5" /> Retry
      </Button>
    </div>

    <!-- Main layout -->
    <template v-else>
      <!-- Toolbar -->
      <div class="flex h-10 items-center gap-2 border-b border-border px-3">
        <Activity class="h-4 w-4 text-primary" />
        <span class="text-sm font-medium">Traces</span>
        <div class="flex-1" />
        <Button variant="ghost" size="sm" class="h-7 w-7 p-0" :disabled="store.loading" @click="store.fetchTraces()">
          <RefreshCw class="h-3.5 w-3.5" :class="{ 'animate-spin': store.loading }" />
        </Button>
      </div>

      <ResizablePanelGroup direction="horizontal" class="flex-1 overflow-hidden">
        <!-- Left: trace list -->
        <ResizablePanel :default-size="30" :min-size="20" :max-size="50">
          <ScrollArea class="h-full">
            <div v-if="store.traces.length === 0 && !store.loading" class="flex flex-col items-center justify-center gap-2 p-8 text-center text-sm text-muted-foreground">
              <Activity class="h-8 w-8 opacity-30" />
              <p>No traces yet.</p>
              <p class="text-xs">Send a message in Chat to generate one.</p>
            </div>
            <div class="divide-y divide-border">
              <button
                v-for="trace in store.traces"
                :key="trace.id"
                class="flex w-full flex-col gap-1 px-3 py-2.5 text-left transition-colors hover:bg-muted/50"
                :class="{ 'bg-muted/70': store.selectedTrace?.id === trace.id }"
                @click="store.selectTrace(trace)"
              >
                <div class="flex items-center gap-1.5">
                  <!-- error indicator -->
                  <span
                    class="mt-px h-1.5 w-1.5 shrink-0 rounded-full"
                    :class="traceHasError(trace) ? 'bg-destructive' : 'bg-primary/60'"
                  />
                  <component :is="labelIcon(traceLabel(trace))" class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span class="truncate text-xs font-medium">{{ traceLabel(trace) }}</span>
                  <span class="ml-auto shrink-0 text-[10px] text-muted-foreground">{{ relativeTime(trace.timestamp) }}</span>
                </div>
                <div class="flex items-center gap-2 pl-5 text-[10px] text-muted-foreground">
                  <span class="capitalize">{{ providerFromTags(trace) }}</span>
                  <template v-if="totalTokens(trace) > 0">
                    <span>·</span>
                    <span class="flex items-center gap-0.5">
                      <Coins class="h-2.5 w-2.5" />{{ totalTokens(trace).toLocaleString() }}
                    </span>
                  </template>
                </div>
              </button>
            </div>
          </ScrollArea>
        </ResizablePanel>

        <ResizableHandle />

        <!-- Right: trace detail -->
        <ResizablePanel :default-size="70" :min-size="40">
          <div v-if="!store.selectedTrace" class="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
            <Activity class="h-8 w-8 opacity-30" />
            <p>Select a trace to inspect</p>
          </div>

          <ScrollArea v-else class="h-full">
            <div class="p-4 space-y-4">
              <!-- Header -->
              <div class="space-y-1">
                <div class="flex items-center gap-2">
                  <component :is="labelIcon(traceLabel(store.selectedTrace))" class="h-4 w-4 text-primary" />
                  <span class="font-semibold capitalize">{{ traceLabel(store.selectedTrace) }}</span>
                  <Badge v-if="traceHasError(store.selectedTrace)" variant="destructive" class="text-[10px]">error</Badge>
                  <Badge v-else variant="outline" class="text-[10px]">ok</Badge>
                </div>
                <p class="text-xs text-muted-foreground">{{ formatDate(store.selectedTrace.timestamp) }}</p>
                <div class="flex flex-wrap gap-x-4 gap-y-0.5 text-[10px] text-muted-foreground">
                  <span v-if="store.selectedTrace.metadata?.providerId">
                    provider: <span class="text-foreground/70">{{ store.selectedTrace.metadata.providerId }}</span>
                  </span>
                  <span v-if="store.selectedTrace.metadata?.claudeSessionId">
                    session: <span class="font-mono text-foreground/70">{{ String(store.selectedTrace.metadata.claudeSessionId).slice(0, 12) }}…</span>
                  </span>
                </div>
              </div>

              <div v-if="store.detailLoading" class="flex items-center gap-2 text-sm text-muted-foreground">
                <RefreshCw class="h-3.5 w-3.5 animate-spin" /> Loading…
              </div>

              <!-- Observation tree -->
              <div v-else-if="store.selectedTrace.observations?.length" class="space-y-1">
                <p class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Timeline</p>

                <!-- Generation row -->
                <div v-if="generation" class="rounded-md border border-border overflow-hidden">
                  <button
                    class="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/40 transition-colors"
                    @click="toggleObs(generation.id)"
                  >
                    <component :is="expandedObs === generation.id ? ChevronDown : ChevronRight" class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <Zap class="h-3.5 w-3.5 shrink-0 text-primary" />
                    <span class="flex-1 text-xs font-medium">Generation</span>
                    <span v-if="generation.model" class="text-[10px] text-muted-foreground">{{ generation.model }}</span>
                    <span v-if="generation.usage" class="flex items-center gap-0.5 text-[10px] text-muted-foreground">
                      <Coins class="h-2.5 w-2.5" />
                      {{ ((generation.usage.input || 0) + (generation.usage.output || 0)).toLocaleString() }}
                    </span>
                    <span class="text-[10px] text-muted-foreground">{{ duration(generation) }}</span>
                    <AlertCircle v-if="generation.level === 'ERROR'" class="h-3.5 w-3.5 text-destructive" />
                  </button>
                  <!-- Generation I/O -->
                  <div v-if="expandedObs === generation.id" class="border-t border-border bg-muted/30 p-3 space-y-3">
                    <div v-if="generation.usage" class="flex gap-4 text-[10px] text-muted-foreground">
                      <span>input tokens: <span class="text-foreground/70">{{ generation.usage.input?.toLocaleString() }}</span></span>
                      <span>output tokens: <span class="text-foreground/70">{{ generation.usage.output?.toLocaleString() }}</span></span>
                    </div>
                    <div v-if="generation.input">
                      <p class="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Input</p>
                      <pre class="max-h-48 overflow-auto rounded bg-background p-2 text-[11px] leading-relaxed whitespace-pre-wrap break-words">{{ formatJson(generation.input) }}</pre>
                    </div>
                    <div v-if="generation.output">
                      <p class="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Output</p>
                      <pre class="max-h-48 overflow-auto rounded bg-background p-2 text-[11px] leading-relaxed whitespace-pre-wrap break-words">{{ formatJson(generation.output) }}</pre>
                    </div>
                    <div v-if="generation.statusMessage" class="text-[11px] text-destructive">{{ generation.statusMessage }}</div>
                  </div>
                </div>

                <!-- Span rows -->
                <div v-if="spans.length" class="ml-4 space-y-1">
                  <div v-for="span in spans" :key="span.id" class="rounded-md border border-border overflow-hidden">
                    <button
                      class="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/40 transition-colors"
                      @click="toggleObs(span.id)"
                    >
                      <component :is="expandedObs === span.id ? ChevronDown : ChevronRight" class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <Wrench class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span class="flex-1 truncate text-xs">
                        <span v-if="span.metadata?.isSubagent" class="mr-1 text-[10px] text-muted-foreground">[subagent]</span>
                        {{ span.name }}
                      </span>
                      <span class="text-[10px] text-muted-foreground">{{ duration(span) }}</span>
                      <AlertCircle v-if="span.level === 'ERROR'" class="h-3.5 w-3.5 text-destructive" />
                    </button>
                    <!-- Span I/O -->
                    <div v-if="expandedObs === span.id" class="border-t border-border bg-muted/30 p-3 space-y-3">
                      <div v-if="span.input">
                        <p class="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Input</p>
                        <pre class="max-h-40 overflow-auto rounded bg-background p-2 text-[11px] leading-relaxed whitespace-pre-wrap break-words">{{ formatJson(span.input) }}</pre>
                      </div>
                      <div v-if="span.output">
                        <p class="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Output</p>
                        <pre class="max-h-40 overflow-auto rounded bg-background p-2 text-[11px] leading-relaxed whitespace-pre-wrap break-words">{{ formatJson(span.output) }}</pre>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- No observations yet (trace just started) -->
              <div v-else class="text-sm text-muted-foreground">
                No observations yet — trace may still be processing.
              </div>
            </div>
          </ScrollArea>
        </ResizablePanel>
      </ResizablePanelGroup>
    </template>
  </div>
</template>
