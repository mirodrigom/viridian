<script setup lang="ts">
import { ref, nextTick, watch, onMounted, onUnmounted, computed, inject } from 'vue';
import { useChatStore } from '@/stores/chat';
import { useSettingsStore, THINKING_OPTIONS, type ThinkingMode } from '@/stores/settings';
import { useProviderStore } from '@/stores/provider';
import { useAuthStore } from '@/stores/auth';
import { resolveWsUrl } from '@/lib/serverUrl';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Send, Square, Zap, Shield, FileText, X, ImagePlus, Sparkles, Bug, Eye, Wrench,
  FileCode, TestTube, Paperclip, Plus, Pencil, Trash2, Brain, AlertTriangle, TerminalSquare,
  Loader2,
} from 'lucide-vue-next';
import MicButton from './MicButton.vue';
import ChatStatusBar from './ChatStatusBar.vue';
import PersonaSelector from './PersonaSelector.vue';

// Composables
import { useDraftPersistence } from '@/composables/chat/useDraftPersistence';
import { useMessageHistory } from '@/composables/chat/useMessageHistory';
import { useMessageTemplates } from '@/composables/chat/useMessageTemplates';
import { useSlashCommands } from '@/composables/chat/useSlashCommands';
import { useFileMentions } from '@/composables/chat/useFileMentions';
import { useRateLimitParser } from '@/composables/chat/useRateLimitParser';

const MAX_IMAGES = 5;
const MAX_FILES = 5;
const ACCEPTED_FILE_TYPES = ['application/pdf', 'text/html', 'text/csv'];

const chat = useChatStore();
const settings = useSettingsStore();
const providerStore = useProviderStore();
const authStore = useAuthStore();
const openTerminal = inject<() => void>('openTerminal', () => {});
const openSettingsProviders = inject<() => void>('openSettingsProviders', () => {});
const providerNotReady = computed(() => {
  const p = providerStore.activeProvider;
  if (!p.available) return { type: 'unavailable' as const, name: p.name };
  if (!p.configured || providerStore.failedProviderIds.has(p.id))
    return { type: 'unconfigured' as const, name: p.name, isCli: p.installCommand?.includes('npm') ?? false };
  return null;
});
// --- CLI auth flow ---
type AuthStep = 'idle' | 'connecting' | 'waiting-url' | 'waiting-code' | 'verifying' | 'complete' | 'error';
const authStep = ref<AuthStep>('idle');
const authUrl = ref('');
const authCode = ref('');
const authError = ref('');
const authStatus = ref('');
const authWs = ref<WebSocket | null>(null);
const codeInputRef = ref<HTMLInputElement | null>(null);

function closeAuthWs() {
  if (authWs.value) {
    authWs.value.onmessage = null;
    authWs.value.onerror = null;
    authWs.value.onclose = null;
    authWs.value.close();
    authWs.value = null;
  }
}

function startCliAuth() {
  const token = authStore.token;
  if (!token) return;
  const providerId = providerStore.activeProvider.id;
  closeAuthWs();
  authStep.value = 'connecting';
  authCode.value = '';
  authUrl.value = '';
  authError.value = '';

  const url = resolveWsUrl('/ws/cli-auth', token) + `&provider=${providerId}`;
  const ws = new WebSocket(url);
  authWs.value = ws;

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data as string);
      if (msg.type === 'status') {
        authStatus.value = msg.message as string;
      } else if (msg.type === 'url') {
        authUrl.value = msg.url as string;
        // window.open inside a WS handler may be blocked by popup blocker —
        // the template shows a clickable link as fallback.
        try { window.open(msg.url as string, '_blank'); } catch { /* popup blocked */ }
        authStep.value = 'waiting-code';
        nextTick(() => codeInputRef.value?.focus());
      } else if (msg.type === 'complete') {
        authStep.value = 'complete';
        closeAuthWs();
        setTimeout(() => {
          providerStore.fetchProviders();
          authStep.value = 'idle';
        }, 2000);
      } else if (msg.type === 'error') {
        authError.value = (msg.message as string) || 'Authentication failed.';
        authStep.value = 'error';
        closeAuthWs();
      }
    } catch {
      // ignore parse errors
    }
  };

  ws.onerror = () => {
    authError.value = 'Connection error. Please try again.';
    authStep.value = 'error';
    closeAuthWs();
  };

  ws.onopen = () => {
    authStep.value = 'waiting-url';
  };

  ws.onclose = (e) => {
    if (authStep.value !== 'complete' && authStep.value !== 'error' && authStep.value !== 'idle') {
      authError.value = e.reason || 'Connection closed unexpectedly.';
      authStep.value = 'error';
      authWs.value = null;
    }
  };
}

