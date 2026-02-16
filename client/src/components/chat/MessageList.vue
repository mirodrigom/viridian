<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import { useChatStore } from '@/stores/chat';
import { useAuthStore } from '@/stores/auth';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import ClaudeLogo from '@/components/icons/ClaudeLogo.vue';
import { ArrowDown, Search, X, ChevronUp, ChevronDown, Loader2, CheckCircle2 } from 'lucide-vue-next';
import MessageBubble from './MessageBubble.vue';
import { playResponseCompleteSound } from '@/composables/useNotificationSound';

const chat = useChatStore();
const auth = useAuthStore();
const scrollContainer = ref<any>(null);
const showScrollBtn = ref(false);
const isLoadingSession = ref(false); // Prevents handleScroll from overriding autoScroll during session load
const isProgrammaticScroll = ref(false); // Prevents handleScroll from disabling autoScroll during programmatic scrolls

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
  return new Set(searchResults.value.map(idx => chat.messages[idx]!.id));
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
  const msgId = chat.messages[msgIdx]!.id;
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

// Response-complete notification: shows a divider + plays a sound when Claude finishes
const showResponseComplete = ref(false);
const responseCompleteTime = ref('');
let hadStreaming = false;
let streamEndedWithPendingInput = false;

const hasPendingQuestion = computed(() =>
  chat.messages.some(m => m.toolUse?.tool === 'AskUserQuestion' && m.toolUse.status === 'pending')
);

// Suppress completion when Claude is waiting for user input (question or plan review)
const isAwaitingUserInput = computed(() =>
  hasPendingQuestion.value || chat.isPlanReviewActive
);

function showCompletion() {
  showResponseComplete.value = true;
  responseCompleteTime.value = new Date().toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
  playResponseCompleteSound();
}

watch(() => chat.isStreaming, (streaming) => {
  if (streaming) {
    hadStreaming = true;
    streamEndedWithPendingInput = false;
    showResponseComplete.value = false;
  } else if (hadStreaming) {
    hadStreaming = false;
    if (isAwaitingUserInput.value) {
      streamEndedWithPendingInput = true;
    } else {
      showCompletion();
    }
  }
});

watch(isAwaitingUserInput, (awaiting) => {
  if (!awaiting && streamEndedWithPendingInput) {
    streamEndedWithPendingInput = false;
    // Delay slightly: if the user approved a plan or answered a question,
    // a new stream_start may arrive shortly after — avoid a spurious chime.
    setTimeout(() => {
      if (!chat.isStreaming) {
        showCompletion();
      }
    }, 500);
  }
});

// Historical sessions: show a static "Response complete" divider for sessions loaded from disk
const showHistoricalComplete = computed(() =>
  chat.sessionLoadedIdle && !chat.isStreaming && !isAwaitingUserInput.value && !showResponseComplete.value
);

const historicalCompleteTime = computed(() => {
  if (!chat.sessionLoadedIdle) return '';
  const lastAssistant = [...chat.messages].reverse().find(m => m.role === 'assistant');
  if (!lastAssistant) return '';
  return new Date(lastAssistant.timestamp).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
});

// Timeline grouping: consecutive Claude-side messages (assistant, tool, system) share one header
function isClaudeSide(role: string): boolean {
  return role === 'assistant' || role === 'system';
}

function isGroupStart(idx: number): boolean {
  if (idx === 0) return true;
  const curr = chat.messages[idx]!;
  const prev = chat.messages[idx - 1]!;
  if (curr.role === 'user') return true;
  return !(isClaudeSide(curr.role) && isClaudeSide(prev.role));
}

function getViewport(): HTMLElement | null {
  const raw = scrollContainer.value;
  if (!raw) return null;
  // ScrollArea is a Vue component — access its root DOM element via $el
  const el: HTMLElement | undefined = raw.$el ?? raw;
  return el?.querySelector?.('[data-radix-scroll-area-viewport]') ?? null;
}

function forceScrollToEnd() {
  // Primary: scroll anchor at the very bottom of content (below energy beam / divider)
  const anchor = document.getElementById('scroll-anchor');
  if (anchor) {
    anchor.scrollIntoView({ block: 'end' });
    return;
  }
  // Fallback: viewport scrollTop
  const viewport = getViewport();
  if (viewport) {
    viewport.scrollTop = viewport.scrollHeight;
  }
}

