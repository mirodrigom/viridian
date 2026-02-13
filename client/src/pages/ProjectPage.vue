<script setup lang="ts">
import { onMounted } from 'vue';
import { useChatStore } from '@/stores/chat';
import { useAuthStore } from '@/stores/auth';
import { useGraphStore } from '@/stores/graph';
import { useRoute, useRouter } from 'vue-router';
import AppLayout from '@/components/layout/AppLayout.vue';

const chat = useChatStore();
const auth = useAuthStore();
const graph = useGraphStore();
const route = useRoute();
const router = useRouter();

onMounted(async () => {
  // Ensure a project path is set (falls back to /home if nothing stored)
  if (!chat.projectPath) {
    chat.setProjectPath('/home');
  }

  // If navigated to /chat/:sessionId, load that session
  const sessionId = route.params.sessionId as string | undefined;
  if (sessionId && sessionId !== chat.sessionId) {
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

    chat.clearMessages();
    chat.sessionId = session.id;
    chat.claudeSessionId = session.id; // JSONL filename = Claude CLI session ID
    chat.activeProjectDir = session.projectDir;

    const msgRes = await fetch(
      `/api/sessions/${session.id}/messages?projectDir=${encodeURIComponent(session.projectDir)}&limit=50`,
      { headers: { Authorization: `Bearer ${auth.token}` } },
    );
    if (!msgRes.ok) return;
    const msgData = await msgRes.json();
    if (msgData.messages?.length) {
      chat.loadMessages(msgData.messages, {
        total: msgData.total,
        hasMore: msgData.hasMore,
        oldestIndex: msgData.oldestIndex,
      });
    }
    if (msgData.usage) {
      chat.updateUsage({
        inputTokens: msgData.usage.inputTokens || 0,
        outputTokens: msgData.usage.outputTokens || 0,
      });
    }
  } catch (err) {
    console.error('Failed to load session from URL:', err);
    router.replace({ name: 'project' });
  }
}
</script>

<template>
  <AppLayout />
</template>
