<script setup lang="ts">
import { ref, computed, nextTick, watch, onMounted, onUnmounted } from 'vue';
import { useChatStore } from '@/stores/chat';
import { useAuthStore } from '@/stores/auth';
import { useSettingsStore, PERMISSION_OPTIONS, THINKING_OPTIONS, type PermissionMode, type ThinkingMode } from '@/stores/settings';
import { useProviderStore } from '@/stores/provider';
import { uuid } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Select, SelectContent, SelectItem, SelectTrigger,
} from '@/components/ui/select';
import {
  Send, Square, Zap, Shield, FileEdit, ClipboardList, Brain, FileText, X, ImagePlus,
  ChevronsDown, ChevronsUpDown, FileDown, Sparkles, Bug, Eye, Wrench,
  FileCode, TestTube, Cpu,
} from 'lucide-vue-next';
import MicButton from './MicButton.vue';
import { exportSession } from '@/composables/useKeyboardShortcuts';

const MAX_IMAGES = 5;

const chat = useChatStore();
const auth = useAuthStore();
const settings = useSettingsStore();
const providerStore = useProviderStore();
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

// Message history navigation
const messageHistory = ref<string[]>([]);
const historyIndex = ref(-1);
const currentDraft = ref('');
const isNavigatingHistory = ref(false);

// Message templates
const showTemplateMenu = ref(false);
const selectedTemplateIndex = ref(0);
const templateMenuRef = ref<HTMLElement | null>(null);

// Draft persistence - save/restore typed text per session
const DRAFT_KEY = 'chat-draft';
function getDrafts(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}');
  } catch {
    return {};
  }
}
function saveDraft() {
  const key = chat.sessionId || '_new';
  const drafts = getDrafts();
  if (input.value.trim()) {
    drafts[key] = input.value;
  } else {
    delete drafts[key];
  }
  localStorage.setItem(DRAFT_KEY, JSON.stringify(drafts));
}
function loadDraft() {
  const key = chat.sessionId || '_new';
  const drafts = getDrafts();
  input.value = drafts[key] || '';
  nextTick(() => autoResize());
}

// Message history persistence
const HISTORY_KEY = 'chat-message-history';
const MAX_HISTORY = 50;

function getMessageHistory(): string[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveMessageHistory() {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(messageHistory.value));
}

function addToHistory(message: string) {
  const trimmed = message.trim();
  if (!trimmed) return;

  // Remove duplicate if it exists
  const existing = messageHistory.value.indexOf(trimmed);
  if (existing !== -1) {
    messageHistory.value.splice(existing, 1);
  }

  // Add to the beginning
  messageHistory.value.unshift(trimmed);

  // Keep only the latest MAX_HISTORY entries
  if (messageHistory.value.length > MAX_HISTORY) {
    messageHistory.value = messageHistory.value.slice(0, MAX_HISTORY);
  }

  saveMessageHistory();
}

function loadMessageHistory() {
  messageHistory.value = getMessageHistory();
}

function resetHistoryNavigation() {
  historyIndex.value = -1;
  currentDraft.value = '';
  isNavigatingHistory.value = false;
}

function navigateHistory(direction: 'up' | 'down') {
  if (direction === 'up') {
    if (historyIndex.value === -1) {
      // Starting navigation - save current input as draft
      currentDraft.value = input.value;
      if (messageHistory.value.length === 0) return;
      historyIndex.value = 0;
    } else if (historyIndex.value < messageHistory.value.length - 1) {
      historyIndex.value++;
    } else {
      return; // Already at the oldest message
    }

    input.value = messageHistory.value[historyIndex.value] || '';
    isNavigatingHistory.value = true;
  } else if (direction === 'down') {
    if (historyIndex.value === -1) return; // Not navigating

    if (historyIndex.value > 0) {
      historyIndex.value--;
      input.value = messageHistory.value[historyIndex.value] || '';
    } else {
      // Return to draft
      input.value = currentDraft.value;
      resetHistoryNavigation();
    }
  }

  nextTick(() => {
    autoResize();
    // Move cursor to end
    const el = textarea.value;
    if (el) {
      el.setSelectionRange(el.value.length, el.value.length);
    }
  });
}

// Message Templates System
interface MessageTemplate {
  id: string;
  name: string;
  text: string;
  category: string;
  icon: any;
  shortcut?: string;
}