function scrollToBottom(instant = false) {
  if (instant) {
    // Session load: multiple attempts while DOM renders
    isLoadingSession.value = true;
    nextTick(forceScrollToEnd);
    setTimeout(forceScrollToEnd, 100);
    setTimeout(forceScrollToEnd, 300);
    setTimeout(() => {
      forceScrollToEnd();
      chat.autoScroll = true;
      isLoadingSession.value = false;
    }, 600);
  } else {
    // Toggle / button click: scroll to bottom
    isProgrammaticScroll.value = true;
    nextTick(() => {
      requestAnimationFrame(() => {
        forceScrollToEnd();
        chat.autoScroll = true;
        // Release after the scroll event has been processed
        requestAnimationFrame(() => {
          isProgrammaticScroll.value = false;
        });
      });
    });
  }
}

function handleScroll() {
  const viewport = getViewport();
  if (!viewport) return;
  const distFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
  showScrollBtn.value = distFromBottom > 100;
  // Don't override autoScroll during session load or programmatic scrolls
  if (!isLoadingSession.value && !isProgrammaticScroll.value) {
    // Use a larger threshold during streaming to prevent rapid content additions
    // from accidentally disabling autoScroll before the scroll catches up
    const threshold = chat.isStreaming ? 150 : 50;
    if (distFromBottom < threshold) {
      chat.autoScroll = true;
    } else if (!chat.isStreaming) {
      // Only disable autoScroll from user scroll when NOT streaming
      // During streaming, only an explicit scroll far from bottom should disable it
      chat.autoScroll = false;
    } else if (distFromBottom > 500) {
      // During streaming, user has intentionally scrolled far up
      chat.autoScroll = false;
    }
  }

  // Trigger load-more when near top
  if (viewport.scrollTop < 100 && chat.hasMoreMessages && !chat.isLoadingMore) {
    loadOlderMessages();
  }
}

async function loadOlderMessages() {
  if (chat.isLoadingMore || !chat.hasMoreMessages || !chat.sessionId || !chat.activeProjectDir) return;
  chat.isLoadingMore = true;

  const viewport = getViewport();
  const oldScrollHeight = viewport?.scrollHeight || 0;

  try {
    const res = await fetch(
      `/api/sessions/${chat.sessionId}/messages?projectDir=${encodeURIComponent(chat.activeProjectDir)}&limit=50&before=${chat.oldestLoadedIndex}`,
      { headers: { Authorization: `Bearer ${auth.token}` } },
    );
    if (!res.ok) return;
    const data = await res.json();

    if (data.messages?.length) {
      chat.prependMessages(data.messages, {
        hasMore: data.hasMore,
        oldestIndex: data.oldestIndex,
      });

      // Preserve scroll position after prepend
      nextTick(() => {
        requestAnimationFrame(() => {
          if (viewport) {
            const newScrollHeight = viewport.scrollHeight;
            viewport.scrollTop = newScrollHeight - oldScrollHeight;
          }
        });
      });
    }
  } catch (err) {
    console.error('Failed to load older messages:', err);
  } finally {
    chat.isLoadingMore = false;
  }
}

// Scroll to bottom when a session is loaded (triggered explicitly by store)
watch(() => chat.scrollToBottomRequest, () => {
  chat.autoScroll = true;
  scrollToBottom(true);
});

// When autoScroll is toggled on (e.g. clicking the button), immediately scroll to bottom
watch(() => chat.autoScroll, (enabled) => {
  if (enabled) {
    scrollToBottom(false);
  }
});

