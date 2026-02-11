<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import { useChatStore } from '@/stores/chat';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import ClaudeLogo from '@/components/icons/ClaudeLogo.vue';
import { ArrowDown, Search, X, ChevronUp, ChevronDown } from 'lucide-vue-next';
import MessageBubble from './MessageBubble.vue';

const chat = useChatStore();
const scrollContainer = ref<HTMLElement | null>(null);
const showScrollBtn = ref(false);
const isAutoScroll = ref(true);

// Search state
const showSearch = ref(false);
const searchQuery = ref('');
const searchResultIndex = ref(0);

const emit = defineEmits<{
  approveTool: [requestId: string];
  rejectTool: [requestId: string];
}>();

// Search results: indices of messages matching the query
const searchResults = computed(() => {
  if (!searchQuery.value.trim()) return [];
  const q = searchQuery.value.toLowerCase();
  const results: number[] = [];
  chat.messages.forEach((msg, idx) => {
    if (msg.content.toLowerCase().includes(q)) {
      results.push(idx);
    }
  });
  return results;
});

// Set of message IDs that match search
const matchingIds = computed(() => {
  if (!searchQuery.value.trim()) return new Set<string>();
  return new Set(searchResults.value.map(idx => chat.messages[idx].id));
});

function toggleSearch() {
  showSearch.value = !showSearch.value;
  if (!showSearch.value) {
    searchQuery.value = '';
    searchResultIndex.value = 0;
  }
}

function nextResult() {
  if (searchResults.value.length === 0) return;
  searchResultIndex.value = (searchResultIndex.value + 1) % searchResults.value.length;
  scrollToResult();
}

function prevResult() {
  if (searchResults.value.length === 0) return;
  searchResultIndex.value = (searchResultIndex.value - 1 + searchResults.value.length) % searchResults.value.length;
  scrollToResult();
}

function scrollToResult() {
  const msgIdx = searchResults.value[searchResultIndex.value];
  if (msgIdx === undefined) return;
  const msgId = chat.messages[msgIdx].id;
  nextTick(() => {
    const el = document.getElementById(`msg-${msgId}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}

// Reset result index when query changes
watch(searchQuery, () => {
  searchResultIndex.value = 0;
});

// Ctrl+F to open search
function handleGlobalKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
    e.preventDefault();
    showSearch.value = true;
    nextTick(() => {
      const input = document.querySelector('.chat-search-input') as HTMLInputElement;
      input?.focus();
    });
  }
  if (e.key === 'Escape' && showSearch.value) {
    toggleSearch();
  }
}

import { onMounted, onUnmounted } from 'vue';
onMounted(() => document.addEventListener('keydown', handleGlobalKeydown));
onUnmounted(() => document.removeEventListener('keydown', handleGlobalKeydown));

function getViewport(): HTMLElement | null {
  return scrollContainer.value?.querySelector('[data-radix-scroll-area-viewport]') ?? null;
}

function scrollToBottom() {
  nextTick(() => {
    const viewport = getViewport();
    if (viewport) {
      viewport.scrollTo({ top: viewport.scrollHeight, behavior: 'smooth' });
      isAutoScroll.value = true;
    }
  });
}

function handleScroll() {
  const viewport = getViewport();
  if (!viewport) return;
  const distFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
  showScrollBtn.value = distFromBottom > 100;
  isAutoScroll.value = distFromBottom < 50;
}

// Reset auto-scroll when switching conversations so messages watcher scrolls to bottom
watch(() => chat.sessionId, () => {
  isAutoScroll.value = true;
});

// Auto-scroll on new messages if user is at bottom
watch(() => chat.messages.length, () => {
  if (isAutoScroll.value) scrollToBottom();
});
watch(() => chat.lastMessage?.content, () => {
  if (isAutoScroll.value) {
    nextTick(() => {
      const viewport = getViewport();
      if (viewport) viewport.scrollTop = viewport.scrollHeight;
    });
  }
});

// Attach scroll listener
watch(scrollContainer, (el) => {
  if (el) {
    nextTick(() => {
      const viewport = getViewport();
      viewport?.addEventListener('scroll', handleScroll);
    });
  }
});
</script>

<template>
  <div class="relative h-full">
    <!-- Search bar -->
    <Transition
      enter-active-class="transition duration-150 ease-out"
      enter-from-class="-translate-y-2 opacity-0"
      enter-to-class="translate-y-0 opacity-100"
      leave-active-class="transition duration-100 ease-in"
      leave-from-class="translate-y-0 opacity-100"
      leave-to-class="-translate-y-2 opacity-0"
    >
      <div v-if="showSearch" class="absolute left-0 right-0 top-0 z-20 border-b border-border bg-card/95 px-3 py-1.5 backdrop-blur">
        <div class="flex items-center gap-2">
          <Search class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <input
            v-model="searchQuery"
            class="chat-search-input h-6 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            placeholder="Search messages..."
            @keydown.enter.prevent="nextResult"
            @keydown.escape="toggleSearch"
          />
          <span v-if="searchQuery.trim()" class="text-xs tabular-nums text-muted-foreground">
            {{ searchResults.length > 0 ? `${searchResultIndex + 1}/${searchResults.length}` : '0/0' }}
          </span>
          <Button variant="ghost" size="sm" class="h-6 w-6 p-0" :disabled="searchResults.length === 0" @click="prevResult">
            <ChevronUp class="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="sm" class="h-6 w-6 p-0" :disabled="searchResults.length === 0" @click="nextResult">
            <ChevronDown class="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="sm" class="h-6 w-6 p-0" @click="toggleSearch">
            <X class="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </Transition>

    <ScrollArea ref="scrollContainer" class="h-full">
      <!-- Empty state -->
      <div v-if="chat.messages.length === 0" class="flex h-full items-center justify-center p-8">
        <div class="text-center">
          <div class="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
            <ClaudeLogo :size="32" class="text-primary" />
          </div>
          <h2 class="mb-1 text-lg font-semibold text-foreground">Start a conversation</h2>
          <p class="text-sm text-muted-foreground">
            Ask Claude to help with your code, debug issues, or build features.
          </p>
        </div>
      </div>

      <!-- Messages -->
      <div v-else class="py-2" :class="{ 'pt-12': showSearch }">
        <div
          v-for="(msg, idx) in chat.messages"
          :key="msg.id"
          :id="`msg-${msg.id}`"
        >
          <MessageBubble
            :message="msg"
            :search-query="searchQuery"
            :is-search-match="matchingIds.has(msg.id)"
            :is-active-result="searchResults[searchResultIndex] === idx"
            @approve-tool="(id) => emit('approveTool', id)"
            @reject-tool="(id) => emit('rejectTool', id)"
          />
        </div>
      </div>
    </ScrollArea>

    <!-- Scroll-to-bottom button -->
    <Transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="translate-y-2 opacity-0"
      enter-to-class="translate-y-0 opacity-100"
      leave-active-class="transition duration-150 ease-in"
      leave-from-class="translate-y-0 opacity-100"
      leave-to-class="translate-y-2 opacity-0"
    >
      <Button
        v-if="showScrollBtn"
        size="sm"
        class="absolute bottom-4 right-4 h-9 w-9 rounded-full p-0 shadow-lg"
        @click="scrollToBottom"
      >
        <ArrowDown class="h-4 w-4" />
      </Button>
    </Transition>
  </div>
</template>
