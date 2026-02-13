<script setup lang="ts">
import { ref, computed, nextTick, watch, onMounted, onUnmounted } from 'vue';
import { useChatStore } from '@/stores/chat';
import { useAuthStore } from '@/stores/auth';
import { useSettingsStore, MODEL_OPTIONS, PERMISSION_OPTIONS, THINKING_OPTIONS, type ClaudeModel, type PermissionMode, type ThinkingMode } from '@/stores/settings';
import { uuid } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Select, SelectContent, SelectItem, SelectTrigger,
} from '@/components/ui/select';
import {
  Send, Square, Zap, Shield, FileEdit, ClipboardList, Brain, FileText, X, ImagePlus,
  ArrowDownToLine, ArrowDownFromLine, Download,
} from 'lucide-vue-next';
import MicButton from './MicButton.vue';
import { exportSession } from '@/composables/useKeyboardShortcuts';

const MAX_IMAGES = 5;

const chat = useChatStore();
const auth = useAuthStore();
const settings = useSettingsStore();
const input = ref('');
const textarea = ref<HTMLTextAreaElement | null>(null);
const imageInput = ref<HTMLInputElement | null>(null);
const selectedCommandIndex = ref(0);
const mentionedFiles = ref<string[]>([]);
const fileSuggestions = ref<string[]>([]);
const selectedFileIndex = ref(0);
const attachedImages = ref<{ name: string; dataUrl: string; size: number }[]>([]);
const isDragging = ref(false);
let fileSearchTimer: ReturnType<typeof setTimeout> | null = null;

// Draft persistence - save/restore typed text per session
const DRAFT_KEY = 'chat-draft';
function saveDraft() {
  const key = chat.sessionId || '_new';
  const drafts = JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}');
  if (input.value.trim()) {
    drafts[key] = input.value;
  } else {
    delete drafts[key];
  }
  localStorage.setItem(DRAFT_KEY, JSON.stringify(drafts));
}
function loadDraft() {
  const key = chat.sessionId || '_new';
  const drafts = JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}');
  input.value = drafts[key] || '';
  nextTick(() => autoResize());
}
// Auto-save draft on input change (debounced via watch)
watch(input, saveDraft);
// Restore draft when session changes
watch(() => chat.sessionId, loadDraft);
onMounted(loadDraft);

// Rate limit countdown — ticks every second to update remaining time display
const rateLimitCountdown = ref('');
let rateLimitInterval: ReturnType<typeof setInterval> | null = null;

function updateRateLimitCountdown() {
  if (!chat.isRateLimited) {
    rateLimitCountdown.value = '';
    if (rateLimitInterval) {
      clearInterval(rateLimitInterval);
      rateLimitInterval = null;
    }
    return;
  }
  const remaining = chat.rateLimitRemainingMs;
  const hours = Math.floor(remaining / 3600000);
  const minutes = Math.floor((remaining % 3600000) / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);
  if (hours > 0) {
    rateLimitCountdown.value = `${hours}h ${minutes}m ${seconds}s`;
  } else if (minutes > 0) {
    rateLimitCountdown.value = `${minutes}m ${seconds}s`;
  } else {
    rateLimitCountdown.value = `${seconds}s`;
  }
}

watch(() => chat.isRateLimited, (limited) => {
  if (limited) {
    updateRateLimitCountdown();
    rateLimitInterval = setInterval(updateRateLimitCountdown, 1000);
  } else {
    rateLimitCountdown.value = '';
    if (rateLimitInterval) {
      clearInterval(rateLimitInterval);
      rateLimitInterval = null;
    }
  }
}, { immediate: true });

onUnmounted(() => {
  if (rateLimitInterval) clearInterval(rateLimitInterval);
});

const emit = defineEmits<{
  send: [message: string, images?: { name: string; dataUrl: string }[]];
  abort: [];
}>();

interface SlashCommand {
  name: string;
  description: string;
  action: () => void;
}

