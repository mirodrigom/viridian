<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, type Component } from 'vue';
import type { ChatMessage } from '@/stores/chat';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useProviderLogo } from '@/composables/useProviderLogo';
import ToolView from './tools/ToolView.vue';
import {
  ChevronRight, Check, X, AlertCircle, Brain,
  FileText, FileOutput, Pencil, TerminalSquare,
  FolderSearch, Search, ListTodo, Globe,
  Wrench, Bot, MessageCircleQuestion, Minimize2,
} from 'lucide-vue-next';
import { renderMarkdown, setupCodeCopyHandler } from '@/lib/markdown';

const props = withDefaults(defineProps<{
  message: ChatMessage;
  searchQuery?: string;
  isSearchMatch?: boolean;
  isActiveResult?: boolean;
  isGroupStart?: boolean;
}>(), {
  searchQuery: '',
  isSearchMatch: false,
  isActiveResult: false,
  isGroupStart: true,
});

const emit = defineEmits<{
  approveTool: [requestId: string];
  rejectTool: [requestId: string];
}>();

const { activeLogo, activeName, getLogoForProviderId, getNameForProviderId, logoMap } = useProviderLogo();

// Use snapshotted provider info first (immune to store changes after message creation),
// then fall back to dynamic store lookup by ID, then fall back to active provider.
const messageLogo = computed<Component>(() => {
  if (props.message.providerIcon) return logoMap[props.message.providerIcon] || activeLogo.value;
  if (props.message.provider) return getLogoForProviderId(props.message.provider);
  return activeLogo.value;
});
const messageName = computed<string>(() => {
  if (props.message.providerName) return props.message.providerName;
  if (props.message.provider) return getNameForProviderId(props.message.provider);
  return activeName.value;
});

