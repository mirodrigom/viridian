<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { useChatStore } from '@/stores/chat';
import { useAuthStore } from '@/stores/auth';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import ClaudeLogo from '@/components/icons/ClaudeLogo.vue';
import {
  MessageSquare, Plus, ChevronDown, FolderOpen,
  Clock, RefreshCw, Trash2, Search,
} from 'lucide-vue-next';

interface SessionItem {
  id: string;
  title: string;
  projectPath: string;
  projectDir: string;
  messageCount: number;
  lastActive: number;
  isActive: boolean;
}

interface ProjectGroup {
  name: string;
  path: string;
  dir: string;
  sessions: SessionItem[];
  isCurrent: boolean;
}

const chat = useChatStore();
const auth = useAuthStore();
const sessions = ref<SessionItem[]>([]);
const isRefreshing = ref(false);
const searchQuery = ref('');
const visibleCount = ref(5);
const expandedProjects = ref<Set<string>>(new Set());

const emit = defineEmits<{
  newSession: [];
  openToolsSettings: [];
}>();

watch(() => chat.projectPath, (path) => {
  if (path) {
    fetchSessions();
    // Auto-expand current project
    expandedProjects.value.add(path);
  }
}, { immediate: true });

watch(() => chat.isStreaming, (streaming, wasStreaming) => {
  if (wasStreaming && !streaming) {
    fetchSessions();
  }
});

async function fetchSessions() {
  try {
    // Fetch all sessions (no project filter) for multi-project view
    const res = await fetch('/api/sessions', {
      headers: { Authorization: `Bearer ${auth.token}` },
    });
    if (!res.ok) return;
    const data = await res.json();
    sessions.value = data.sessions || [];
  } catch (err) {
    console.error('Failed to fetch sessions:', err);
  }
}

async function refreshSessions() {
  isRefreshing.value = true;
  await fetchSessions();
  isRefreshing.value = false;
}

function startNewSession() {
  chat.clearMessages();
  emit('newSession');
}

async function resumeSession(session: SessionItem) {
  // Don't switch sessions while streaming
  if (chat.isStreaming) return;
  chat.clearMessages();
  chat.sessionId = session.id;
  try {
    const res = await fetch(
      `/api/sessions/${session.id}/messages?projectDir=${encodeURIComponent(session.projectDir)}`,
      { headers: { Authorization: `Bearer ${auth.token}` } },
    );
    if (!res.ok) return;
    const data = await res.json();
    if (data.messages?.length) {
      chat.loadMessages(data.messages);
    }
  } catch (err) {
    console.error('Failed to load session messages:', err);
  }
}

async function deleteSession(session: SessionItem) {
  if (!confirm(`Delete session "${session.title.slice(0, 40)}"?`)) return;
  try {
    await fetch(`/api/sessions/${session.id}?projectDir=${encodeURIComponent(session.projectDir)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${auth.token}` },
    });
    sessions.value = sessions.value.filter(s => s.id !== session.id);
    if (chat.sessionId === session.id) {
      chat.clearMessages();
    }
  } catch (err) {
    console.error('Failed to delete session:', err);
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

function toggleProject(path: string) {
  if (expandedProjects.value.has(path)) {
    expandedProjects.value.delete(path);
  } else {
    expandedProjects.value.add(path);
  }
}

async function deleteProject(group: ProjectGroup) {
  if (!confirm(`Delete all ${group.sessions.length} sessions in "${group.name}"?`)) return;
  try {
    await fetch(`/api/sessions/project/${encodeURIComponent(group.dir)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${auth.token}` },
    });
    sessions.value = sessions.value.filter(s => s.projectDir !== group.dir);
    if (chat.sessionId && group.sessions.some(s => s.id === chat.sessionId)) {
      chat.clearMessages();
    }
  } catch (err) {
    console.error('Failed to delete project:', err);
  }
}

// Group sessions by project
const projectGroups = computed((): ProjectGroup[] => {
  const groups = new Map<string, ProjectGroup>();

  for (const s of sessions.value) {
    const key = s.projectDir;
    if (!groups.has(key)) {
      const name = s.projectPath.split('/').pop() || s.projectPath;
      groups.set(key, {
        name,
        path: s.projectPath,
        dir: s.projectDir,
        sessions: [],
        isCurrent: chat.projectPath
          ? (s.projectPath === chat.projectPath || chat.projectPath.startsWith(s.projectPath))
          : false,
      });
    }
    groups.get(key)!.sessions.push(s);
  }

  // Sort: current project first, then by most recent session
  return Array.from(groups.values()).sort((a, b) => {
    if (a.isCurrent && !b.isCurrent) return -1;
    if (!a.isCurrent && b.isCurrent) return 1;
    const aMax = Math.max(...a.sessions.map(s => s.lastActive));
    const bMax = Math.max(...b.sessions.map(s => s.lastActive));
    return bMax - aMax;
  });
});