// Auto-scroll on new messages during streaming (single message appended)
watch(() => chat.messages.length, (newLen, oldLen) => {
  if (oldLen > 0 && newLen > oldLen) {
    // Always scroll to bottom when the user sends a message, even if scrolled up
    const lastMsg = chat.messages[newLen - 1];
    if (lastMsg?.role === 'user') {
      chat.autoScroll = true;
      // Use multiple attempts like session load — ensures ScrollArea renders the new message
      nextTick(forceScrollToEnd);
      setTimeout(forceScrollToEnd, 50);
      setTimeout(forceScrollToEnd, 150);
    } else if (chat.autoScroll) {
      // For tool_use/system messages and new assistant bubbles during streaming,
      // use instant scroll to avoid smooth-scroll race conditions
      isProgrammaticScroll.value = true;
      nextTick(() => {
        requestAnimationFrame(() => {
          forceScrollToEnd();
          requestAnimationFrame(() => {
            isProgrammaticScroll.value = false;
          });
        });
      });
    }
  }
});
// Auto-scroll on streaming content updates (text deltas appended to any assistant message)
// Throttle to avoid overwhelming the browser with scroll operations during rapid deltas
let contentScrollRaf: number | null = null;
watch(() => chat.contentVersion, () => {
  if (chat.autoScroll) {
    isProgrammaticScroll.value = true;
    if (contentScrollRaf !== null) cancelAnimationFrame(contentScrollRaf);
    contentScrollRaf = requestAnimationFrame(() => {
      contentScrollRaf = null;
      forceScrollToEnd();
      // Release the flag after the browser processes the scroll event
      requestAnimationFrame(() => {
        isProgrammaticScroll.value = false;
      });
    });
  }
});

// Attach scroll listener
let activeViewport: HTMLElement | null = null;
watch(scrollContainer, (el) => {
  // Clean up previous listener
  if (activeViewport) {
    activeViewport.removeEventListener('scroll', handleScroll);
    activeViewport = null;
  }
  if (el) {
    nextTick(() => {
      const viewport = getViewport();
      if (viewport) {
        viewport.addEventListener('scroll', handleScroll);
        activeViewport = viewport;
      }
    });
  }
});

onUnmounted(() => {
  if (activeViewport) {
    activeViewport.removeEventListener('scroll', handleScroll);
    activeViewport = null;
  }
});
</script>

<template>
  <div class="relative h-full transition-colors duration-700" :class="chat.isRateLimited ? 'bg-red-950/40' : ''">
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
      <div v-if="chat.messages.length === 0 && !chat.isLoadingSession" class="flex h-full items-center justify-center p-8">
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
        <!-- Load older messages indicator -->
        <div v-if="chat.hasMoreMessages" class="flex justify-center py-3">
          <div v-if="chat.isLoadingMore" class="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 class="h-3 w-3 animate-spin" />
            Loading older messages...
          </div>
          <Button
            v-else
            variant="ghost"
            size="sm"
            class="text-xs text-muted-foreground"
            @click="loadOlderMessages"
          >
            Load older messages ({{ chat.oldestLoadedIndex }} remaining)
          </Button>
        </div>

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
            :is-group-start="isGroupStart(idx)"
            @approve-tool="(id) => emit('approveTool', id)"
            @reject-tool="(id) => emit('rejectTool', id)"
          />
        </div>

        <!-- Energy beam: visible while Claude is streaming -->
        <div v-if="chat.isStreaming" class="ai-thinking-beam mx-4">
          <div class="energy-beam" />
          <div class="energy-beam secondary" />
        </div>

        <!-- Response complete divider -->
        <Transition
          enter-active-class="transition duration-400 ease-out"
          enter-from-class="opacity-0 scale-95"
          enter-to-class="opacity-100 scale-100"
          leave-active-class="transition duration-200 ease-in"
          leave-from-class="opacity-100"
          leave-to-class="opacity-0"
        >
          <div v-if="(showResponseComplete || showHistoricalComplete) && !chat.isStreaming && !hasPendingQuestion" class="response-complete-divider mx-4 my-3">
            <div class="flex items-center gap-2">
              <div class="h-px flex-1 bg-gradient-to-r from-transparent via-primary/30 to-transparent" />
              <div class="flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/5 px-3 py-1">
                <CheckCircle2 class="h-3 w-3 text-primary" />
                <span class="text-[11px] font-medium text-primary/80">Response complete</span>
                <span class="text-[10px] text-muted-foreground">{{ showResponseComplete ? responseCompleteTime : historicalCompleteTime }}</span>
              </div>
              <div class="h-px flex-1 bg-gradient-to-r from-transparent via-primary/30 to-transparent" />
            </div>
          </div>
        </Transition>

        <!-- Scroll anchor — always at the very bottom of content -->
        <div id="scroll-anchor" aria-hidden="true" />
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
