<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { useChatStore } from '@/stores/chat';
import { useFilesStore } from '@/stores/files';
import { apiFetch } from '@/lib/apiFetch';
import { useAuthStore } from '@/stores/auth';
import {
  MessageSquare, FileText, GitBranch, ClipboardList,
  Workflow, Bot, Network, BookOpen, LayoutDashboard, Search,
  Plus, Download, TerminalSquare, Columns2,
} from 'lucide-vue-next';
import type { Component } from 'vue';
import { exportSession } from '@/composables/useKeyboardShortcuts';

const props = defineProps<{ open: boolean }>();
const splitView = defineModel<boolean>('splitView', { default: false });
const emit = defineEmits<{ 'update:open': [val: boolean]; 'toggle-terminal': [] }>();

const router = useRouter();
const chat = useChatStore();
const files = useFilesStore();
const auth = useAuthStore();

const query = ref('');
const selectedIdx = ref(0);
const inputRef = ref<HTMLInputElement | null>(null);

// ─── Sessions ──────────────────────────────────────────────────────
interface SessionItem { id: string; title: string; projectDir: string; lastActive: number }
const sessions = ref<SessionItem[]>([]);

async function fetchSessions() {
  if (!chat.activeProjectDir) return;
  try {
    const params = new URLSearchParams({ project: chat.activeProjectDir });
    const res = await apiFetch(`/api/sessions?${params}`);
    if (res.ok) {
      const data = await res.json();
      sessions.value = (data.sessions || []).slice(0, 20);
    }
  } catch { /* ignore */ }
}

watch(() => props.open, (open) => {
  if (open) {
    query.value = '';
    selectedIdx.value = 0;
    fetchSessions();
    nextTick(() => inputRef.value?.focus());
  }
});

// ─── Result types ──────────────────────────────────────────────────
type ResultGroup = 'sessions' | 'files' | 'actions' | 'tabs';

interface Result {
  id: string;
  group: ResultGroup;
  label: string;
  sublabel?: string;
  icon: Component;
  action: () => void;
}

const TAB_ITEMS: Result[] = [
  { id: 'tab-chat', group: 'tabs', label: 'Chat', icon: MessageSquare, action: () => navigate('project') },
  { id: 'tab-editor', group: 'tabs', label: 'Editor', icon: FileText, action: () => navigate('editor') },
  { id: 'tab-git', group: 'tabs', label: 'Git', icon: GitBranch, action: () => navigate('git') },
  { id: 'tab-tasks', group: 'tabs', label: 'Tasks', icon: ClipboardList, action: () => navigate('tasks') },
  { id: 'tab-graph', group: 'tabs', label: 'Graph', icon: Workflow, action: () => navigate('graph') },
  { id: 'tab-autopilot', group: 'tabs', label: 'Autopilot', icon: Bot, action: () => navigate('autopilot') },
  { id: 'tab-management', group: 'tabs', label: 'Management', icon: LayoutDashboard, action: () => navigate('management') },
  { id: 'tab-diagrams', group: 'tabs', label: 'Diagrams', icon: Network, action: () => navigate('diagrams') },
  { id: 'tab-manuals', group: 'tabs', label: 'Manuals', icon: BookOpen, action: () => navigate('manuals') },
];

const ACTION_ITEMS: Result[] = [
  { id: 'action-new', group: 'actions', label: 'New Session', sublabel: 'Start a fresh conversation', icon: Plus, action: () => { chat.clearMessages(); navigate('project'); } },
  { id: 'action-export', group: 'actions', label: 'Export Session', sublabel: 'Download as Markdown', icon: Download, action: () => { exportSession(); close(); } },
  { id: 'action-terminal', group: 'actions', label: 'Toggle Terminal', sublabel: 'Open/close terminal panel', icon: TerminalSquare, action: () => { close(); emit('toggle-terminal'); } },
  { id: 'action-split', group: 'actions', label: 'Toggle Split View', sublabel: 'Chat + Editor side-by-side (Ctrl+\\)', icon: Columns2, action: () => { splitView.value = !splitView.value; close(); } },
];

function navigate(routeName: string) {
  router.push({ name: routeName });
  close();
}

// ─── Filtered results ───────────────────────────────────────────────
const filteredResults = computed<Result[]>(() => {
  const q = query.value.toLowerCase().trim();

  const sessionResults: Result[] = sessions.value
    .filter(s => !q || s.title.toLowerCase().includes(q))
    .slice(0, 5)
    .map(s => ({
      id: `session-${s.id}`,
      group: 'sessions' as ResultGroup,
      label: s.title || 'Untitled session',
      sublabel: s.id.slice(0, 8) + '…',
      icon: MessageSquare,
      action: () => resumeSession(s),
    }));

  const fileResults: Result[] = files.openFiles
    .filter(f => !q || f.path.toLowerCase().includes(q))
    .slice(0, 5)
    .map(f => {
      const name = f.path.split('/').pop() || f.path;
      return {
        id: `file-${f.path}`,
        group: 'files' as ResultGroup,
        label: name,
        sublabel: f.path,
        icon: FileText,
        action: () => { files.setActiveFile(f.path); navigate('editor'); },
      };
    });

  const tabResults = TAB_ITEMS.filter(t => !q || t.label.toLowerCase().includes(q));
  const actionResults = ACTION_ITEMS.filter(a => !q || a.label.toLowerCase().includes(q) || (a.sublabel?.toLowerCase().includes(q)));

  return [...sessionResults, ...fileResults, ...tabResults, ...actionResults];
});