function submitAuthCode() {
  const input = authCode.value.trim();
  if (!input || !authWs.value) return;
  // User may paste the full callback URL or just a code
  const payload = input.startsWith('http')
    ? { type: 'code', callbackUrl: input }
    : { type: 'code', code: input };
  authWs.value.send(JSON.stringify(payload));
  authStep.value = 'verifying';
}

function handleAuthCodeKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault();
    submitAuthCode();
  }
}

function resetAuth() {
  closeAuthWs();
  authStep.value = 'idle';
  authCode.value = '';
  authUrl.value = '';
  authError.value = '';
}

const input = ref('');
const textarea = ref<HTMLTextAreaElement | null>(null);
const showThinkingMenu = ref(false);
const imageInput = ref<HTMLInputElement | null>(null);
const attachedImages = ref<{ name: string; dataUrl: string; size: number }[]>([]);
const attachedFiles = ref<{ name: string; content: string; type: string; size: number }[]>([]);
const fileInput = ref<HTMLInputElement | null>(null);
const isDragging = ref(false);

// --- Thinking mode selector ---

const thinkingColorMap: Record<ThinkingMode, string> = {
  standard: 'text-muted-foreground',
  think: 'text-blue-400',
  think_hard: 'text-violet-400',
  think_harder: 'text-orange-400',
  ultrathink: 'text-rose-400',
};

const thinkingBgMap: Record<ThinkingMode, string> = {
  standard: '',
  think: 'bg-blue-500/10',
  think_hard: 'bg-violet-500/10',
  think_harder: 'bg-orange-500/10',
  ultrathink: 'bg-rose-500/10',
};

const thinkingDotMap: Record<ThinkingMode, string> = {
  standard: 'bg-muted-foreground',
  think: 'bg-blue-400',
  think_hard: 'bg-violet-400',
  think_harder: 'bg-orange-400',
  ultrathink: 'bg-rose-400',
};

const currentThinkingColor = computed(() => thinkingColorMap[settings.thinkingMode] || 'text-muted-foreground');
const currentThinkingBg = computed(() => thinkingBgMap[settings.thinkingMode] || '');
const isNonStandardThinking = computed(() => settings.thinkingMode !== 'standard');

function savePrefsToSession() {
  const sessionId = chat.claudeSessionId;
  const projectDir = chat.activeProjectDir;
  if (sessionId && projectDir) {
    settings.saveSessionPreferences(sessionId, projectDir);
  }
}

function selectThinkingMode(mode: ThinkingMode) {
  settings.thinkingMode = mode;
  settings.save();
  savePrefsToSession();
  showThinkingMenu.value = false;
}

function cycleThinkingMode() {
  const modes = THINKING_OPTIONS.map(t => t.value);
  const currentIdx = modes.indexOf(settings.thinkingMode);
  const nextIdx = (currentIdx + 1) % modes.length;
  settings.thinkingMode = modes[nextIdx] as ThinkingMode;
  settings.save();
  savePrefsToSession();
}

