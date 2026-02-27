<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { useChatStore } from '@/stores/chat';
import { apiFetch } from '@/lib/apiFetch';
import { useGraphStore } from '@/stores/graph';
import { useAutopilotStore } from '@/stores/autopilot';
import { useProviderStore } from '@/stores/provider';
import { useRoute, useRouter, onBeforeRouteUpdate } from 'vue-router';
import type { RouteLocationNormalized } from 'vue-router';
import AppLayout from '@/components/layout/AppLayout.vue';
import ViridianLogo from '@/components/icons/ViridianLogo.vue';
import { Loader2 } from 'lucide-vue-next';

// Fun loading messages shown while the project workspace initializes
const loadingMessages = [
  'Scanning the codebase...',
  'Reading every single file (just kidding)...',
  'Counting semicolons...',
  'Untangling spaghetti code...',
  'Asking the rubber duck for advice...',
  'Compiling excuses for tech debt...',
  'Negotiating with the git history...',
  'Warming up the AI hamster wheel...',
  'Translating code from human to machine...',
  'Searching for missing semicolons...',
  'Optimizing the coffee-to-code ratio...',
  'Bribing the linter...',
  'Refactoring the refactoring...',
  'Checking if it works on my machine...',
  'Deploying butterflies for the butterfly effect...',
  'Convincing TypeScript everything is fine...',
  'Feeding the neural networks...',
  'Downloading more RAM...',
];
const currentLoadingMsg = ref(loadingMessages[Math.floor(Math.random() * loadingMessages.length)]);
let loadingMsgTimer: ReturnType<typeof setInterval> | null = null;

function startLoadingMessages() {
  currentLoadingMsg.value = loadingMessages[Math.floor(Math.random() * loadingMessages.length)];
  loadingMsgTimer = setInterval(() => {
    let next: string;
    do {
      next = loadingMessages[Math.floor(Math.random() * loadingMessages.length)];
    } while (next === currentLoadingMsg.value && loadingMessages.length > 1);
    currentLoadingMsg.value = next;
  }, 2500);
}
function stopLoadingMessages() {
  if (loadingMsgTimer) {
    clearInterval(loadingMsgTimer);
    loadingMsgTimer = null;
  }
}
onUnmounted(() => stopLoadingMessages());

const chat = useChatStore();
const graph = useGraphStore();
const autopilot = useAutopilotStore();
const providerStore = useProviderStore();
const route = useRoute();
const router = useRouter();

// AbortController for cancelling in-flight session loads on navigation
let loadAbort: AbortController | null = null;

async function handleRoute(to: RouteLocationNormalized) {
  // Show loading screen when first entering the project workspace
  const isFirstLoad = !chat.isLoadingProject && to.name === 'project' && !to.params.sessionId;
  if (isFirstLoad) {
    chat.isLoadingProject = true;
    startLoadingMessages();
  }

  // Ensure a project path is set (falls back to /home if nothing stored)
  if (!chat.projectPath) {
    chat.setProjectPath('/home');
  }

  // --- Chat session handling ---
  const sessionId = to.params.sessionId as string | undefined;
  // Cancel any in-flight session load
  loadAbort?.abort();
  loadAbort = new AbortController();

  if (sessionId && (sessionId !== chat.sessionId || chat.messages.length === 0)) {
    await loadSessionFromUrl(sessionId, loadAbort.signal);
  } else if (!sessionId && (to.name === 'project') && chat.sessionId) {
    // Landing on /project with no sessionId in URL but a stale sessionId in store
    // (e.g. from sessionStorage after a page refresh). Clear it so the next
    // conversation correctly creates a new session and updates the URL.
    chat.clearMessages();
  }

  // --- Graph handling ---
  const graphId = to.params.graphId as string | undefined;
  if (graphId && graphId !== graph.currentGraphId) {
    try {
      await graph.loadGraph(graphId);
    } catch {
      console.error('Failed to load graph from URL');
      router.replace({ name: 'graph' });
    }
  }

  // --- Autopilot handling ---
  const runId = to.params.runId as string | undefined;
  if (runId) {
    if (autopilot.isRunning && autopilot.currentRun?.runId !== runId) {
      router.replace({ name: 'autopilot-run', params: { runId: autopilot.currentRun!.runId } });
    } else if (autopilot.currentRun?.runId !== runId) {
      try {
        await autopilot.loadRun(runId);
        const cycleNumber = to.params.cycleNumber as string | undefined;
        if (cycleNumber !== undefined) {
          autopilot.selectedCycleNumber = Number(cycleNumber);
        }
      } catch {
        console.error('Failed to load autopilot run from URL');
        router.replace({ name: 'autopilot' });
      }
    } else {
      const cycleNumber = to.params.cycleNumber as string | undefined;
      if (cycleNumber !== undefined) {
        autopilot.selectedCycleNumber = Number(cycleNumber);
      }
    }
  }

  // Dismiss the loading screen with a minimum display time so it doesn't flash
  if (isFirstLoad) {
    setTimeout(() => {
      chat.isLoadingProject = false;
      stopLoadingMessages();
    }, 1200);
  }
}