const slashCommands: SlashCommand[] = [
  { name: '/clear', description: 'Clear current conversation', action: () => { chat.clearMessages(); input.value = ''; } },
  { name: '/model', description: 'Switch to next model', action: () => {
    const models = MODEL_OPTIONS.map(m => m.value);
    const idx = models.indexOf(settings.model);
    settings.model = models[(idx + 1) % models.length] as ClaudeModel;
    settings.save();
    chat.addMessage({ id: uuid(), role: 'system', content: `Model switched to ${settings.modelLabel}`, timestamp: Date.now() });
    input.value = '';
  }},
  { name: '/think', description: 'Toggle thinking mode (Standard/Think/Think Hard)', action: () => {
    const modes = THINKING_OPTIONS.map(t => t.value);
    const idx = modes.indexOf(settings.thinkingMode);
    settings.thinkingMode = modes[(idx + 1) % modes.length] as ThinkingMode;
    settings.save();
    chat.addMessage({ id: uuid(), role: 'system', content: `Thinking mode: ${settings.thinkingLabel}`, timestamp: Date.now() });
    input.value = '';
  }},
  { name: '/permission', description: 'Toggle permission mode', action: () => {
    const modes = PERMISSION_OPTIONS.map(p => p.value);
    const idx = modes.indexOf(settings.permissionMode);
    settings.permissionMode = modes[(idx + 1) % modes.length] as PermissionMode;
    settings.save();
    chat.addMessage({ id: uuid(), role: 'system', content: `Permission mode: ${settings.permissionLabel}`, timestamp: Date.now() });
    input.value = '';
  }},
  { name: '/status', description: 'Show current session info', action: () => {
    const lines = [
      `Model: ${settings.modelLabel}`,
      `Thinking: ${settings.thinkingLabel}`,
      `Permission: ${settings.permissionLabel}`,
      `Messages: ${chat.messages.length}`,
      `Context: ${chat.contextPercent}%`,
      chat.usage.totalCost > 0 ? `Cost: $${chat.usage.totalCost.toFixed(4)}` : '',
    ].filter(Boolean);
    chat.addMessage({ id: uuid(), role: 'system', content: lines.join('\n'), timestamp: Date.now() });
    input.value = '';
  }},
  { name: '/cost', description: 'Show token usage and cost', action: () => {
    const lines = [
      `Input tokens: ${formatTokens(chat.usage.inputTokens)}`,
      `Output tokens: ${formatTokens(chat.usage.outputTokens)}`,
      `Context: ${chat.contextPercent}% used`,
      `Total cost: $${chat.usage.totalCost.toFixed(4)}`,
    ];
    chat.addMessage({ id: uuid(), role: 'system', content: lines.join('\n'), timestamp: Date.now() });
    input.value = '';
  }},
  { name: '/help', description: 'Show available commands', action: () => {
    const lines = slashCommands.map(c => `${c.name} — ${c.description}`);
    chat.addMessage({ id: uuid(), role: 'system', content: lines.join('\n'), timestamp: Date.now() });
    input.value = '';
  }},
];

const showCommandMenu = computed(() => {
  return input.value.startsWith('/') && !input.value.includes(' ');
});

const filteredCommands = computed(() => {
  if (!showCommandMenu.value) return [];
  const q = input.value.toLowerCase();
  return slashCommands.filter(c => c.name.startsWith(q));
});

watch(showCommandMenu, (show) => {
  if (show) selectedCommandIndex.value = 0;
});

// File mention system (@file autocomplete)
const mentionQuery = computed(() => {
  if (showCommandMenu.value) return null;
  const el = textarea.value;
  if (!el) return null;
  const pos = el.selectionStart;
  const text = input.value.slice(0, pos);
  const atIdx = text.lastIndexOf('@');
  if (atIdx === -1) return null;
  // Must be start of line or after whitespace
  if (atIdx > 0 && !/\s/.test(text[atIdx - 1]!)) return null;
  const query = text.slice(atIdx + 1);
  // Stop if there's whitespace after the @ (mention already complete)
  if (/\s/.test(query)) return null;
  return { query, start: atIdx };
});

const showFileMenu = computed(() => {
  return mentionQuery.value !== null && mentionQuery.value.query.length >= 1 && fileSuggestions.value.length > 0;
});

watch(mentionQuery, (mq) => {
  if (fileSearchTimer) clearTimeout(fileSearchTimer);
  if (!mq || mq.query.length < 1) {
    fileSuggestions.value = [];
    return;
  }
  fileSearchTimer = setTimeout(async () => {
    if (!chat.projectPath) return;
    try {
      const res = await window.fetch(
        `/api/files/search?root=${encodeURIComponent(chat.projectPath)}&q=${encodeURIComponent(mq.query)}`,
        { headers: { Authorization: `Bearer ${auth.token}` } },
      );
      if (!res.ok) return;
      const data = await res.json();
      fileSuggestions.value = (data.files || []).filter((f: string) => !mentionedFiles.value.includes(f));
      selectedFileIndex.value = 0;
    } catch { /* ignore */ }
  }, 200);
});