function autoResize() {
  const el = textarea.value;
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

// --- Composables setup ---

const { saveDraft, loadDraft, clearDraft } = useDraftPersistence(
  input,
  () => chat.sessionId,
  autoResize,
);

const {
  messageHistory,
  historyIndex,
  currentDraft,
  isNavigatingHistory,
  addToHistory,
  loadMessageHistory,
  resetHistoryNavigation,
  navigateHistory,
} = useMessageHistory(input, textarea, autoResize);

const {
  showTemplateMenu,
  selectedTemplateIndex,
  templateMenuRef,
  showTemplateDialog,
  editingTemplate,
  templateForm,
  allTemplates,
  templateCategories,
  customTemplates,
  insertTemplate,
  handleTemplateKeydown,
  handleTemplateShortcuts,
  openNewTemplate,
  openEditTemplate,
  saveTemplate,
  deleteTemplate,
  isCustomTemplate,
  closeTemplateMenu,
} = useMessageTemplates(input, textarea, autoResize, resetHistoryNavigation, isNavigatingHistory);

const {
  selectedCommandIndex,
  slashCommands,
  showCommandMenu,
  filteredCommands,
} = useSlashCommands(input, closeTemplateMenu);

const {
  mentionedFiles,
  fileSuggestions,
  selectedFileIndex,
  mentionQuery,
  showFileMenu,
  selectFileMention,
  removeFileMention,
} = useFileMentions(input, textarea, showCommandMenu, closeTemplateMenu);

const { rateLimitCountdown } = useRateLimitParser();

// Close thinking menu when clicking outside or when template menu opens
watch(showTemplateMenu, (val) => {
  if (val) showThinkingMenu.value = false;
});
watch(showThinkingMenu, (val) => {
  if (val) closeTemplateMenu();
});

// Global click handler to close thinking menu
function handleGlobalClick() {
  showThinkingMenu.value = false;
}
onMounted(() => {
  document.addEventListener('click', handleGlobalClick);
});
onUnmounted(() => {
  document.removeEventListener('click', handleGlobalClick);
  closeAuthWs();
});

// --- Watchers ---

// Auto-save draft on input change (debounced via watch)
watch(input, () => {
  // Reset history navigation when user types
  if (isNavigatingHistory.value) {
    resetHistoryNavigation();
  }
  // Close template menu when user types (if it's open)
  closeTemplateMenu();
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

// --- Emit & event handlers ---

const emit = defineEmits<{
  send: [message: string, images?: { name: string; dataUrl: string }[]];
  abort: [];
  'activate-mic': [];
}>();

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

// Document (PDF/HTML) attachment functions
function addDocumentFiles(files: FileList | File[]) {
  const remaining = MAX_FILES - attachedFiles.value.length;
  const toProcess = Array.from(files)
    .filter(f => ACCEPTED_FILE_TYPES.includes(f.type) || f.name.endsWith('.html') || f.name.endsWith('.htm') || f.name.endsWith('.pdf') || f.name.endsWith('.csv'))
    .slice(0, remaining);

  for (const file of toProcess) {
    if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
      // Read PDF as base64 data URL
      const reader = new FileReader();
      reader.onload = () => {
        attachedFiles.value.push({
          name: file.name,
          content: reader.result as string,
          type: 'pdf',
          size: file.size,
        });
      };
      reader.readAsDataURL(file);
    } else if (file.type === 'text/csv' || file.name.endsWith('.csv')) {
      // Read CSV as text
      const reader = new FileReader();
      reader.onload = () => {
        attachedFiles.value.push({
          name: file.name,
          content: reader.result as string,
          type: 'csv',
          size: file.size,
        });
      };
      reader.readAsText(file);
    } else {
      // Read HTML as text
      const reader = new FileReader();
      reader.onload = () => {
        attachedFiles.value.push({
          name: file.name,
          content: reader.result as string,
          type: 'html',
          size: file.size,
        });
      };
      reader.readAsText(file);
    }
  }
}

function removeFile(idx: number) {
  attachedFiles.value.splice(idx, 1);
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
  if (e.dataTransfer?.files) {
    const files = e.dataTransfer.files;
    // Separate images from documents
    const imageFiles: File[] = [];
    const docFiles: File[] = [];
    for (const file of Array.from(files)) {
      if (file.type.startsWith('image/')) {
        imageFiles.push(file);
      } else if (ACCEPTED_FILE_TYPES.includes(file.type) || file.name.endsWith('.html') || file.name.endsWith('.htm') || file.name.endsWith('.pdf') || file.name.endsWith('.csv')) {
        docFiles.push(file);
      }
    }
    if (imageFiles.length) addImageFiles(imageFiles);
    if (docFiles.length) addDocumentFiles(docFiles);
  }
}

function handlePaste(e: ClipboardEvent) {
  const items = e.clipboardData?.items;
  if (!items) return;
  const imageFiles: File[] = [];
  const docFiles: File[] = [];
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) imageFiles.push(file);
    } else if (ACCEPTED_FILE_TYPES.includes(item.type) || item.type === 'text/csv') {
      const file = item.getAsFile();
      if (file) docFiles.push(file);
    }
  }
  if (imageFiles.length || docFiles.length) {
    e.preventDefault();
    if (imageFiles.length) addImageFiles(imageFiles);
    if (docFiles.length) addDocumentFiles(docFiles);
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

defineExpose({ handleVoiceTranscript });

function executeCommand(cmd: { action: () => void }) {
  // Clear draft for the current session before the command runs,
  // otherwise the command text (e.g. "/clear") gets persisted and
  // reappears when navigating back to this session.
  clearDraft();

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

  // Prepend attached document contents as context
  if (attachedFiles.value.length > 0) {
    const fileContextParts: string[] = [];
    const pdfDataUrls: { name: string; dataUrl: string }[] = [];
    for (const file of attachedFiles.value) {
      if (file.type === 'csv') {
        fileContextParts.push(`--- Attached CSV file: ${file.name} ---\n\`\`\`csv\n${file.content}\n\`\`\`\n--- End of ${file.name} ---`);
      } else if (file.type === 'html') {
        fileContextParts.push(`--- Attached HTML file: ${file.name} ---\n${file.content}\n--- End of ${file.name} ---`);
      } else if (file.type === 'pdf') {
        // PDF files: send as image-like attachments (base64 data URLs) so the server can save them as temp files
        pdfDataUrls.push({ name: file.name, dataUrl: file.content });
      }
    }
    if (fileContextParts.length > 0) {
      message = fileContextParts.join('\n\n') + '\n\n' + message;
    }
    // Add PDF data URLs to images array so they get sent to the server the same way
    if (pdfDataUrls.length > 0) {
      for (const pdf of pdfDataUrls) {
        attachedImages.value.push({ name: pdf.name, dataUrl: pdf.dataUrl, size: 0 });
      }
    }
  }

  const images = attachedImages.value.length > 0 ? [...attachedImages.value] : undefined;
  emit('send', message, images);
  input.value = '';
  attachedImages.value = [];
  attachedFiles.value = [];
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

</script>

<template>
  <div
    class="border-t px-2 py-2 md:px-4 md:py-3 transition-colors duration-500"
    :class="(chat?.isRateLimited ?? false)
      ? 'border-red-500/50 bg-red-950/30'
      : 'border-border bg-background'"
  >
    <ChatStatusBar />

    <!-- Provider not configured banner -->
    <div v-if="providerNotReady">

      <!-- CLI auth: idle — Sign in prompt -->
      <div
        v-if="providerNotReady.isCli && authStep === 'idle'"
        class="mb-2 flex items-center gap-3 rounded-lg border border-amber-600/40 bg-amber-50 dark:bg-amber-500/10 px-3 py-2"
      >
        <AlertTriangle class="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500" />
        <p class="flex-1 text-xs text-amber-800 dark:text-amber-200">
          <span class="font-medium">{{ providerNotReady.name }}</span> is not authenticated.
        </p>
        <button
          class="shrink-0 inline-flex items-center gap-1.5 rounded-md bg-green-600/80 px-2.5 py-1 text-xs font-medium text-white hover:bg-green-600 transition-colors"
          @click="startCliAuth"
        >
          Sign in
        </button>
      </div>

      <!-- CLI auth: connecting / waiting-url — spinner -->
      <div
        v-else-if="providerNotReady.isCli && (authStep === 'connecting' || authStep === 'waiting-url')"
        class="mb-2 flex items-center gap-3 rounded-lg border border-amber-600/40 bg-amber-50 dark:bg-amber-500/10 px-3 py-2"
      >
        <Loader2 class="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400 animate-spin" />
        <p class="flex-1 text-xs text-amber-800 dark:text-amber-200 truncate">{{ authStatus || `Setting up ${providerNotReady.name}...` }}</p>
      </div>

      <!-- CLI auth: waiting-code — paste code -->
      <div
        v-else-if="providerNotReady.isCli && authStep === 'waiting-code'"
        class="mb-2 flex flex-col gap-1.5 rounded-lg border border-amber-600/40 bg-amber-50 dark:bg-amber-500/10 px-3 py-2"
      >
        <p v-if="authUrl" class="text-xs text-amber-700 dark:text-amber-300">
          If the browser didn't open, <a :href="authUrl" target="_blank" rel="noopener" class="underline font-medium hover:text-amber-900 dark:hover:text-amber-100">click here to sign in</a>.
        </p>
        <p class="text-xs text-amber-700 dark:text-amber-300">
          After signing in, copy the full URL from the error page and paste it below.
        </p>
        <div class="flex items-center gap-2">
        <p class="shrink-0 text-xs text-amber-800 dark:text-amber-200 whitespace-nowrap">Callback URL:</p>
        <input
          ref="codeInputRef"
          v-model="authCode"
          type="text"
          placeholder="Paste the localhost:xxxxx/callback?code=... URL"
          class="flex-1 min-w-0 rounded-md border border-amber-600/30 dark:border-amber-500/30 bg-white dark:bg-amber-500/10 px-2 py-1 text-xs font-mono text-amber-900 dark:text-amber-100 placeholder:text-amber-400 dark:placeholder:text-amber-500/60 focus:outline-none focus:ring-1 focus:ring-amber-500/50"
          @keydown="handleAuthCodeKeydown"
        />
        <button
          class="shrink-0 inline-flex items-center gap-1.5 rounded-md bg-green-600/80 px-2.5 py-1 text-xs font-medium text-white hover:bg-green-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          :disabled="!authCode.trim()"
          @click="submitAuthCode"
        >
          Continue
        </button>
        </div>
      </div>

      <!-- CLI auth: verifying — spinner -->
      <div
        v-else-if="providerNotReady.isCli && authStep === 'verifying'"
        class="mb-2 flex items-center gap-3 rounded-lg border border-amber-600/40 bg-amber-50 dark:bg-amber-500/10 px-3 py-2"
      >
        <Loader2 class="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400 animate-spin" />
        <p class="flex-1 text-xs text-amber-800 dark:text-amber-200">Verifying...</p>
      </div>

      <!-- CLI auth: complete -->
      <div
        v-else-if="providerNotReady.isCli && authStep === 'complete'"
        class="mb-2 flex items-center gap-3 rounded-lg border border-green-600/40 bg-green-50 dark:bg-green-500/10 px-3 py-2"
      >
        <p class="flex-1 text-xs font-medium text-green-700 dark:text-green-400">Authenticated!</p>
      </div>

      <!-- CLI auth: error -->
      <div
        v-else-if="providerNotReady.isCli && authStep === 'error'"
        class="mb-2 flex items-center gap-3 rounded-lg border border-red-600/40 bg-red-50 dark:bg-red-500/10 px-3 py-2"
      >
        <AlertTriangle class="h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
        <p class="flex-1 text-xs text-red-700 dark:text-red-300">{{ authError || 'Authentication failed.' }}</p>
        <button
          class="shrink-0 rounded-md bg-red-200 dark:bg-red-500/20 px-2.5 py-1 text-xs font-medium text-red-800 dark:text-red-300 hover:bg-red-300 dark:hover:bg-red-500/30 transition-colors"
          @click="resetAuth"
        >
          Try again
        </button>
      </div>

      <!-- Non-CLI provider: settings prompt -->
      <div
        v-else-if="!providerNotReady.isCli"
        class="mb-2 flex items-center gap-3 rounded-lg border border-amber-600/40 bg-amber-50 dark:bg-amber-500/10 px-3 py-2"
      >
        <AlertTriangle class="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500" />
        <p class="flex-1 text-xs text-amber-800 dark:text-amber-200">
          <span class="font-medium">{{ providerNotReady.name }}</span> is not configured. Configure your API key in settings.
        </p>
        <button
          class="shrink-0 rounded-md bg-amber-200 dark:bg-amber-500/20 px-2.5 py-1 text-xs font-medium text-amber-800 dark:text-amber-300 hover:bg-amber-300 dark:hover:bg-amber-500/30 transition-colors"
          @click="openSettingsProviders"
        >
          Settings
        </button>
      </div>

    </div>

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
        <div
          v-for="(template, idx) in templates"
          :key="template.id"
          class="group flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors"
          :class="Object.values(templateCategories).flat().indexOf(template) === selectedTemplateIndex
            ? 'bg-accent text-foreground'
            : 'text-muted-foreground hover:bg-accent/50'"
          @mouseenter="selectedTemplateIndex = Object.values(templateCategories).flat().indexOf(template)"
        >
          <button class="flex flex-1 items-center gap-3 min-w-0" @click="insertTemplate(template)">
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
          <div v-if="isCustomTemplate(template)" class="flex shrink-0 gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <button class="rounded p-1 hover:bg-muted" title="Edit" @click.stop="openEditTemplate(template)">
              <Pencil class="h-3 w-3" />
            </button>
            <button class="rounded p-1 hover:bg-destructive/20 hover:text-destructive" title="Delete" @click.stop="deleteTemplate(template.id)">
              <Trash2 class="h-3 w-3" />
            </button>
          </div>
        </div>
      </div>
      <button
        class="flex w-full items-center gap-2 px-3 py-2 text-xs font-medium text-primary hover:bg-accent/50 transition-colors"
        @click="openNewTemplate"
      >
        <Plus class="h-3.5 w-3.5" />
        New Template
      </button>
    </div>
    </Transition>

    <!-- Template management dialog -->
    <Dialog v-model:open="showTemplateDialog">
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{{ editingTemplate ? 'Edit Template' : 'New Template' }}</DialogTitle>
          <DialogDescription>
            {{ editingTemplate ? 'Modify your custom prompt template.' : 'Create a reusable prompt template.' }}
          </DialogDescription>
        </DialogHeader>
        <form class="space-y-3" @submit.prevent="saveTemplate">
          <div>
            <label class="text-xs font-medium text-muted-foreground">Name</label>
            <Input v-model="templateForm.name" placeholder="e.g. API Endpoint" class="mt-1" />
          </div>
          <div>
            <label class="text-xs font-medium text-muted-foreground">Category</label>
            <Input v-model="templateForm.category" placeholder="e.g. Custom" class="mt-1" />
          </div>
          <div>
            <label class="text-xs font-medium text-muted-foreground">Prompt text</label>
            <textarea
              v-model="templateForm.text"
              placeholder="e.g. Create a REST API endpoint that..."
              class="mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              rows="3"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" @click="showTemplateDialog = false">Cancel</Button>
            <Button type="submit" :disabled="!templateForm.name.trim() || !templateForm.text.trim()">
              {{ editingTemplate ? 'Save' : 'Create' }}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>

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

    <!-- Document file previews -->
    <div v-if="attachedFiles.length > 0" class="mb-1.5 flex flex-wrap gap-1.5">
      <div
        v-for="(file, idx) in attachedFiles"
        :key="'file-' + idx"
        class="group relative inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/50 px-2.5 py-1.5"
      >
        <FileText v-if="file.type === 'pdf'" class="h-4 w-4 shrink-0 text-red-500" />
        <FileText v-else-if="file.type === 'csv'" class="h-4 w-4 shrink-0 text-green-500" />
        <FileCode v-else class="h-4 w-4 shrink-0 text-orange-500" />
        <span class="max-w-32 truncate text-xs font-medium text-foreground">{{ file.name }}</span>
        <span class="text-[10px] text-muted-foreground">({{ (file.size / 1024).toFixed(0) }}KB)</span>
        <button
          class="ml-0.5 flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-destructive hover:text-destructive-foreground"
          @click="removeFile(idx)"
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
        <span class="text-xs font-medium text-primary">Drop images, PDFs, HTML, or CSV files here</span>
      </div>
      <textarea
        ref="textarea"
        v-model="input"
        :placeholder="!!providerNotReady
          ? 'Sign in to start chatting...'
          : (chat?.isPlanReviewActive ?? false)
            ? 'Review the plan in the sidebar to continue...'
            : (chat?.isRateLimited ?? false)
              ? `Rate limited — resets in ${rateLimitCountdown}`
              : isNavigatingHistory
                ? `History ${historyIndex + 1}/${messageHistory.length} (↑/↓ to navigate, Esc to return)`
                : 'Ask Claude to help with your code... (/ for commands)'"
        :disabled="!!providerNotReady || (chat?.isRateLimited ?? false) || (chat?.isPlanReviewActive ?? false)"
        class="block w-full resize-none overflow-y-auto scrollbar-thin bg-transparent px-3 sm:px-4 pt-3 pb-10 pr-20 sm:pr-36 text-sm focus:outline-none"
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
      <input ref="fileInput" type="file" accept=".pdf,.html,.htm,.csv,application/pdf,text/html,text/csv" multiple class="hidden" @change="(e: Event) => addDocumentFiles((e.target as HTMLInputElement).files!)" />
      <div class="absolute bottom-2 right-3 flex items-center gap-1">
        <MicButton v-if="!(chat?.isStreaming ?? false) && !(chat?.isRateLimited ?? false) && !(chat?.isPlanReviewActive ?? false)" @activate="emit('activate-mic')" />
        <!-- Persona selector -->
        <PersonaSelector
          v-if="!(chat?.isStreaming ?? false) && !(chat?.isRateLimited ?? false) && !(chat?.isPlanReviewActive ?? false)"
          class="hidden sm:block"
        />
        <Button
          v-if="!(chat?.isStreaming ?? false)"
          size="sm"
          class="h-10 w-10 sm:h-8 sm:w-8 rounded-lg p-0"
          :disabled="!!providerNotReady || (chat?.isRateLimited ?? false) || (chat?.isPlanReviewActive ?? false) || (!input.trim() && attachedImages.length === 0 && attachedFiles.length === 0)"
          @click="handleSubmit"
        >
          <Send class="h-5 w-5 sm:h-4 sm:w-4" />
        </Button>
        <Button
          v-else
          size="sm"
          variant="destructive"
          class="h-10 w-10 sm:h-8 sm:w-8 rounded-lg p-0"
          @click="emit('abort')"
        >
          <Square class="h-4 w-4 sm:h-3.5 sm:w-3.5" />
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
