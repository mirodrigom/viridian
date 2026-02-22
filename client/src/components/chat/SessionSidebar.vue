<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { toast } from 'vue-sonner';
import { useChatStore } from '@/stores/chat';
import { apiFetch } from '@/lib/apiFetch';
import { useAuthStore } from '@/stores/auth';
import { useProviderStore } from '@/stores/provider';
import { useRouter } from 'vue-router';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  MessageSquare, Plus,
  Clock, RefreshCw, Trash2, Search, ArrowUpDown, Loader2,
} from 'lucide-vue-next';

interface SessionItem {
  id: string;
  title: string;
  projectPath: string;
  projectDir: string;
  messageCount: number;
  lastActive: number;
  isStreaming?: boolean;
}

const chat = useChatStore();
const auth = useAuthStore();
const providerStore = useProviderStore();
const router = useRouter();
const sessions = ref<SessionItem[]>([]);
const isRefreshing = ref(false);
const searchQuery = ref('');
const visibleCount = ref(5);
const sessionSort = ref<'date' | 'name'>('date');

const emit = defineEmits<{
  newSession: [];
  openToolsSettings: [];
}>();

watch(() => chat.projectPath, (path) => {
  if (path) {
    fetchSessions();
  }
}, { immediate: true });

watch(() => chat.isStreaming, (streaming, wasStreaming) => {
  if (wasStreaming && !streaming) {
    fetchSessions();
  }
});

async function fetchSessions(bustCache = false) {
  try {
    const params = new URLSearchParams();
    if (chat.projectPath) params.set('project', chat.projectPath);
    if (bustCache) params.set('_t', String(Date.now()));
    const res = await apiFetch(`/api/sessions?${params}`);
    if (!res.ok) return;
    const data = await res.json();
    sessions.value = data.sessions || [];
  } catch (err) {
    console.error('Failed to fetch sessions:', err);
  }
}

async function refreshSessions() {
  isRefreshing.value = true;
  await fetchSessions(true);
  isRefreshing.value = false;
}

function startNewSession() {
  chat.clearMessages();
  router.replace({ name: 'project' });
  emit('newSession');
}

async function resumeSession(session: SessionItem) {
  // Abort current stream before switching sessions
  if (chat.isStreaming) chat.abortStream();
  chat.clearMessages();
  chat.isLoadingSession = true;
  chat.sessionId = session.id;
  chat.claudeSessionId = session.id; // JSONL filename = Claude CLI session ID
  chat.activeProjectDir = session.projectDir;

  // Update URL to reflect the active session
  router.replace({
    name: 'chat-session',
    params: { sessionId: session.id },
  });

  try {
    const res = await apiFetch(
      `/api/sessions/${session.id}/messages?projectDir=${encodeURIComponent(session.projectDir)}&limit=50`,
    );
    if (!res.ok) { chat.isLoadingSession = false; return; }
    const data = await res.json();
    if (data.messages?.length) {
      if (data.sessionProvider) {
        const p = providerStore.providers.find(pr => pr.id === data.sessionProvider);
        for (const msg of data.messages) {
          if (msg.role === 'assistant') {
            if (!msg.provider) msg.provider = data.sessionProvider;
            if (!msg.providerName) msg.providerName = p?.name ?? data.sessionProvider;
            if (!msg.providerIcon) msg.providerIcon = p?.icon;
          }
        }
      }
      chat.loadMessages(data.messages, {
        total: data.total,
        hasMore: data.hasMore,
        oldestIndex: data.oldestIndex,
      });
    } else {
      chat.isLoadingSession = false;
    }
    // Restore context usage from session history
    if (data.usage) {
      chat.updateUsage({
        inputTokens: data.usage.inputTokens || 0,
        outputTokens: data.usage.outputTokens || 0,
      });
    }
    // If this session is currently streaming on the server, activate streaming UI
    if (data.isStreaming) {
      chat.startStreaming();
    }
  } catch (err) {
    chat.isLoadingSession = false;
    console.error('Failed to load session messages:', err);
  }
}

const deleteDialogOpen = ref(false);
const sessionToDelete = ref<SessionItem | null>(null);
const isDeleting = ref(false);

function confirmDeleteSession(session: SessionItem) {
  sessionToDelete.value = session;
  deleteDialogOpen.value = true;
}