// Filter sessions by search
const filteredGroups = computed((): ProjectGroup[] => {
  if (!searchQuery.value.trim()) return projectGroups.value;
  const q = searchQuery.value.toLowerCase();
  return projectGroups.value
    .map(g => ({
      ...g,
      sessions: g.sessions.filter(s => s.title.toLowerCase().includes(q)),
    }))
    .filter(g => g.sessions.length > 0);
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

  sessionsWs.onmessage = (ev) => {
    try {
      const data = JSON.parse(ev.data);
      if (data.type === 'sessions_updated') {
        // Don't refresh during active streaming — prevents flickering/interruption
        if (!chat.isStreaming) {
          fetchSessions();
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
  <div class="flex h-full flex-col border-r border-border bg-card/50">
    <!-- Header -->
    <div class="flex items-center gap-2 border-b border-border px-3 py-2.5">
      <ClaudeLogo :size="20" class="shrink-0 text-primary" />
      <div class="min-w-0 flex-1">
        <p class="truncate text-sm font-semibold text-foreground">Claude Code UI</p>
      </div>
      <Button variant="ghost" size="sm" class="h-7 w-7 shrink-0 p-0" @click="refreshSessions">
        <RefreshCw
          class="h-3.5 w-3.5 transition-transform duration-300"
          :class="{ 'animate-spin': isRefreshing }"
        />
      </Button>
    </div>

    <!-- Search -->
    <div class="border-b border-border px-3 py-1.5">
      <div class="flex items-center gap-1.5 rounded-md border border-input bg-background px-2 py-1">
        <Search class="h-3 w-3 shrink-0 text-muted-foreground" />
        <input
          v-model="searchQuery"
          class="h-5 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
          placeholder="Search sessions..."
        />
      </div>
    </div>

    <!-- Sessions list -->
    <ScrollArea class="flex-1">
      <!-- Current unsaved/active session -->
      <div
        v-if="hasUnsavedSession && !searchQuery"
        class="flex w-full items-start gap-2.5 border-b border-border border-l-2 border-l-primary bg-primary/8 px-3 py-2.5 text-left"
      >
        <MessageSquare class="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-medium text-foreground">{{ currentSessionTitle }}</p>
          <p class="flex items-center gap-1 text-[10px] text-primary/70">
            <Clock class="h-2.5 w-2.5" />
            Active now
          </p>
        </div>
        <span class="mt-0.5 shrink-0 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">
          {{ chat.messages.length }}
        </span>
      </div>

      <!-- Project groups -->
      <div v-for="group in filteredGroups" :key="group.dir" class="group/project">
        <div class="flex w-full items-center gap-2 border-b border-border px-3 py-2 transition-colors hover:bg-accent">
          <button class="flex min-w-0 flex-1 items-center gap-2 text-left" @click="toggleProject(group.path)">
            <FolderOpen class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span class="flex-1 truncate text-xs font-medium" :class="group.isCurrent ? 'text-primary' : 'text-foreground'">
              {{ group.name }}
            </span>
          </button>
          <span class="text-[10px] text-muted-foreground">{{ group.sessions.length }}</span>
          <Button
            variant="ghost"
            size="sm"
            class="hidden h-5 w-5 p-0 text-destructive/70 hover:text-destructive group-hover/project:inline-flex"
            @click="deleteProject(group)"
          >
            <Trash2 class="h-3 w-3" />
          </Button>
          <ChevronDown
            class="h-3 w-3 cursor-pointer text-muted-foreground transition-transform duration-200"
            :class="{ '-rotate-90': !expandedProjects.has(group.path) }"
            @click="toggleProject(group.path)"
          />
        </div>

        <div v-if="expandedProjects.has(group.path)" class="py-0.5">
          <div
            v-for="(session, idx) in group.sessions.slice(0, visibleCount)"
            :key="session.id"
            class="group flex w-full items-start gap-2.5 px-3 py-2 text-left transition-colors hover:bg-accent"
            :class="{
              'bg-accent border-l-2 border-l-primary': session.id === chat.sessionId && !hasUnsavedSession,
              'border-l-2 border-l-transparent': session.id !== chat.sessionId || hasUnsavedSession,
            }"
          >
            <button class="flex min-w-0 flex-1 items-start gap-2.5 text-left" @click="resumeSession(session)">
              <MessageSquare class="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <div class="min-w-0 flex-1">
                <p class="truncate text-xs text-foreground">{{ session.title }}</p>
                <p class="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <Clock class="h-2.5 w-2.5" />
                  {{ formatRelativeTime(session.lastActive) }}
                </p>
              </div>
            </button>
            <div class="flex items-center gap-1">
              <span class="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {{ session.messageCount }}
              </span>
              <Button
                variant="ghost"
                size="sm"
                class="hidden h-5 w-5 p-0 text-destructive/70 hover:text-destructive group-hover:inline-flex"
                @click="deleteSession(session)"
              >
                <Trash2 class="h-3 w-3" />
              </Button>
            </div>
          </div>

          <!-- Load More button -->
          <Button
            v-if="group.sessions.length > visibleCount"
            variant="ghost"
            size="sm"
            class="w-full text-xs text-muted-foreground"
            @click="loadMore"
          >
            Load {{ Math.min(10, group.sessions.length - visibleCount) }} more...
          </Button>
        </div>
      </div>

      <p v-if="filteredGroups.length === 0 && !hasUnsavedSession" class="px-3 py-4 text-center text-xs text-muted-foreground">
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
</template>