const DEFAULT_TEMPLATES: MessageTemplate[] = [
  // Debug category
  { id: 'debug-error', name: 'Debug Error', text: 'Help me debug this error:', category: 'Debug', icon: Bug, shortcut: 'Ctrl+1' },
  { id: 'debug-explain', name: 'Explain Issue', text: 'Explain what\'s causing this issue and how to fix it:', category: 'Debug', icon: Bug },
  { id: 'debug-trace', name: 'Trace Problem', text: 'Help me trace through this code to find the problem:', category: 'Debug', icon: Bug },

  // Code Review category
  { id: 'review-improvements', name: 'Review Code', text: 'Review this code for improvements and best practices:', category: 'Review', icon: Eye, shortcut: 'Ctrl+2' },
  { id: 'review-security', name: 'Security Check', text: 'Check this code for security vulnerabilities:', category: 'Review', icon: Shield },
  { id: 'review-performance', name: 'Performance Review', text: 'Analyze this code for performance issues:', category: 'Review', icon: Zap },

  // Refactoring category
  { id: 'refactor-clean', name: 'Clean Refactor', text: 'Refactor this code to be cleaner and more maintainable:', category: 'Refactor', icon: Wrench, shortcut: 'Ctrl+3' },
  { id: 'refactor-optimize', name: 'Optimize Code', text: 'Optimize this code for better performance:', category: 'Refactor', icon: Zap },
  { id: 'refactor-structure', name: 'Restructure', text: 'Help me restructure this code with better architecture:', category: 'Refactor', icon: Wrench },

  // Documentation category
  { id: 'docs-add', name: 'Add Docs', text: 'Add comprehensive documentation to this code:', category: 'Docs', icon: FileCode, shortcut: 'Ctrl+4' },
  { id: 'docs-explain', name: 'Explain Code', text: 'Explain how this code works in detail:', category: 'Docs', icon: FileText },
  { id: 'docs-comments', name: 'Add Comments', text: 'Add helpful comments to this code:', category: 'Docs', icon: FileCode },

  // Testing category
  { id: 'test-unit', name: 'Unit Tests', text: 'Write comprehensive unit tests for this code:', category: 'Testing', icon: TestTube, shortcut: 'Ctrl+5' },
  { id: 'test-integration', name: 'Integration Tests', text: 'Help me write integration tests for this feature:', category: 'Testing', icon: TestTube },
  { id: 'test-edge-cases', name: 'Edge Cases', text: 'What edge cases should I test for this code?', category: 'Testing', icon: TestTube },
];

const TEMPLATES_KEY = 'chat-message-templates';