function selectFileMention(filePath: string) {
  if (!mentionedFiles.value.includes(filePath)) {
    mentionedFiles.value.push(filePath);
  }
  // Remove the @query from input
  const mq = mentionQuery.value;
  if (mq) {
    input.value = input.value.slice(0, mq.start) + input.value.slice(mq.start + 1 + mq.query.length);
  }
  fileSuggestions.value = [];
  nextTick(() => textarea.value?.focus());
}

function removeFileMention(filePath: string) {
  mentionedFiles.value = mentionedFiles.value.filter(f => f !== filePath);
}

// Image attachment functions
function addImageFiles(files: FileList | File[]) {
  const remaining = MAX_IMAGES - attachedImages.value.length;
  const toProcess = Array.from(files).filter(f => f.type.startsWith('image/')).slice(0, remaining);
  for (const file of toProcess) {
    const reader = new FileReader();
    reader.onload = () => {
      attachedImages.value.push({ name: file.name, dataUrl: reader.result as string, size: file.size });
    };
    reader.readAsDataURL(file);
  }
}

function removeImage(idx: number) {
  attachedImages.value.splice(idx, 1);
}

function handleDragOver(e: DragEvent) {
  e.preventDefault();
  isDragging.value = true;
}

function handleDragLeave() {
  isDragging.value = false;
}

function handleDrop(e: DragEvent) {
  e.preventDefault();
  isDragging.value = false;
  if (e.dataTransfer?.files) addImageFiles(e.dataTransfer.files);
}

function handlePaste(e: ClipboardEvent) {
  const items = e.clipboardData?.items;
  if (!items) return;
  const imageFiles: File[] = [];
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) imageFiles.push(file);
    }
  }
  if (imageFiles.length) {
    e.preventDefault();
    addImageFiles(imageFiles);
  }
}

function handleVoiceTranscript(text: string, mode: string) {
  if (mode === 'raw') {
    input.value += (input.value ? ' ' : '') + text;
  } else if (mode === 'clean') {
    input.value += (input.value ? ' ' : '') + text.charAt(0).toUpperCase() + text.slice(1);
  } else if (mode === 'expand') {
    input.value += (input.value ? '\n\n' : '') + `Please help me with: ${text}`;
  } else if (mode === 'code') {
    input.value += (input.value ? '\n\n' : '') + `Write code to ${text}`;
  }
  nextTick(() => {
    autoResize();
    textarea.value?.focus();
  });
}

function executeCommand(cmd: SlashCommand) {
  // Clear draft for the current session before the command runs,
  // otherwise the command text (e.g. "/clear") gets persisted and
  // reappears when navigating back to this session.
  const key = chat.sessionId || '_new';
  const drafts = JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}');
  delete drafts[key];
  localStorage.setItem(DRAFT_KEY, JSON.stringify(drafts));
  cmd.action();
  nextTick(() => autoResize());
}

function handleSubmit() {
  // Check if input matches a slash command
  if (showCommandMenu.value && filteredCommands.value.length > 0) {
    const exact = filteredCommands.value.find(c => c.name === input.value.trim());
    if (exact) {
      executeCommand(exact);
      return;
    }
  }

  const trimmed = input.value.trim();
  if ((!trimmed && attachedImages.value.length === 0) || chat.isStreaming || chat.isRateLimited) return;
  // Prepend file mentions as context
  let message = trimmed;
  if (mentionedFiles.value.length > 0) {
    const fileList = mentionedFiles.value.map(f => `@${f}`).join(' ');
    message = `[Context files: ${fileList}]\n\n${trimmed}`;
    mentionedFiles.value = [];
  }
  const images = attachedImages.value.length > 0 ? [...attachedImages.value] : undefined;
  emit('send', message, images);
  input.value = '';
  attachedImages.value = [];
  nextTick(() => autoResize());
}

