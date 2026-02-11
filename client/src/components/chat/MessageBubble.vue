<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, type Component } from 'vue';
import type { ChatMessage } from '@/stores/chat';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import ClaudeLogo from '@/components/icons/ClaudeLogo.vue';
import ToolView from './tools/ToolView.vue';
import {
  ChevronRight, Check, X, AlertCircle, Brain,
  FileText, FileOutput, Pencil, TerminalSquare,
  FolderSearch, Search, ListTodo, Globe,
  Wrench, Bot,
} from 'lucide-vue-next';
import { renderMarkdown, setupCodeCopyHandler } from '@/lib/markdown';

const props = withDefaults(defineProps<{
  message: ChatMessage;
  searchQuery?: string;
  isSearchMatch?: boolean;
  isActiveResult?: boolean;
}>(), {
  searchQuery: '',
  isSearchMatch: false,
  isActiveResult: false,
});

const emit = defineEmits<{
  approveTool: [requestId: string];
  rejectTool: [requestId: string];
}>();

const thinkingOpen = ref(false);

const TOOL_ICONS: Record<string, Component> = {
  Read: FileText,
  Write: FileOutput,
  Edit: Pencil,
  Bash: TerminalSquare,
  Glob: FolderSearch,
  Grep: Search,
  TodoWrite: ListTodo,
  WebFetch: Globe,
  WebSearch: Search,
  Task: Bot,
};

const toolIcon = computed(() => {
  if (!props.message.toolUse) return Wrench;
  return TOOL_ICONS[props.message.toolUse.tool] || Wrench;
});

const renderedContent = computed(() => {
  if (!props.message.content) return '';
  return renderMarkdown(props.message.content);
});

// Tool approval countdown
const approvalTimeLeft = ref(55);
let approvalTimer: ReturnType<typeof setInterval> | null = null;

watch(() => props.message.toolUse?.status, (status) => {
  if (status === 'pending') {
    approvalTimeLeft.value = 55;
    approvalTimer = setInterval(() => {
      approvalTimeLeft.value--;
      if (approvalTimeLeft.value <= 0 && approvalTimer) {
        clearInterval(approvalTimer);
      }
    }, 1000);
  } else if (approvalTimer) {
    clearInterval(approvalTimer);
    approvalTimer = null;
  }
}, { immediate: true });

// Global click handler for code copy buttons
let cleanupCopy: (() => void) | null = null;
onMounted(() => { cleanupCopy = setupCodeCopyHandler(); });
onUnmounted(() => {
  cleanupCopy?.();
  if (approvalTimer) clearInterval(approvalTimer);
});

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
}
</script>