const thinkingOpen = ref(false);
const contextSummaryOpen = ref(false);

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
  AskUserQuestion: MessageCircleQuestion,
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
    class="flex items-end justify-end gap-1.5 sm:gap-2.5 px-2 sm:px-4 py-3 transition-colors"
    :class="{ 'bg-yellow-500/20 border-l-2 border-l-yellow-500': isActiveResult, 'bg-yellow-500/5': isSearchMatch && !isActiveResult }"
  >
    <div class="max-w-[85%] sm:max-w-[75%]">
      <div class="rounded-2xl rounded-br-md bg-primary px-3 sm:px-4 py-2.5 text-primary-foreground shadow-sm">
        <div v-if="message.images?.length" class="mb-2 flex flex-wrap gap-1.5">
          <img
            v-for="(img, idx) in message.images"
            :key="idx"
            :src="img.dataUrl"
            :alt="img.name"
            class="max-h-48 max-w-full rounded-lg border border-primary-foreground/20 object-contain"
          />
        </div>
        <p class="whitespace-pre-wrap text-sm leading-relaxed">{{ message.content }}</p>
      </div>
      <p class="mt-1 text-right text-[11px] text-muted-foreground">{{ formatTime(message.timestamp) }}</p>
    </div>
    <Avatar class="h-8 w-8 shrink-0 border border-primary/20 hidden sm:flex">
      <AvatarFallback class="bg-primary/10 text-xs font-semibold text-primary">U</AvatarFallback>
    </Avatar>
  </div>

  <!-- Assistant message -->
  <div
    v-else-if="message.role === 'assistant'"
    class="px-2 sm:px-4 transition-colors"
    :class="[
      isGroupStart ? 'pt-3' : 'pt-0.5',
      { 'pb-1': true, 'bg-yellow-500/20 border-l-2 border-l-yellow-500': isActiveResult, 'bg-yellow-500/5': isSearchMatch && !isActiveResult },
    ]"
  >
    <div class="flex items-start gap-1.5 sm:gap-2.5">
      <!-- Avatar: visible on group start, invisible spacer on continuation -->
      <Avatar v-if="isGroupStart" class="h-8 w-8 shrink-0 border border-primary/20 hidden sm:flex">
        <AvatarFallback class="bg-primary/10 p-1">
          <component :is="messageLogo" :size="16" class="text-primary" />
        </AvatarFallback>
      </Avatar>
      <div v-else class="hidden sm:block w-8 shrink-0" />

      <div class="min-w-0 flex-1">
        <p v-if="isGroupStart" class="mb-1.5 text-sm font-semibold text-foreground">{{ messageName }}</p>

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
            <span v-if="message.isThinking">Thinking</span>
            <span v-else>View thinking</span>
          </CollapsibleTrigger>
          <div v-if="message.isThinking" class="ai-thinking-beam mb-2">
            <div class="energy-beam" />
            <div class="energy-beam secondary" />
          </div>
          <CollapsibleContent>
            <div class="mb-3 max-h-64 overflow-auto rounded-lg border border-dashed border-border bg-muted/20 px-3 py-2 text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap">{{ message.thinking }}</div>
          </CollapsibleContent>
        </Collapsible>

        <div
          class="prose prose-sm prose-neutral max-w-none dark:prose-invert prose-pre:bg-muted/60 prose-pre:border prose-pre:border-border prose-code:text-primary prose-code:before:content-none prose-code:after:content-none prose-p:leading-relaxed prose-headings:text-foreground"
          v-html="renderedContent"
        />
        <span v-if="message.isStreaming" class="ml-0.5 inline-block h-4 w-0.5 animate-pulse rounded-full bg-primary" />
      </div>
    </div>
  </div>

  <!-- Tool use -->
  <div v-else-if="message.toolUse" class="py-0.5 px-2 sm:pl-[3.25rem] sm:pr-4">
    <div class="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
      <!-- Tool header -->
      <div class="flex items-center gap-2 sm:gap-2.5 border-b border-border bg-muted/30 px-2.5 sm:px-3.5 py-2.5">
        <div
          class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
          :class="message.toolUse.status === 'rejected'
            ? 'bg-destructive/15 text-destructive'
            : 'bg-primary/15 text-primary'"
        >
          <component :is="toolIcon" class="h-3 w-3" />
        </div>
        <span class="text-sm font-medium text-foreground">{{ message.toolUse.tool === 'AskUserQuestion' ? 'Question' : message.toolUse.tool }}</span>
        <Badge
          v-if="message.toolUse.status === 'pending' && message.toolUse.tool !== 'AskUserQuestion' && message.toolUse.tool !== 'ExitPlanMode'"
          variant="outline"
          class="ml-auto text-[10px]"
        >
          Awaiting approval ({{ approvalTimeLeft }}s)
        </Badge>
        <Badge
          v-else-if="message.toolUse.status === 'pending' && message.toolUse.tool === 'AskUserQuestion'"
          variant="outline"
          class="ml-auto text-[10px]"
        >
          Awaiting answer
        </Badge>
        <Badge
          v-else-if="message.toolUse.status === 'pending' && message.toolUse.tool === 'ExitPlanMode'"
          variant="outline"
          class="ml-auto text-[10px]"
        >
          Plan review
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

      <!-- Approval buttons (when pending, not for AskUserQuestion/ExitPlanMode which have their own UI) -->
      <div v-if="message.toolUse.status === 'pending' && message.toolUse.tool !== 'AskUserQuestion' && message.toolUse.tool !== 'ExitPlanMode'" class="flex gap-2 border-t border-border bg-muted/10 px-2.5 sm:px-3.5 py-2.5">
        <Button size="sm" class="h-9 sm:h-7 flex-1 sm:flex-initial gap-1.5 text-xs" @click="emit('approveTool', message.toolUse!.requestId)">
          <Check class="h-3.5 w-3.5" />
          Allow
        </Button>
        <Button size="sm" variant="outline" class="h-9 sm:h-7 flex-1 sm:flex-initial gap-1.5 text-xs" @click="emit('rejectTool', message.toolUse!.requestId)">
          <X class="h-3.5 w-3.5" />
          Deny
        </Button>
      </div>
    </div>
  </div>

  <!-- Context window resize summary -->
  <div v-else-if="message.isContextSummary" class="py-0.5 px-2 sm:pl-[3.25rem] sm:pr-4">
    <Collapsible v-model:open="contextSummaryOpen" class="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
      <CollapsibleTrigger class="flex w-full items-center gap-2 sm:gap-2.5 bg-muted/30 px-2.5 sm:px-3.5 py-2.5 hover:bg-muted/50 transition-colors">
        <div class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-orange-500/15 text-orange-500">
          <Minimize2 class="h-3 w-3" />
        </div>
        <span class="text-sm font-medium text-foreground">Context Resized</span>
        <ChevronRight
          class="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200"
          :class="{ 'rotate-90': contextSummaryOpen }"
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div
          class="max-h-80 overflow-auto border-t border-border px-3.5 py-3 prose prose-sm prose-neutral max-w-none dark:prose-invert prose-p:leading-relaxed prose-headings:text-foreground"
          v-html="renderedContent"
        />
      </CollapsibleContent>
    </Collapsible>
  </div>

  <!-- System message (errors, info) -->
  <div v-else class="flex items-center gap-2 px-2 sm:px-4 py-1 sm:pl-[3.25rem]">
    <AlertCircle v-if="message.content.startsWith('Error')" class="h-3.5 w-3.5 shrink-0 text-destructive" />
    <p
      class="text-xs"
      :class="message.content.startsWith('Error') ? 'text-destructive' : 'text-muted-foreground'"
    >
      {{ message.content }}
    </p>
  </div>
</template>
