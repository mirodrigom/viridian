<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, nextTick } from 'vue';
import { useRouter } from 'vue-router';
import { useChatStore } from '@/stores/chat';
import type { GlobalSearchResult } from '@/stores/chat';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Search, Loader2, MessageSquare } from 'lucide-vue-next';

const chat = useChatStore();
const router = useRouter();
const searchInputRef = ref<HTMLInputElement | null>(null);

// Debounce timer
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

watch(() => chat.searchQuery, (q) => {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    chat.searchSessions(q);
  }, 300);
});

watch(() => chat.isSearchOpen, (open) => {
  if (open) {
    nextTick(() => searchInputRef.value?.focus());
  } else {
    // Clear on close
    if (debounceTimer) clearTimeout(debounceTimer);
    chat.searchQuery = '';
    chat.searchResults = [];
  }
});

function handleSelect(result: GlobalSearchResult) {
  chat.isSearchOpen = false;

  // Abort any running stream and load the selected session
  if (chat.isStreaming) chat.abortStream?.();
  chat.clearMessages();
  chat.isLoadingSession = true;
  chat.sessionId = result.sessionId;
  chat.claudeSessionId = result.sessionId;
  chat.activeProjectDir = result.projectDir;

  router.push({
    name: 'chat-session',
    params: { sessionId: result.sessionId },
  });
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: diffDays > 365 ? 'numeric' : undefined });
}

// Ctrl+Shift+F global keyboard shortcut
function handleGlobalKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'f') {
    e.preventDefault();
    chat.isSearchOpen = !chat.isSearchOpen;
  }
  if (e.key === 'Escape' && chat.isSearchOpen) {
    chat.isSearchOpen = false;
  }
}

onMounted(() => document.addEventListener('keydown', handleGlobalKeydown));
onUnmounted(() => {
  document.removeEventListener('keydown', handleGlobalKeydown);
  if (debounceTimer) clearTimeout(debounceTimer);
});
</script>

<template>
  <Dialog :open="chat.isSearchOpen" @update:open="(v) => { if (!v) chat.isSearchOpen = false }">
    <DialogContent class="flex max-h-[70vh] max-w-2xl flex-col gap-0 p-0">
      <DialogHeader class="border-b border-border px-4 pt-4 pb-3">
        <DialogTitle class="flex items-center gap-2 text-sm font-medium">
          <Search class="h-4 w-4 text-muted-foreground" />
          Search all sessions
        </DialogTitle>
        <DialogDescription class="sr-only">
          Search through all chat history across every session
        </DialogDescription>
      </DialogHeader>

      <!-- Search input -->
      <div class="px-4 py-3 border-b border-border">
        <div class="relative">
          <Search class="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref="searchInputRef"
            v-model="chat.searchQuery"
            placeholder="Search messages across all sessions..."
            class="pl-8 pr-8 text-sm"
            autocomplete="off"
          />
          <Loader2
            v-if="chat.isSearching"
            class="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-muted-foreground"
          />
        </div>
      </div>

      <!-- Results -->
      <ScrollArea class="flex-1 overflow-hidden">
        <div class="py-1">
          <!-- Empty state: no query -->
          <div
            v-if="!chat.searchQuery.trim()"
            class="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center text-muted-foreground"
          >
            <Search class="h-8 w-8 opacity-30" />
            <p class="text-sm">Type to search through all your sessions</p>
            <p class="text-xs opacity-60">Searches message content across all projects</p>
          </div>

          <!-- Empty state: no results -->
          <div
            v-else-if="!chat.isSearching && chat.searchResults.length === 0"
            class="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center text-muted-foreground"
          >
            <MessageSquare class="h-8 w-8 opacity-30" />
            <p class="text-sm">No sessions found for "{{ chat.searchQuery }}"</p>
          </div>

          <!-- Result rows -->
          <button
            v-for="result in chat.searchResults"
            :key="result.sessionId"
            class="flex w-full flex-col gap-1 px-4 py-3 text-left transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
            @click="handleSelect(result)"
          >
            <!-- Session title + date -->
            <div class="flex items-center justify-between gap-2">
              <span class="truncate text-sm font-medium text-foreground">{{ result.sessionTitle }}</span>
              <span class="shrink-0 text-xs text-muted-foreground">{{ formatDate(result.timestamp) }}</span>
            </div>
            <!-- Message excerpt -->
            <p class="line-clamp-2 text-xs text-muted-foreground leading-relaxed">
              {{ result.messageExcerpt }}
            </p>
            <!-- Project path -->
            <p class="truncate text-xs text-muted-foreground/60">{{ result.projectPath }}</p>
          </button>
        </div>
      </ScrollArea>

      <!-- Footer hint -->
      <div
        v-if="chat.searchResults.length > 0"
        class="border-t border-border px-4 py-2 text-xs text-muted-foreground"
      >
        {{ chat.searchResults.length }}{{ chat.searchResults.length === 50 ? '+' : '' }} result{{ chat.searchResults.length === 1 ? '' : 's' }} — click to open session
      </div>
    </DialogContent>
  </Dialog>
</template>
