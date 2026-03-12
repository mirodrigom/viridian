<script setup lang="ts">
import { watch, computed } from 'vue';
import { useScheduledTasksStore, type TaskExecution } from '@/stores/scheduledTasks';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Clock,
  ChevronDown,
} from 'lucide-vue-next';

const props = defineProps<{
  taskId: string | null;
  taskName: string;
}>();

const emit = defineEmits<{
  close: [];
}>();

const store = useScheduledTasksStore();

const isOpen = computed(() => !!props.taskId);

const executions = computed(() => {
  if (!props.taskId) return [];
  return store.getHistory(props.taskId);
});

watch(() => props.taskId, (id) => {
  if (id) {
    store.fetchHistory(id);
  }
});

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString();
}

function formatDuration(ms: number | null): string {
  if (ms === null) return '-';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60_000);
  const secs = Math.round((ms % 60_000) / 1000);
  return `${mins}m ${secs}s`;
}

function statusIcon(status: string) {
  switch (status) {
    case 'success': return CheckCircle2;
    case 'failure': return XCircle;
    case 'running': return Loader2;
    default: return Clock;
  }
}

function statusColor(status: string): string {
  switch (status) {
    case 'success': return 'text-green-500';
    case 'failure': return 'text-red-500';
    case 'running': return 'text-blue-500';
    default: return 'text-muted-foreground';
  }
}
</script>

<template>
  <Dialog :open="isOpen" @update:open="(v) => { if (!v) emit('close'); }">
    <DialogContent class="sm:max-w-2xl max-h-[80vh] flex flex-col">
      <DialogHeader>
        <DialogTitle>Execution History: {{ taskName }}</DialogTitle>
      </DialogHeader>

      <ScrollArea class="flex-1 min-h-0">
        <div v-if="store.executionLoading" class="flex items-center justify-center py-8">
          <Loader2 class="h-5 w-5 animate-spin text-muted-foreground" />
        </div>

        <div v-else-if="executions.length === 0" class="py-8 text-center text-sm text-muted-foreground">
          No executions yet.
        </div>

        <div v-else class="space-y-2 pr-2">
          <Collapsible v-for="exec in executions" :key="exec.id" class="rounded-md border border-border">
            <CollapsibleTrigger class="flex w-full items-center gap-3 px-3 py-2.5 text-sm hover:bg-muted/30 transition-colors">
              <component
                :is="statusIcon(exec.status)"
                class="h-4 w-4 shrink-0"
                :class="[statusColor(exec.status), exec.status === 'running' ? 'animate-spin' : '']"
              />
              <span class="flex-1 text-left truncate">
                {{ formatDate(exec.startedAt) }}
              </span>
              <Badge
                :class="exec.status === 'success' ? 'bg-green-500/15 text-green-500' : exec.status === 'failure' ? 'bg-red-500/15 text-red-500' : 'bg-blue-500/15 text-blue-500'"
                class="text-[10px] px-1.5 py-0"
              >
                {{ exec.status }}
              </Badge>
              <span class="text-xs text-muted-foreground">
                {{ formatDuration(exec.durationMs) }}
              </span>
              <ChevronDown class="h-4 w-4 shrink-0 text-muted-foreground transition-transform [[data-state=open]>&]:rotate-180" />
            </CollapsibleTrigger>

            <CollapsibleContent>
              <div class="border-t border-border px-3 py-2 space-y-2">
                <div v-if="exec.error" class="rounded bg-red-500/10 p-2">
                  <p class="text-xs font-medium text-red-500">Error</p>
                  <pre class="mt-1 text-xs whitespace-pre-wrap text-red-400">{{ exec.error }}</pre>
                </div>
                <div v-if="exec.output">
                  <p class="text-xs font-medium text-muted-foreground mb-1">Output</p>
                  <pre class="max-h-60 overflow-auto rounded bg-muted p-2 text-xs whitespace-pre-wrap">{{ exec.output.slice(0, 5000) }}{{ exec.output.length > 5000 ? '\n... (truncated)' : '' }}</pre>
                </div>
                <div v-if="!exec.output && !exec.error" class="text-xs text-muted-foreground italic">
                  No output recorded.
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>
      </ScrollArea>
    </DialogContent>
  </Dialog>
</template>