<template>
  <!-- User message -->
  <div
    v-if="message.role === 'user'"
    class="flex items-end justify-end gap-2.5 px-4 py-3 transition-colors"
    :class="{ 'bg-yellow-500/10': isActiveResult, 'bg-yellow-500/5': isSearchMatch && !isActiveResult }"
  >
    <div class="max-w-[75%]">
      <div class="rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-primary-foreground shadow-sm">
        <p class="whitespace-pre-wrap text-sm leading-relaxed">{{ message.content }}</p>
      </div>
      <p class="mt-1 text-right text-[11px] text-muted-foreground">{{ formatTime(message.timestamp) }}</p>
    </div>
    <Avatar class="h-8 w-8 shrink-0 border border-primary/20">
      <AvatarFallback class="bg-primary/10 text-xs font-semibold text-primary">U</AvatarFallback>
    </Avatar>
  </div>

  <!-- Assistant message -->
  <div
    v-else-if="message.role === 'assistant'"
    class="px-4 py-3 transition-colors"
    :class="{ 'bg-yellow-500/10': isActiveResult, 'bg-yellow-500/5': isSearchMatch && !isActiveResult }"
  >
    <div class="flex items-start gap-2.5">
      <Avatar class="h-8 w-8 shrink-0 border border-primary/20">
        <AvatarFallback class="bg-primary/10 p-1">
          <ClaudeLogo :size="16" class="text-primary" />
        </AvatarFallback>
      </Avatar>
      <div class="min-w-0 flex-1">
        <p class="mb-1.5 text-sm font-semibold text-foreground">Claude</p>

        <!-- Thinking block (collapsible) -->
        <Collapsible v-if="message.thinking || message.isThinking" v-model:open="thinkingOpen">
          <CollapsibleTrigger
            class="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronRight
              class="h-3 w-3 shrink-0 transition-transform duration-200"
              :class="{ 'rotate-90': thinkingOpen }"
            />
            <Brain class="h-3.5 w-3.5" />
            <span v-if="message.isThinking" class="flex items-center gap-1.5">
              Thinking
              <span class="inline-flex gap-0.5">
                <span class="h-1 w-1 rounded-full bg-primary animate-bounce [animation-delay:0ms]" />
                <span class="h-1 w-1 rounded-full bg-primary animate-bounce [animation-delay:150ms]" />
                <span class="h-1 w-1 rounded-full bg-primary animate-bounce [animation-delay:300ms]" />
              </span>
            </span>
            <span v-else>View thinking</span>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div class="mb-3 max-h-64 overflow-auto rounded-lg border border-dashed border-border bg-muted/20 px-3 py-2 text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap">{{ message.thinking }}</div>
          </CollapsibleContent>
        </Collapsible>

        <div
          class="prose prose-sm prose-neutral max-w-none dark:prose-invert prose-pre:bg-muted/60 prose-pre:border prose-pre:border-border prose-code:text-primary prose-code:before:content-none prose-code:after:content-none prose-p:leading-relaxed prose-headings:text-foreground"
          v-html="renderedContent"
        />
        <span v-if="message.isStreaming" class="ml-0.5 inline-block h-4 w-0.5 animate-pulse rounded-full bg-primary" />
        <p class="mt-1.5 text-[11px] text-muted-foreground">{{ formatTime(message.timestamp) }}</p>
      </div>
    </div>
  </div>

  <!-- Tool use -->
  <div v-else-if="message.toolUse" class="py-2 pl-[3.25rem] pr-4">
    <div class="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
      <!-- Tool header -->
      <div class="flex items-center gap-2.5 border-b border-border bg-muted/30 px-3.5 py-2.5">
        <div
          class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
          :class="message.toolUse.status === 'rejected'
            ? 'bg-destructive/15 text-destructive'
            : 'bg-primary/15 text-primary'"
        >
          <component :is="toolIcon" class="h-3 w-3" />
        </div>
        <span class="text-sm font-medium text-foreground">{{ message.toolUse.tool }}</span>
        <Badge
          v-if="message.toolUse.status === 'pending'"
          variant="outline"
          class="ml-auto text-[10px]"
        >
          Awaiting approval ({{ approvalTimeLeft }}s)
        </Badge>
        <Badge
          v-else-if="message.toolUse.status === 'rejected'"
          variant="destructive"
          class="ml-auto text-[10px]"
        >
          Denied
        </Badge>
      </div>

      <!-- Tool-specific visualization -->
      <ToolView :tool-use="message.toolUse" />

      <!-- Approval buttons (when pending) -->
      <div v-if="message.toolUse.status === 'pending'" class="flex gap-2 border-t border-border bg-muted/10 px-3.5 py-2.5">
        <Button size="sm" class="h-7 gap-1.5 text-xs" @click="emit('approveTool', message.toolUse!.requestId)">
          <Check class="h-3.5 w-3.5" />
          Allow
        </Button>
        <Button size="sm" variant="outline" class="h-7 gap-1.5 text-xs" @click="emit('rejectTool', message.toolUse!.requestId)">
          <X class="h-3.5 w-3.5" />
          Deny
        </Button>
      </div>
    </div>
    <p class="mt-1 text-[11px] text-muted-foreground">{{ formatTime(message.timestamp) }}</p>
  </div>

  <!-- System message (errors, info) -->
  <div v-else class="flex items-center gap-2 px-4 py-2 pl-[3.25rem]">
    <AlertCircle v-if="message.content.startsWith('Error')" class="h-3.5 w-3.5 shrink-0 text-destructive" />
    <p
      class="text-xs"
      :class="message.content.startsWith('Error') ? 'text-destructive' : 'text-muted-foreground'"
    >
      {{ message.content }}
    </p>
  </div>
</template>
