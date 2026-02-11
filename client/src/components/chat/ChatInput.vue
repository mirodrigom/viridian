<script setup lang="ts">
import { ref, computed, nextTick, watch, onMounted } from 'vue';
import { useChatStore } from '@/stores/chat';
import { useAuthStore } from '@/stores/auth';
import { useSettingsStore, MODEL_OPTIONS, PERMISSION_OPTIONS, THINKING_OPTIONS, type ClaudeModel, type PermissionMode, type ThinkingMode } from '@/stores/settings';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Send, Square, Zap, Shield, FileEdit, ClipboardList, Brain, FileText, X,
} from 'lucide-vue-next';

const chat = useChatStore();
const auth = useAuthStore();
const settings = useSettingsStore();
const input = ref('');
const textarea = ref<HTMLTextAreaElement | null>(null);
const selectedCommandIndex = ref(0);
const mentionedFiles = ref<string[]>([]);
const fileSuggestions = ref<string[]>([]);
const selectedFileIndex = ref(0);
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

const emit = defineEmits<{
  send: [message: string];
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
    chat.addMessage({ id: crypto.randomUUID(), role: 'system', content: `Model switched to ${settings.modelLabel}`, timestamp: Date.now() });
    input.value = '';
  }},
  { name: '/think', description: 'Toggle thinking mode (Standard/Think/Think Hard)', action: () => {
    const modes = THINKING_OPTIONS.map(t => t.value);
    const idx = modes.indexOf(settings.thinkingMode);
    settings.thinkingMode = modes[(idx + 1) % modes.length] as ThinkingMode;
    settings.save();
    chat.addMessage({ id: crypto.randomUUID(), role: 'system', content: `Thinking mode: ${settings.thinkingLabel}`, timestamp: Date.now() });
    input.value = '';
  }},
  { name: '/permission', description: 'Toggle permission mode', action: () => {
    const modes = PERMISSION_OPTIONS.map(p => p.value);
    const idx = modes.indexOf(settings.permissionMode);
    settings.permissionMode = modes[(idx + 1) % modes.length] as PermissionMode;
    settings.save();
    chat.addMessage({ id: crypto.randomUUID(), role: 'system', content: `Permission mode: ${settings.permissionLabel}`, timestamp: Date.now() });
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
    chat.addMessage({ id: crypto.randomUUID(), role: 'system', content: lines.join('\n'), timestamp: Date.now() });
    input.value = '';
  }},
  { name: '/cost', description: 'Show token usage and cost', action: () => {
    const lines = [
      `Input tokens: ${formatTokens(chat.usage.inputTokens)}`,
      `Output tokens: ${formatTokens(chat.usage.outputTokens)}`,
      `Context: ${chat.contextPercent}% used`,
      `Total cost: $${chat.usage.totalCost.toFixed(4)}`,
    ];
    chat.addMessage({ id: crypto.randomUUID(), role: 'system', content: lines.join('\n'), timestamp: Date.now() });
    input.value = '';
  }},
  { name: '/help', description: 'Show available commands', action: () => {
    const lines = slashCommands.map(c => `${c.name} — ${c.description}`);
    chat.addMessage({ id: crypto.randomUUID(), role: 'system', content: lines.join('\n'), timestamp: Date.now() });
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
  if (atIdx > 0 && !/\s/.test(text[atIdx - 1])) return null;
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

function executeCommand(cmd: SlashCommand) {
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
  if (!trimmed || chat.isStreaming) return;
  // Prepend file mentions as context
  let message = trimmed;
  if (mentionedFiles.value.length > 0) {
    const fileList = mentionedFiles.value.map(f => `@${f}`).join(' ');
    message = `[Context files: ${fileList}]\n\n${trimmed}`;
    mentionedFiles.value = [];
  }
  emit('send', message);
  input.value = '';
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
      selectFileMention(fileSuggestions.value[selectedFileIndex.value]);
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
  el.style.height = Math.min(el.scrollHeight, 200) + 'px';
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
</script>

<template>
  <div class="border-t border-border bg-background px-2 py-2 md:px-4 md:py-3">
    <!-- Status bar: model, permission, context -->
    <TooltipProvider :delay-duration="300">
      <div class="mb-2 flex flex-wrap items-center justify-center gap-1.5 md:gap-2">
        <!-- Model selector -->
        <Select :model-value="settings.model" @update:model-value="(v: any) => { settings.model = v; settings.save(); }">
          <SelectTrigger class="h-6 w-auto gap-1 rounded-md border-none bg-muted/60 px-2 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground">
            <SelectValue />
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
          <SelectTrigger class="h-6 w-auto gap-1 rounded-md border-none bg-muted/60 px-2 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground">
            <component :is="permissionIcons[settings.permissionMode] || Shield" class="h-3 w-3" />
            <SelectValue />
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
            <SelectValue />
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

        <!-- Context usage -->
        <Tooltip v-if="chat.totalTokens > 0">
          <TooltipTrigger as-child>
            <div class="flex items-center gap-1.5 rounded-md bg-muted/50 px-2 py-0.5">
              <div class="h-1.5 w-14 overflow-hidden rounded-full bg-muted">
                <div
                  class="h-full rounded-full transition-all"
                  :class="chat.contextPercent > 80 ? 'bg-destructive' : chat.contextPercent > 50 ? 'bg-yellow-500' : 'bg-primary'"
                  :style="{ width: `${chat.contextPercent}%` }"
                />
              </div>
              <span class="text-[10px] tabular-nums text-muted-foreground">
                {{ chat.contextPercent }}%
              </span>
            </div>
          </TooltipTrigger>
          <TooltipContent>
            <div class="space-y-1 text-xs">
              <div>Input: {{ formatTokens(chat.usage.inputTokens) }} tokens</div>
              <div>Output: {{ formatTokens(chat.usage.outputTokens) }} tokens</div>
              <div>Context: {{ chat.contextPercent }}% used</div>
              <div v-if="chat.lastResponseMs">Last: {{ (chat.lastResponseMs / 1000).toFixed(1) }}s</div>
              <div v-if="chat.usage.totalCost > 0">Cost: ${{ chat.usage.totalCost.toFixed(4) }}</div>
            </div>
          </TooltipContent>
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

    <!-- Text input -->
    <div class="relative rounded-xl border border-border bg-card shadow-sm transition-colors focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/20">
      <textarea
        ref="textarea"
        v-model="input"
        placeholder="Ask Claude to help with your code... (/ for commands)"
        class="block w-full resize-none bg-transparent px-4 py-3 pr-12 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
        rows="1"
        style="min-height: 44px; max-height: 200px"
        @keydown="handleKeydown"
        @input="autoResize"
      />
      <div class="absolute bottom-2 right-2">
        <Button
          v-if="!chat.isStreaming"
          size="sm"
          class="h-8 w-8 rounded-lg p-0"
          :disabled="!input.trim()"
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
    <p class="mt-1 text-center text-[10px] text-muted-foreground md:mt-1.5 md:text-[11px]">
      Enter to send <span class="hidden sm:inline">&middot; Shift+Enter for new line</span> &middot; / for commands &middot; @ for files
    </p>
  </div>
</template>