function handleKeydown(e: KeyboardEvent) {
  // Slash command menu navigation
  if (showCommandMenu.value && filteredCommands.value.length > 0) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedCommandIndex.value = Math.min(selectedCommandIndex.value + 1, filteredCommands.value.length - 1);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedCommandIndex.value = Math.max(selectedCommandIndex.value - 1, 0);
      return;
    }
    if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
      e.preventDefault();
      const cmd = filteredCommands.value[selectedCommandIndex.value];
      if (cmd) {
        if (e.key === 'Tab') {
          input.value = cmd.name;
        } else {
          executeCommand(cmd);
        }
      }
      return;
    }
    if (e.key === 'Escape') {
      input.value = '';
      return;
    }
  }

  // File mention menu navigation
  if (showFileMenu.value) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedFileIndex.value = Math.min(selectedFileIndex.value + 1, fileSuggestions.value.length - 1);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedFileIndex.value = Math.max(selectedFileIndex.value - 1, 0);
      return;
    }
    if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
      e.preventDefault();
      selectFileMention(fileSuggestions.value[selectedFileIndex.value]!);
      return;
    }
    if (e.key === 'Escape') {
      fileSuggestions.value = [];
      return;
    }
  }

  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleSubmit();
  }
}

function autoResize() {
  const el = textarea.value;
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

function formatTokens(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return n.toString();
}

const permissionIcons: Record<string, typeof Zap> = {
  bypassPermissions: Zap,
  acceptEdits: FileEdit,
  plan: ClipboardList,
  default: Shield,
};

const effectivePermissionLabel = computed(() =>
  chat.inPlanMode ? 'Plan Mode' : settings.permissionLabel
);

const effectivePermissionIcon = computed(() =>
  chat.inPlanMode ? ClipboardList : (permissionIcons[settings.permissionMode] || Shield)
);
</script>

<template>
  <div
    class="border-t px-2 py-2 md:px-4 md:py-3 transition-colors duration-500"
    :class="chat.isRateLimited
      ? 'border-red-500/50 bg-red-950/30'
      : 'border-border bg-background'"
  >
    <!-- Status bar: model, permission, context -->
    <TooltipProvider :delay-duration="300">
      <div class="mb-2 flex flex-wrap items-center justify-center gap-1.5 md:gap-2">
        <!-- Model selector -->
        <Select :model-value="settings.model" @update:model-value="(v: any) => { settings.model = v; settings.save(); }">
          <SelectTrigger class="h-6 w-auto gap-1 rounded-md border-none bg-muted/60 px-2 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground">
            <span>{{ settings.modelLabel }}</span>
          </SelectTrigger>
          <SelectContent>
            <SelectItem v-for="m in MODEL_OPTIONS" :key="m.value" :value="m.value">
              <div>
                <div class="text-sm">{{ m.label }}</div>
                <div class="text-xs text-muted-foreground">{{ m.description }}</div>
              </div>
            </SelectItem>
          </SelectContent>
        </Select>

        <!-- Permission mode -->
        <Select :model-value="settings.permissionMode" @update:model-value="(v: any) => { settings.permissionMode = v; settings.save(); }">
          <SelectTrigger
            class="h-6 w-auto gap-1 rounded-md border-none px-2 text-[11px] transition-colors"
            :class="chat.inPlanMode
              ? 'bg-blue-500/15 text-blue-400 hover:bg-blue-500/25'
              : 'bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground'"
          >
            <component :is="effectivePermissionIcon" class="h-3 w-3" />
            <span>{{ effectivePermissionLabel }}</span>
          </SelectTrigger>
          <SelectContent>
            <SelectItem v-for="p in PERMISSION_OPTIONS" :key="p.value" :value="p.value">
              <div class="flex items-center gap-2">
                <span>{{ p.icon }}</span>
                <div>
                  <div class="text-sm">{{ p.label }}</div>
                  <div class="text-xs text-muted-foreground">{{ p.description }}</div>
                </div>
              </div>
            </SelectItem>
          </SelectContent>
        </Select>

        <!-- Thinking mode -->
        <Select :model-value="settings.thinkingMode" @update:model-value="(v: any) => { settings.thinkingMode = v; settings.save(); }">
          <SelectTrigger class="h-6 w-auto gap-1 rounded-md border-none bg-muted/60 px-2 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground">
            <Brain class="h-3 w-3" />
            <span>{{ settings.thinkingLabel }}</span>
          </SelectTrigger>
          <SelectContent>
            <SelectItem v-for="t in THINKING_OPTIONS" :key="t.value" :value="t.value">
              <div>
                <div class="text-sm">{{ t.label }}</div>
                <div class="text-xs text-muted-foreground">{{ t.description }}</div>
              </div>
            </SelectItem>
          </SelectContent>
        </Select>

        <!-- Context usage (progress bar) -->
        <Tooltip>
          <TooltipTrigger as-child>
            <div class="flex items-center gap-1.5 rounded-md bg-muted/50 px-2 py-0.5 cursor-default">
              <span class="text-[10px] tabular-nums text-muted-foreground">
                {{ chat.contextPercent }}%
              </span>
              <div class="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                <div
                  class="h-full rounded-full transition-all duration-300"
                  :class="chat.contextPercent > 80 ? 'bg-destructive' : chat.contextPercent > 50 ? 'bg-yellow-500' : 'bg-primary'"
                  :style="{ width: `${Math.max(chat.contextPercent, 2)}%` }"
                />
              </div>
            </div>
          </TooltipTrigger>
          <TooltipContent>
            <div class="space-y-1.5 text-xs">
              <div class="flex items-center gap-1.5">
                <span class="inline-block h-2 w-2 rounded-full bg-primary" />
                Input: {{ formatTokens(chat.usage.inputTokens) }} tokens
              </div>
              <div class="flex items-center gap-1.5">
                <span class="inline-block h-2 w-2 rounded-full bg-violet-500" />
                Output: {{ formatTokens(chat.usage.outputTokens) }} tokens
              </div>
              <div class="border-t border-border pt-1">Context: {{ chat.contextPercent }}% used</div>
              <div v-if="chat.lastResponseMs">Last: {{ (chat.lastResponseMs / 1000).toFixed(1) }}s</div>
              <div v-if="chat.tokensPerMin > 0">Rate: {{ formatTokens(chat.tokensPerMin) }}/min</div>
              <div v-if="chat.usage.totalCost > 0">Cost: ${{ chat.usage.totalCost.toFixed(4) }}</div>
              <div v-if="chat.sessionDurationMin > 0" class="border-t border-border pt-1 text-muted-foreground">Session: {{ chat.sessionDurationMin }}min</div>
            </div>
          </TooltipContent>
        </Tooltip>

        <!-- Export session -->
        <Tooltip>
          <TooltipTrigger as-child>
            <button
              class="flex h-6 items-center gap-1 rounded-md bg-muted/60 px-2 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              :disabled="chat.messages.length === 0"
              @click="exportSession"
            >
              <Download class="h-3 w-3" />
              <span class="hidden sm:inline">Export</span>
            </button>
          </TooltipTrigger>
          <TooltipContent>Export session as Markdown (Ctrl+Shift+E)</TooltipContent>
        </Tooltip>

        <!-- Auto-scroll toggle -->
        <Tooltip>
          <TooltipTrigger as-child>
            <button
              class="flex h-6 items-center gap-1 rounded-md px-2 text-[11px] transition-colors"
              :class="chat.autoScroll
                ? 'bg-primary/15 text-primary hover:bg-primary/25'
                : 'bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground'"
              @click="chat.autoScroll = !chat.autoScroll"
            >
              <ArrowDownToLine v-if="chat.autoScroll" class="h-3 w-3" />
              <ArrowDownFromLine v-else class="h-3 w-3" />
              <span class="hidden sm:inline">{{ chat.autoScroll ? 'Auto-scroll' : 'Scroll locked' }}</span>
            </button>
          </TooltipTrigger>
          <TooltipContent>{{ chat.autoScroll ? 'Auto-scroll enabled — click to disable' : 'Auto-scroll disabled — click to enable' }}</TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>

    <!-- Slash command menu -->
    <div v-if="showCommandMenu && filteredCommands.length > 0" class="mb-1 overflow-hidden rounded-lg border border-border bg-card shadow-lg">
      <button
        v-for="(cmd, idx) in filteredCommands"
        :key="cmd.name"
        class="flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors"
        :class="idx === selectedCommandIndex ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/50'"
        @mouseenter="selectedCommandIndex = idx"
        @click="executeCommand(cmd)"
      >
        <span class="font-mono text-xs font-medium text-primary">{{ cmd.name }}</span>
        <span class="text-xs">{{ cmd.description }}</span>
      </button>
    </div>

    <!-- File mention menu -->
    <div v-if="showFileMenu" class="mb-1 max-h-40 overflow-y-auto rounded-lg border border-border bg-card shadow-lg">
      <button
        v-for="(file, idx) in fileSuggestions"
        :key="file"
        class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors"
        :class="idx === selectedFileIndex ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/50'"
        @mouseenter="selectedFileIndex = idx"
        @click="selectFileMention(file)"
      >
        <FileText class="h-3 w-3 shrink-0 text-primary" />
        <span class="truncate font-mono text-xs">{{ file }}</span>
      </button>
    </div>

    <!-- Mentioned files badges -->
    <div v-if="mentionedFiles.length > 0" class="mb-1.5 flex flex-wrap gap-1">
      <span
        v-for="file in mentionedFiles"
        :key="file"
        class="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary"
      >
        <FileText class="h-3 w-3" />
        <span class="max-w-40 truncate">{{ file.split('/').pop() }}</span>
        <button class="ml-0.5 rounded-sm p-0.5 hover:bg-primary/20" @click="removeFileMention(file)">
          <X class="h-2.5 w-2.5" />
        </button>
      </span>
    </div>

    <!-- Image previews -->
    <div v-if="attachedImages.length > 0" class="mb-1.5 flex flex-wrap gap-1.5">
      <div v-for="(img, idx) in attachedImages" :key="idx" class="group relative">
        <img :src="img.dataUrl" :alt="img.name" class="h-16 w-16 rounded-md border border-border object-cover" />
        <button
          class="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-destructive-foreground opacity-0 transition-opacity group-hover:opacity-100"
          @click="removeImage(idx)"
        >
          <X class="h-2.5 w-2.5" />
        </button>
      </div>
    </div>

    <!-- Text input -->
    <div
      class="relative rounded-xl border shadow-sm transition-colors"
      :class="chat.isRateLimited
        ? 'border-red-500/40 bg-red-950/20'
        : isDragging
          ? 'border-primary/50 ring-1 ring-primary/20 bg-card'
          : 'border-border bg-card focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/20'"
      @dragover="handleDragOver"
      @dragleave="handleDragLeave"
      @drop="handleDrop"
    >
      <div v-if="isDragging" class="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-primary/5">
        <span class="text-xs font-medium text-primary">Drop images here</span>
      </div>
      <textarea
        ref="textarea"
        v-model="input"
        :placeholder="chat.isRateLimited
          ? `Rate limited — resets in ${rateLimitCountdown}`
          : 'Ask Claude to help with your code... (/ for commands)'"
        :disabled="chat.isRateLimited"
        class="block w-full resize-none overflow-y-auto bg-transparent px-4 py-3 pr-28 text-sm focus:outline-none"
        :class="chat.isRateLimited
          ? 'text-red-400/60 placeholder:text-red-400/50 cursor-not-allowed'
          : 'text-foreground placeholder:text-muted-foreground'"
        rows="1"
        style="min-height: 44px; max-height: 120px"
        @keydown="handleKeydown"
        @input="autoResize"
        @paste="handlePaste"
      />
      <input ref="imageInput" type="file" accept="image/*" multiple class="hidden" @change="(e: Event) => addImageFiles((e.target as HTMLInputElement).files!)" />
      <div class="absolute bottom-2 right-2 flex items-center gap-1">
        <MicButton v-if="!chat.isStreaming && !chat.isRateLimited" @transcript="handleVoiceTranscript" />
        <Button
          v-if="!chat.isStreaming && !chat.isRateLimited && attachedImages.length < MAX_IMAGES"
          variant="ghost"
          size="sm"
          class="h-8 w-8 rounded-lg p-0 text-muted-foreground hover:text-foreground"
          title="Attach image"
          @click="imageInput?.click()"
        >
          <ImagePlus class="h-4 w-4" />
        </Button>
        <Button
          v-if="!chat.isStreaming"
          size="sm"
          class="h-8 w-8 rounded-lg p-0"
          :disabled="chat.isRateLimited || (!input.trim() && attachedImages.length === 0)"
          @click="handleSubmit"
        >
          <Send class="h-4 w-4" />
        </Button>
        <Button
          v-else
          size="sm"
          variant="destructive"
          class="h-8 w-8 rounded-lg p-0"
          @click="emit('abort')"
        >
          <Square class="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
    <p
      class="mt-1 text-center text-[10px] md:mt-1.5 md:text-[11px] transition-colors duration-500"
      :class="chat.isRateLimited ? 'text-red-400/70 font-medium' : 'text-muted-foreground'"
    >
      <template v-if="chat.isRateLimited">
        Rate limit reached — input blocked until reset ({{ rateLimitCountdown }})
      </template>
      <template v-else>
        Enter to send <span class="hidden sm:inline">&middot; Shift+Enter for new line</span> &middot; / for commands &middot; @ for files
      </template>
    </p>
  </div>
</template>