// Clamp selectedIdx when list changes
watch(filteredResults, (list) => {
  if (selectedIdx.value >= list.length) selectedIdx.value = Math.max(0, list.length - 1);
});

// Reset to 0 whenever query changes
watch(query, () => { selectedIdx.value = 0; });

// ─── Session resume ─────────────────────────────────────────────────
async function resumeSession(s: SessionItem) {
  chat.clearMessages();
  chat.isLoadingSession = true;
  chat.sessionId = s.id;
  chat.claudeSessionId = s.id;
  chat.activeProjectDir = s.projectDir;
  router.replace({ name: 'chat-session', params: { sessionId: s.id } });

  try {
    const res = await apiFetch(
      `/api/sessions/${s.id}/messages?projectDir=${encodeURIComponent(s.projectDir)}&limit=50`,
    );
    if (res.ok) {
      const data = await res.json();
      if (data.sessionProvider) {
        for (const msg of (data.messages || [])) {
          if (msg.role === 'assistant' && !msg.provider) msg.provider = data.sessionProvider;
        }
      }
      chat.loadMessages(data.messages || [], { total: data.total, hasMore: data.hasMore, oldestIndex: data.oldestIndex });
    }
  } catch (err) {
    console.error('CommandPalette: failed to load session', err);
    chat.isLoadingSession = false;
  }
  close();
}

// ─── Keyboard navigation ────────────────────────────────────────────
function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    selectedIdx.value = Math.min(selectedIdx.value + 1, filteredResults.value.length - 1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    selectedIdx.value = Math.max(selectedIdx.value - 1, 0);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const item = filteredResults.value[selectedIdx.value];
    if (item) item.action();
  } else if (e.key === 'Escape') {
    close();
  }
}

function close() {
  emit('update:open', false);
}

// ─── Group labels ────────────────────────────────────────────────────
const GROUP_LABELS: Record<ResultGroup, string> = {
  sessions: 'Sessions',
  files: 'Open files',
  tabs: 'Navigate to',
  actions: 'Actions',
};

function groupLabel(idx: number): string | null {
  const item = filteredResults.value[idx]!;
  if (idx === 0) return GROUP_LABELS[item.group];
  const prev = filteredResults.value[idx - 1]!;
  return item.group !== prev.group ? GROUP_LABELS[item.group] : null;
}
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition duration-150 ease-out"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition duration-100 ease-in"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="open"
        class="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-[15vh] backdrop-blur-sm"
        @mousedown.self="close"
      >
        <div
          class="w-full max-w-xl overflow-hidden rounded-xl border border-border bg-background shadow-2xl"
          @keydown="handleKeydown"
        >
          <!-- Search input -->
          <div class="flex items-center gap-3 border-b border-border px-4 py-3">
            <Search class="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              ref="inputRef"
              v-model="query"
              class="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              placeholder="Search sessions, files, actions..."
            />
            <kbd class="hidden rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground sm:block">Esc</kbd>
          </div>

          <!-- Results list -->
          <div class="max-h-80 overflow-auto py-1">
            <div v-if="filteredResults.length === 0" class="px-4 py-6 text-center text-sm text-muted-foreground">
              No results for "{{ query }}"
            </div>
            <template v-for="(item, idx) in filteredResults" :key="item.id">
              <!-- Group header -->
              <div v-if="groupLabel(idx)" class="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {{ groupLabel(idx) }}
              </div>
              <!-- Result row -->
              <button
                class="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors"
                :class="selectedIdx === idx ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/50'"
                @mouseenter="selectedIdx = idx"
                @click="item.action()"
              >
                <component :is="item.icon" class="h-4 w-4 shrink-0 text-muted-foreground" />
                <div class="min-w-0 flex-1">
                  <span class="block truncate text-sm font-medium">{{ item.label }}</span>
                  <span v-if="item.sublabel" class="block truncate text-xs text-muted-foreground">{{ item.sublabel }}</span>
                </div>
              </button>
            </template>
          </div>

          <!-- Footer shortcuts hint -->
          <div class="flex items-center gap-4 border-t border-border px-4 py-2 text-[10px] text-muted-foreground">
            <span><kbd class="rounded border border-border bg-muted px-1 py-0.5">↑↓</kbd> navigate</span>
            <span><kbd class="rounded border border-border bg-muted px-1 py-0.5">↵</kbd> select</span>
            <span><kbd class="rounded border border-border bg-muted px-1 py-0.5">Esc</kbd> close</span>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