async function deleteSession() {
  const session = sessionToDelete.value;
  if (!session) return;
  isDeleting.value = true;
  try {
    const res = await apiFetch(`/api/sessions/${session.id}?projectDir=${encodeURIComponent(session.projectDir)}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      toast.error('Failed to delete session');
      return;
    }
    sessions.value = sessions.value.filter(s => s.id !== session.id);
    if (chat.sessionId === session.id) {
      chat.clearMessages();
      router.replace({ name: 'project' });
    }
    deleteDialogOpen.value = false;
  } catch (err) {
    console.warn('[SessionSidebar] deleteSession failed:', err);
    toast.error('Failed to delete session');
  } finally {
    isDeleting.value = false;
  }
}

async function fetchNewMessages(projectDir: string) {
  if (!chat.sessionId) return;
  // Request messages after the ones we already have
  const afterIndex = chat.messages.length + chat.oldestLoadedIndex;
  try {
    const res = await apiFetch(
      `/api/sessions/${chat.sessionId}/messages?projectDir=${encodeURIComponent(projectDir)}&after=${afterIndex}`,
    );
    if (!res.ok) return;
    const data = await res.json();
    if (data.messages?.length) {
      chat.appendMessages(data.messages, { total: data.total });
    }
  } catch (err) {
    console.error('Failed to fetch new messages:', err);
  }
}

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// Sorted + filtered sessions (flat list, single project)
const sortedSessions = computed((): SessionItem[] => {
  const list = [...sessions.value];
  if (sessionSort.value === 'name') {
    list.sort((a, b) => a.title.localeCompare(b.title));
  } else {
    list.sort((a, b) => b.lastActive - a.lastActive);
  }
  return list;
});

const filteredSessions = computed((): SessionItem[] => {
  if (!searchQuery.value.trim()) return sortedSessions.value;
  const q = searchQuery.value.toLowerCase();
  return sortedSessions.value.filter(s => s.title.toLowerCase().includes(q));
});

const hasUnsavedSession = computed(() => {
  if (!chat.messages.length) return false;
  if (chat.sessionId) {
    return !sessions.value.some(s => s.id === chat.sessionId);
  }
  return true;
});

const currentSessionTitle = computed(() => {
  return chat.messages.find(m => m.role === 'user')?.content?.slice(0, 50) || 'New Session';
});

function loadMore() {
  visibleCount.value += 10;
}

// Real-time session updates via WebSocket
let sessionsWs: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

function connectSessionsWs() {
  if (!auth.token) return;
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${protocol}//${location.host}/ws/sessions?token=${encodeURIComponent(auth.token)}`;
  sessionsWs = new WebSocket(url);

  sessionsWs.onopen = () => {
    // Re-fetch sessions on (re)connect — catches data missed during server restarts
    fetchSessions();
  };

  sessionsWs.onmessage = (ev) => {
    try {
      const data = JSON.parse(ev.data);
      if (data.type === 'sessions_updated') {
        // Don't refresh during active streaming — prevents flickering/interruption
        if (!chat.isStreaming) {
          fetchSessions();
        }

        // Live update: if the changed file is the currently viewed session, fetch new messages
        const changed = data.changedFile as {
          projectDir: string;
          sessionId: string;
          eventType: string;
        } | undefined;

        if (changed && changed.eventType === 'change') {
          const match = changed.sessionId === chat.sessionId && changed.projectDir === chat.activeProjectDir;
          if (match && !chat.isStreaming) {
            fetchNewMessages(changed.projectDir);
          }
        }
      }
    } catch { /* ignore parse errors */ }
  };

  sessionsWs.onclose = () => {
    sessionsWs = null;
    reconnectTimer = setTimeout(connectSessionsWs, 5000);
  };

  sessionsWs.onerror = () => {
    sessionsWs?.close();
  };
}

onMounted(() => {
  connectSessionsWs();
});

onUnmounted(() => {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (sessionsWs) {
    sessionsWs.onclose = null;
    sessionsWs.close();
  }
});
</script>

<template>
  <div class="flex h-full flex-col bg-card/50">
    <!-- Header -->
    <div class="flex h-9 items-center justify-between border-b border-border px-3">
      <div class="flex items-center gap-1.5">
        <slot name="header-action" />
        <span class="text-xs font-medium uppercase tracking-wider text-muted-foreground">Sessions</span>
      </div>
      <Button variant="ghost" size="sm" class="h-6 w-6 shrink-0 p-0" @click="refreshSessions">
        <RefreshCw
          class="h-3.5 w-3.5 transition-transform duration-300"
          :class="{ 'animate-spin': isRefreshing }"
        />
      </Button>
    </div>

    <!-- Search + Sort -->
    <div class="border-b border-border px-3 py-1.5">
      <div class="flex items-center gap-1.5 rounded-md border border-input bg-background px-2 py-1">
        <Search class="h-3 w-3 shrink-0 text-muted-foreground" />
        <input
          v-model="searchQuery"
          class="h-5 min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
          placeholder="Search sessions..."
        />
        <Button
          variant="ghost"
          size="sm"
          class="h-5 shrink-0 px-1 text-[10px] text-muted-foreground hover:text-foreground"
          :title="sessionSort === 'date' ? 'Sorted by date — click for name' : 'Sorted by name — click for date'"
          @click="sessionSort = sessionSort === 'date' ? 'name' : 'date'"
        >
          <ArrowUpDown class="mr-0.5 h-2.5 w-2.5" />
          {{ sessionSort === 'date' ? 'Date' : 'Name' }}
        </Button>
      </div>
    </div>

    <!-- Sessions list -->
    <ScrollArea class="min-h-0 flex-1">
      <!-- Current unsaved/active session -->
      <div
        v-if="hasUnsavedSession && !searchQuery"
        class="flex w-full items-start gap-2.5 border-b border-border border-l-2 border-l-primary bg-primary/8 px-3 py-2.5 text-left"
      >
        <Loader2 v-if="chat.isStreaming" class="mt-0.5 h-4 w-4 shrink-0 animate-spin text-primary" />
        <MessageSquare v-else class="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-medium text-foreground">{{ currentSessionTitle }}</p>
          <p class="flex items-center gap-1 text-[10px] text-primary/70">
            <Clock class="h-2.5 w-2.5" />
            {{ chat.isStreaming ? 'Working...' : 'Active now' }}
          </p>
        </div>
        <span class="mt-0.5 shrink-0 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">
          {{ chat.messages.length }}
        </span>
      </div>

      <!-- Sessions list (flat, current project only) -->
      <div
        v-for="session in filteredSessions.slice(0, visibleCount)"
        :key="session.id"
        class="group flex w-full cursor-pointer items-start gap-2.5 px-3 py-2 text-left transition-colors hover:bg-accent"
        :class="{
          'bg-accent/80 border-l-2 border-l-primary shadow-sm': session.id === chat.sessionId && !hasUnsavedSession,
          'border-l-2 border-l-transparent': session.id !== chat.sessionId || hasUnsavedSession,
        }"
        @click="resumeSession(session)"
      >
        <Loader2 v-if="session.isStreaming || (chat.isStreaming && session.id === chat.sessionId)" class="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
        <MessageSquare v-else class="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <div class="min-w-0 flex-1">
          <p class="truncate text-xs text-foreground" :title="session.title">{{ session.title }}</p>
          <p class="flex items-center gap-1 text-[10px] text-muted-foreground">
            <Clock class="h-2.5 w-2.5" />
            {{ (session.isStreaming || (chat.isStreaming && session.id === chat.sessionId)) ? 'Working...' : formatRelativeTime(session.lastActive) }}
          </p>
        </div>
        <div class="flex items-center gap-1">
          <span class="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {{ session.messageCount }}
          </span>
          <Button
            variant="ghost"
            size="sm"
            class="h-5 w-5 p-0 text-destructive/70 hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity inline-flex"
            @click.stop="confirmDeleteSession(session)"
          >
            <Trash2 class="h-3 w-3" />
          </Button>
        </div>
      </div>

      <!-- Load More button -->
      <Button
        v-if="filteredSessions.length > visibleCount"
        variant="ghost"
        size="sm"
        class="w-full text-xs text-muted-foreground"
        @click="loadMore"
      >
        Load {{ Math.min(10, filteredSessions.length - visibleCount) }} more...
      </Button>

      <p v-if="filteredSessions.length === 0 && !hasUnsavedSession" class="px-3 py-4 text-center text-xs text-muted-foreground">
        {{ searchQuery ? 'No matching sessions' : 'No sessions yet' }}
      </p>
    </ScrollArea>

    <!-- Footer actions -->
    <div class="border-t border-border p-2">
      <Button class="w-full gap-2 justify-start" variant="outline" size="sm" @click="startNewSession">
        <Plus class="h-4 w-4" />
        New Session
      </Button>
    </div>
  </div>

  <!-- Delete confirmation modal -->
  <Dialog v-model:open="deleteDialogOpen">
    <DialogContent class="sm:max-w-sm">
      <DialogHeader>
        <DialogTitle>Delete Session</DialogTitle>
        <DialogDescription>
          Are you sure you want to delete "{{ sessionToDelete?.title.slice(0, 40) }}"? This action cannot be undone.
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button variant="outline" @click="deleteDialogOpen = false">Cancel</Button>
        <Button variant="destructive" :disabled="isDeleting" @click="deleteSession">
          {{ isDeleting ? 'Deleting...' : 'Delete' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