function getCustomTemplates(): MessageTemplate[] {
  try {
    const stored = localStorage.getItem(TEMPLATES_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveCustomTemplates(templates: MessageTemplate[]) {
  localStorage.setItem(TEMPLATES_KEY, JSON.stringify(templates));
}

const allTemplates = computed(() => {
  const custom = getCustomTemplates();
  return [...DEFAULT_TEMPLATES, ...custom];
});

const templateCategories = computed(() => {
  const categories: Record<string, MessageTemplate[]> = {};
  allTemplates.value.forEach(template => {
    if (!categories[template.category]) {
      categories[template.category] = [];
    }
    categories[template.category].push(template);
  });
  return categories;
});

function insertTemplate(template: MessageTemplate) {
  const textToInsert = template.text + (input.value ? ' ' : '');
  const currentValue = input.value;
  const el = textarea.value;

  if (el) {
    const start = el.selectionStart || 0;
    const end = el.selectionEnd || 0;

    // Insert template text at cursor position
    const newValue = currentValue.slice(0, start) + textToInsert + currentValue.slice(end);
    input.value = newValue;

    // Set cursor position after inserted text
    nextTick(() => {
      const newCursorPos = start + textToInsert.length;
      el.setSelectionRange(newCursorPos, newCursorPos);
      el.focus();
      autoResize();
    });
  } else {
    // Fallback: append to input
    input.value = currentValue + (currentValue ? ' ' : '') + textToInsert;
    nextTick(() => {
      autoResize();
      textarea.value?.focus();
    });
  }

  showTemplateMenu.value = false;
  selectedTemplateIndex.value = 0;

  // Reset history navigation if active
  if (isNavigatingHistory.value) {
    resetHistoryNavigation();
  }
}

function handleTemplateKeydown(e: KeyboardEvent) {
  if (!showTemplateMenu.value) return false;

  const categories = Object.keys(templateCategories.value);
  const allTemplatesFlat = Object.values(templateCategories.value).flat();

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    selectedTemplateIndex.value = Math.min(selectedTemplateIndex.value + 1, allTemplatesFlat.length - 1);
    return true;
  }

  if (e.key === 'ArrowUp') {
    e.preventDefault();
    selectedTemplateIndex.value = Math.max(selectedTemplateIndex.value - 1, 0);
    return true;
  }

  if (e.key === 'Enter' || e.key === 'Tab') {
    e.preventDefault();
    const template = allTemplatesFlat[selectedTemplateIndex.value];
    if (template) {
      insertTemplate(template);
    }
    return true;
  }

  if (e.key === 'Escape') {
    e.preventDefault();
    showTemplateMenu.value = false;
    selectedTemplateIndex.value = 0;
    return true;
  }

  return false;
}

// Handle keyboard shortcuts for templates
function handleTemplateShortcuts(e: KeyboardEvent): boolean {
  if (e.ctrlKey && !e.shiftKey && !e.altKey) {
    const shortcuts: Record<string, string> = {
      '1': 'debug-error',
      '2': 'review-improvements',
      '3': 'refactor-clean',
      '4': 'docs-add',
      '5': 'test-unit',
    };

    const templateId = shortcuts[e.key];
    if (templateId) {
      const template = allTemplates.value.find(t => t.id === templateId);
      if (template) {
        e.preventDefault();
        insertTemplate(template);
        return true;
      }
    }
  }
  return false;
}

// Click outside handler for template menu
function handleClickOutside(event: MouseEvent) {
  if (showTemplateMenu.value && templateMenuRef.value && !templateMenuRef.value.contains(event.target as Node)) {
    showTemplateMenu.value = false;
    selectedTemplateIndex.value = 0;
  }
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside);
});

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside);
});
// Auto-save draft on input change (debounced via watch)
watch(input, () => {
  // Reset history navigation when user types
  if (isNavigatingHistory.value) {
    resetHistoryNavigation();
  }
  // Close template menu when user types (if it's open)
  if (showTemplateMenu.value) {
    showTemplateMenu.value = false;
    selectedTemplateIndex.value = 0;
  }
  saveDraft();
});
// Restore draft when session changes
watch(() => chat.sessionId, loadDraft);
// Watch for pending prompt from other tabs (e.g. Tasks "Send to Chat").
// Uses immediate:true so it picks up prompts set before ChatInput mounts
// (TabsContent unmounts chat when another tab is active).
// Deferred via nextTick to run after loadDraft so it wins over draft restore.
watch(() => chat.pendingPrompt, (prompt) => {
  if (prompt) {
    nextTick(() => {
      input.value = prompt;
      chat.consumePendingPrompt();
      nextTick(() => {
        autoResize();
        textarea.value?.focus();
      });
    });
  }
}, { immediate: true });
onMounted(() => {
  loadDraft();
  loadMessageHistory();
});

// Rate limit countdown — ticks every second to update remaining time display
const rateLimitCountdown = ref('');
let rateLimitInterval: ReturnType<typeof setInterval> | null = null;

