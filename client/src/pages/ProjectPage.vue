<script setup lang="ts">
import { onMounted } from 'vue';
import { useChatStore } from '@/stores/chat';
import { useAuthStore } from '@/stores/auth';
import { useGraphStore } from '@/stores/graph';
import { useAutopilotStore } from '@/stores/autopilot';
import { useProviderStore } from '@/stores/provider';
import { useRoute, useRouter } from 'vue-router';
import AppLayout from '@/components/layout/AppLayout.vue';

const chat = useChatStore();
const auth = useAuthStore();
const graph = useGraphStore();
const autopilot = useAutopilotStore();
const providerStore = useProviderStore();
const route = useRoute();
const router = useRouter();

onMounted(async () => {
  // Ensure a project path is set (falls back to /home if nothing stored)
  if (!chat.projectPath) {
    chat.setProjectPath('/home');
  }

  // If navigated to /chat/:sessionId, load that session
  const sessionId = route.params.sessionId as string | undefined;
  if (sessionId && (sessionId !== chat.sessionId || chat.messages.length === 0)) {
    await loadSessionFromUrl(sessionId);
  } else if (!sessionId && route.name === 'project' && chat.sessionId) {
    // Landing on /project with no sessionId in URL but a stale sessionId in store
    // (e.g. from sessionStorage after a page refresh). Clear it so the next
    // conversation correctly creates a new session and updates the URL.
    chat.clearMessages();
  }

  // If navigated to /graph/:graphId, load that graph
  const graphId = route.params.graphId as string | undefined;
  if (graphId && graphId !== graph.currentGraphId) {
    try {
      await graph.loadGraph(graphId);
    } catch {
      console.error('Failed to load graph from URL');
      router.replace({ name: 'graph' });
    }
  }

  // If navigated to /autopilot/:runId or /autopilot/:runId/:cycleNumber, load that run
  const runId = route.params.runId as string | undefined;
  if (runId) {
    // If a run is actively running and URL points to a different run, correct to active run
    if (autopilot.isRunning && autopilot.currentRun?.runId !== runId) {
      router.replace({ name: 'autopilot-run', params: { runId: autopilot.currentRun!.runId } });
    } else if (autopilot.currentRun?.runId !== runId) {
      try {
        await autopilot.loadRun(runId);
        const cycleNumber = route.params.cycleNumber as string | undefined;
        if (cycleNumber !== undefined) {
          autopilot.selectedCycleNumber = Number(cycleNumber);
        }
      } catch {
        console.error('Failed to load autopilot run from URL');
        router.replace({ name: 'autopilot' });
      }
    } else {
      // Run already loaded, just apply cycle selection from URL
      const cycleNumber = route.params.cycleNumber as string | undefined;
      if (cycleNumber !== undefined) {
        autopilot.selectedCycleNumber = Number(cycleNumber);
      }
    }
  }
});

async function loadSessionFromUrl(sessionId: string) {
  try {
    // First fetch sessions to find the projectDir for this session
    const res = await fetch('/api/sessions', {
      headers: { Authorization: `Bearer ${auth.token}` },
    });
    if (!res.ok) return;
    const data = await res.json();
    const session = (data.sessions || []).find((s: { id: string }) => s.id === sessionId);
    if (!session) return;

    // Set project path if we came directly via URL
    if (session.projectPath && session.projectPath !== chat.projectPath) {
      chat.setProjectPath(session.projectPath);
    }

    chat.isLoadingSession = true;
    chat.clearMessages();
    chat.sessionId = session.id;
    chat.claudeSessionId = session.id; // JSONL filename = Claude CLI session ID
    chat.activeProjectDir = session.projectDir;

    const msgRes = await fetch(
      `/api/sessions/${session.id}/messages?projectDir=${encodeURIComponent(session.projectDir)}&limit=50`,
      { headers: { Authorization: `Bearer ${auth.token}` } },
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
    chat.isLoadingSession = false;
    console.error('Failed to load session from URL:', err);
    router.replace({ name: 'project' });
  }
}
</script>

<template>
  <AppLayout />
</template>
