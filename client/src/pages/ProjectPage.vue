<script setup lang="ts">
import { onMounted } from 'vue';
import { useChatStore } from '@/stores/chat';
import { apiFetch } from '@/lib/apiFetch';
import { useGraphStore } from '@/stores/graph';
import { useAutopilotStore } from '@/stores/autopilot';
import { useProviderStore } from '@/stores/provider';
import { useRoute, useRouter, onBeforeRouteUpdate } from 'vue-router';
import type { RouteLocationNormalized } from 'vue-router';
import AppLayout from '@/components/layout/AppLayout.vue';

const chat = useChatStore();
const graph = useGraphStore();
const autopilot = useAutopilotStore();
const providerStore = useProviderStore();
const route = useRoute();
const router = useRouter();

// AbortController for cancelling in-flight session loads on navigation
let loadAbort: AbortController | null = null;

async function handleRoute(to: RouteLocationNormalized) {
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
  <AppLayout />
</template>
