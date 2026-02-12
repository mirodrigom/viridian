<script setup lang="ts">
import { onMounted } from 'vue';
import { useChatStore } from '@/stores/chat';
import { useAuthStore } from '@/stores/auth';
import { useRoute, useRouter } from 'vue-router';
import AppLayout from '@/components/layout/AppLayout.vue';

const chat = useChatStore();
const auth = useAuthStore();
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