onMounted(() => handleRoute(route));

// Handle browser back/forward navigation when Vue reuses this component
// (all /project, /chat/:sessionId, /editor, /git, etc. routes use ProjectPage)
onBeforeRouteUpdate((to) => handleRoute(to));

async function loadSessionFromUrl(sessionId: string, signal?: AbortSignal) {
  try {
    // First fetch sessions to find the projectDir for this session
    const res = await apiFetch('/api/sessions', {
      signal,
    });
    if (!res.ok) return;
    const data = await res.json();
    const session = (data.sessions || []).find((s: { id: string }) => s.id === sessionId);
    if (!session) return;

    // Set project path if we came directly via URL
    if (session.projectPath && session.projectPath !== chat.projectPath) {
      chat.setProjectPath(session.projectPath);
    }

    chat.clearMessages();
    chat.isLoadingSession = true;
    chat.sessionId = session.id;
    chat.claudeSessionId = session.id; // JSONL filename = Claude CLI session ID
    chat.activeProjectDir = session.projectDir;

    const msgRes = await apiFetch(
      `/api/sessions/${session.id}/messages?projectDir=${encodeURIComponent(session.projectDir)}&limit=50`,
      { signal },
    );
    if (!msgRes.ok) { chat.isLoadingSession = false; return; }
    const msgData = await msgRes.json();
    if (msgData.messages?.length) {
      if (msgData.sessionProvider) {
        const p = providerStore.providers.find(pr => pr.id === msgData.sessionProvider);
        for (const msg of msgData.messages) {
          if (msg.role === 'assistant') {
            if (!msg.provider) msg.provider = msgData.sessionProvider;
            if (!msg.providerName) msg.providerName = p?.name ?? msgData.sessionProvider;
            if (!msg.providerIcon) msg.providerIcon = p?.icon;
          }
        }
      }
      chat.loadMessages(msgData.messages, {
        total: msgData.total,
        hasMore: msgData.hasMore,
        oldestIndex: msgData.oldestIndex,
      });
    } else {
      chat.isLoadingSession = false;
    }
    if (msgData.usage) {
      chat.updateUsage({
        inputTokens: msgData.usage.inputTokens || 0,
        outputTokens: msgData.usage.outputTokens || 0,
      });
    }
    // If this session is currently streaming on the server, activate streaming UI
    // so the spinner shows immediately. The WebSocket check_session mechanism
    // will wire up live events for the ongoing stream.
    if (msgData.isStreaming) {
      chat.startStreaming();
    }
  } catch (err) {
    // Ignore AbortError — just means navigation cancelled the load
    if (err instanceof DOMException && err.name === 'AbortError') return;
    chat.isLoadingSession = false;
    console.error('Failed to load session from URL:', err);
    router.replace({ name: 'project' });
  }
}
</script>

<template>
  <!-- Project loading screen with rotating fun messages -->
  <div v-if="chat.isLoadingProject" class="flex h-full items-center justify-center bg-background">
    <div class="text-center">
      <div class="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-primary/10">
        <Loader2 class="h-10 w-10 animate-spin text-primary" />
      </div>
      <h2 class="mb-3 text-xl font-semibold text-foreground">Opening project</h2>
      <Transition
        mode="out-in"
        enter-active-class="transition duration-300 ease-out"
        enter-from-class="opacity-0 translate-y-1"
        enter-to-class="opacity-100 translate-y-0"
        leave-active-class="transition duration-200 ease-in"
        leave-from-class="opacity-100 translate-y-0"
        leave-to-class="opacity-0 -translate-y-1"
      >
        <p :key="currentLoadingMsg" class="text-sm text-muted-foreground">
          {{ currentLoadingMsg }}
        </p>
      </Transition>
    </div>
  </div>
  <AppLayout v-else />
</template>