function updateRateLimitCountdown() {
  if (!(chat?.isRateLimited ?? false)) {
    rateLimitCountdown.value = '';
    if (rateLimitInterval) {
      clearInterval(rateLimitInterval);
      rateLimitInterval = null;
    }
    return;
  }
  const remaining = chat?.rateLimitRemainingMs ?? 0;
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

watch(() => chat?.isRateLimited ?? false, (limited) => {
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
    const models = providerStore.activeModels.map(m => m.id);
    const idx = models.indexOf(settings.model);
    settings.model = models[(idx + 1) % models.length]!;
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
  if (show) {
    selectedCommandIndex.value = 0;
    // Close template menu when command menu opens
    if (showTemplateMenu.value) {
      showTemplateMenu.value = false;
      selectedTemplateIndex.value = 0;
    }
  }
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

// Close template menu when file menu opens
watch(showFileMenu, (show) => {
  if (show && showTemplateMenu.value) {
    showTemplateMenu.value = false;
    selectedTemplateIndex.value = 0;
  }
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
  const drafts = getDrafts();
  delete drafts[key];
  localStorage.setItem(DRAFT_KEY, JSON.stringify(drafts));

  // Reset history navigation
  resetHistoryNavigation();

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
  if ((!trimmed && attachedImages.value.length === 0) || (chat?.isStreaming ?? false) || (chat?.isRateLimited ?? false) || (chat?.isPlanReviewActive ?? false)) return;

  // Add to message history (only the user's original input, not including file mentions)
  if (trimmed) {
    addToHistory(trimmed);
  }

  // Reset history navigation
  resetHistoryNavigation();

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
  // Handle template shortcuts first
  if (handleTemplateShortcuts(e)) {
    return;
  }

  // Handle template menu navigation
  if (handleTemplateKeydown(e)) {
    return;
  }

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

  // Message history navigation (only when no menus are active)
  if (!showCommandMenu.value && !showFileMenu.value) {
    const el = textarea.value;
    const cursorAtStart = el && el.selectionStart === 0 && el.selectionEnd === 0;
    const cursorAtEnd = el && el.selectionStart === el.value.length && el.selectionEnd === el.value.length;
    const inputEmpty = input.value.trim() === '';

    if (e.key === 'ArrowUp' && (inputEmpty || cursorAtStart || isNavigatingHistory.value)) {
      e.preventDefault();
      navigateHistory('up');
      return;
    }
    if (e.key === 'ArrowDown' && (inputEmpty || cursorAtEnd || isNavigatingHistory.value)) {
      e.preventDefault();
      navigateHistory('down');
      return;
    }
    if (e.key === 'Escape' && isNavigatingHistory.value) {
      e.preventDefault();
      // Return to draft
      input.value = currentDraft.value;
      resetHistoryNavigation();
      nextTick(() => autoResize());
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

// All modes use --primary which is overridden per mode via chat-mode-* CSS classes
const permissionColorClass = 'bg-primary/15 text-primary hover:bg-primary/25';
</script>

<template>
  <div
    class="border-t px-2 py-2 md:px-4 md:py-3 transition-colors duration-500"
    :class="(chat?.isRateLimited ?? false)
      ? 'border-red-500/50 bg-red-950/30'
      : 'border-border bg-background'"
  >
    <!-- Status bar: model, permission, context -->
    <TooltipProvider :delay-duration="300">
      <div class="mb-1 sm:mb-2 flex flex-wrap items-center justify-center gap-0.5 sm:gap-1 md:gap-2">
        <!-- Model selector -->
        <Select :model-value="settings.model" @update:model-value="(v: any) => { settings.model = v; settings.save(); }">
          <SelectTrigger class="h-8 sm:h-6 w-auto gap-1 rounded-md border-none bg-muted/60 px-2 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground shrink-0" :title="settings.modelLabel">
            <Cpu class="h-3 w-3 sm:hidden" />
            <span class="hidden sm:inline">{{ settings.modelLabel }}</span>
          </SelectTrigger>
          <SelectContent>
            <SelectItem v-for="m in providerStore.activeModels" :key="m.id" :value="m.id">
              <div>
                <div class="text-sm">{{ m.label }}</div>
                <div class="text-xs text-muted-foreground">{{ m.description }}</div>
              </div>
            </SelectItem>
          </SelectContent>
        </Select>

        <!-- Permission mode -->
        <Select :model-value="settings.permissionMode" @update:model-value="(v: any) => { settings.permissionMode = v; settings.save(); if (v !== 'plan') chat.inPlanMode = false; }">
          <SelectTrigger
            class="h-8 sm:h-6 w-auto gap-1 rounded-md border-none px-2 text-[11px] transition-colors shrink-0"
            :class="permissionColorClass"
            :title="effectivePermissionLabel"
          >
            <component :is="effectivePermissionIcon" class="h-3 w-3" />
            <span class="hidden sm:inline">{{ effectivePermissionLabel }}</span>
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
          <SelectTrigger class="h-8 sm:h-6 w-auto gap-1 rounded-md border-none bg-muted/60 px-2 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground shrink-0" :title="settings.thinkingLabel">
            <Brain class="h-3 w-3" />
            <span class="hidden sm:inline">{{ settings.thinkingLabel }}</span>
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
            <div class="flex h-8 sm:h-auto items-center gap-1.5 rounded-md bg-muted/50 px-2 py-0.5 cursor-default shrink-0">
              <span class="text-[10px] tabular-nums text-muted-foreground">
                {{ chat.contextPercent }}%
              </span>
              <div class="h-1.5 w-12 sm:w-16 overflow-hidden rounded-full bg-muted">
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
              class="hidden sm:flex h-8 sm:h-6 items-center gap-1 rounded-md bg-muted/60 px-2 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
              :disabled="chat.messages.length === 0"
              @click="exportSession"
            >
              <FileDown class="h-3 w-3" />
              <span class="hidden sm:inline">Export</span>
            </button>
          </TooltipTrigger>
          <TooltipContent>Export session as Markdown (Ctrl+Shift+E)</TooltipContent>
        </Tooltip>

        <!-- Auto-scroll toggle -->
        <Tooltip>
          <TooltipTrigger as-child>
            <button
              class="hidden sm:flex h-8 sm:h-6 items-center gap-1 rounded-md px-2 text-[11px] transition-colors shrink-0"
              :class="chat.autoScroll
                ? 'bg-primary/15 text-primary hover:bg-primary/25'
                : 'bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground'"
              @click="chat.autoScroll = !chat.autoScroll"
            >
              <ChevronsDown v-if="chat.autoScroll" class="h-3 w-3" />
              <ChevronsUpDown v-else class="h-3 w-3" />
              <span class="hidden sm:inline">{{ chat.autoScroll ? 'Auto-scroll' : 'Scroll locked' }}</span>
            </button>
          </TooltipTrigger>
          <TooltipContent>{{ chat.autoScroll ? 'Auto-scroll enabled — click to disable' : 'Auto-scroll disabled — click to enable' }}</TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>

    <!-- Slash command menu -->
    <Transition name="scale-fade">
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
    </Transition>

    <!-- File mention menu -->
    <Transition name="scale-fade">
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
    </Transition>

    <!-- Template menu -->
    <Transition name="scale-fade">
    <div
      v-if="showTemplateMenu"
      ref="templateMenuRef"
      class="mb-1 max-h-48 sm:max-h-80 overflow-y-auto rounded-lg border border-border bg-card shadow-lg"
      @click.stop
    >
      <div v-for="(templates, category) in templateCategories" :key="category" class="border-b border-border last:border-b-0">
        <div class="bg-muted/30 px-3 py-1.5 text-xs font-medium text-muted-foreground">
          {{ category }}
        </div>
        <button
          v-for="(template, idx) in templates"
          :key="template.id"
          class="flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors"
          :class="Object.values(templateCategories).flat().indexOf(template) === selectedTemplateIndex
            ? 'bg-accent text-foreground'
            : 'text-muted-foreground hover:bg-accent/50'"
          @mouseenter="selectedTemplateIndex = Object.values(templateCategories).flat().indexOf(template)"
          @click="insertTemplate(template)"
        >
          <component :is="template.icon" class="h-4 w-4 shrink-0 text-primary" />
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <span class="font-medium text-xs">{{ template.name }}</span>
              <span v-if="template.shortcut" class="ml-auto font-mono text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                {{ template.shortcut }}
              </span>
            </div>
            <div class="text-xs text-muted-foreground truncate mt-0.5">
              {{ template.text }}
            </div>
          </div>
        </button>
      </div>
    </div>
    </Transition>

    <!-- Mentioned files badges -->
    <TransitionGroup
      v-if="mentionedFiles.length > 0"
      tag="div"
      class="mb-1.5 flex flex-wrap gap-1"
      enter-active-class="badge-pop-enter-active"
      enter-from-class="badge-pop-enter-from"
      leave-active-class="badge-pop-leave-active"
      leave-to-class="badge-pop-leave-to"
    >
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
    </TransitionGroup>

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
      :class="(chat?.isRateLimited ?? false)
        ? 'border-red-500/40 bg-red-950/20'
        : isDragging
          ? 'border-primary/50 ring-2 ring-primary/30 bg-card'
          : 'border-border bg-card focus-within:border-primary/60 focus-within:ring-2 focus-within:ring-primary/30'"
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
        :placeholder="(chat?.isPlanReviewActive ?? false)
          ? 'Review the plan in the sidebar to continue...'
          : (chat?.isRateLimited ?? false)
            ? `Rate limited — resets in ${rateLimitCountdown}`
            : isNavigatingHistory
              ? `History ${historyIndex + 1}/${messageHistory.length} (↑/↓ to navigate, Esc to return)`
              : 'Ask Claude to help with your code... (/ for commands)'"
        :disabled="(chat?.isRateLimited ?? false) || (chat?.isPlanReviewActive ?? false)"
        class="block w-full resize-none overflow-y-auto scrollbar-thin bg-transparent px-3 sm:px-4 py-3 pr-20 sm:pr-36 text-sm focus:outline-none"
        :class="(chat?.isPlanReviewActive ?? false)
          ? 'text-primary/40 placeholder:text-primary/50 cursor-not-allowed'
          : (chat?.isRateLimited ?? false)
            ? 'text-red-400/60 placeholder:text-red-400/50 cursor-not-allowed'
            : isNavigatingHistory
              ? 'text-foreground placeholder:text-blue-500/70'
              : 'text-foreground placeholder:text-muted-foreground'"
        rows="1"
        style="min-height: 44px; max-height: 120px"
        @keydown="handleKeydown"
        @input="autoResize"
        @paste="handlePaste"
      />
      <input ref="imageInput" type="file" accept="image/*" multiple class="hidden" @change="(e: Event) => addImageFiles((e.target as HTMLInputElement).files!)" />
      <div class="absolute bottom-2 right-3 flex items-center gap-1">
        <MicButton v-if="!(chat?.isStreaming ?? false) && !(chat?.isRateLimited ?? false) && !(chat?.isPlanReviewActive ?? false)" class="hidden sm:block" @transcript="handleVoiceTranscript" />
        <Button
          v-if="!(chat?.isStreaming ?? false) && !(chat?.isRateLimited ?? false) && !(chat?.isPlanReviewActive ?? false)"
          variant="ghost"
          size="sm"
          class="hidden sm:inline-flex h-8 w-8 rounded-lg p-0 transition-colors"
          :class="showTemplateMenu ? 'bg-primary/15 text-primary hover:bg-primary/25' : 'text-muted-foreground hover:text-foreground'"
          title="Quick templates (Ctrl+1-5 for shortcuts)"
          @click.stop="showTemplateMenu = !showTemplateMenu; selectedTemplateIndex = 0;"
        >
          <Sparkles class="h-4 w-4" />
        </Button>
        <Button
          v-if="!(chat?.isStreaming ?? false) && !(chat?.isRateLimited ?? false) && !(chat?.isPlanReviewActive ?? false) && attachedImages.length < MAX_IMAGES"
          variant="ghost"
          size="sm"
          class="h-8 w-8 rounded-lg p-0 text-muted-foreground hover:text-foreground"
          title="Attach image"
          @click="imageInput?.click()"
        >
          <ImagePlus class="h-4 w-4" />
        </Button>
        <Button
          v-if="!(chat?.isStreaming ?? false)"
          size="sm"
          class="h-8 w-8 rounded-lg p-0"
          :disabled="(chat?.isRateLimited ?? false) || (chat?.isPlanReviewActive ?? false) || (!input.trim() && attachedImages.length === 0)"
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
      :class="(chat?.isPlanReviewActive ?? false)
        ? 'text-primary font-medium'
        : (chat?.isRateLimited ?? false)
          ? 'text-red-400/70 font-medium'
          : 'text-muted-foreground'"
    >
      <template v-if="chat?.isPlanReviewActive ?? false">
        Review the plan in the sidebar before continuing
      </template>
      <template v-else-if="chat?.isRateLimited ?? false">
        Rate limit reached — input blocked until reset ({{ rateLimitCountdown }})
      </template>
      <template v-else>
        Enter to send <span class="hidden sm:inline">&middot; Shift+Enter for new line &middot; / for commands &middot; @ for files</span> <span class="hidden lg:inline">&middot; ↑/↓ for history &middot; ✨ for templates</span>
      </template>
    </p>
  </div>
</template>
