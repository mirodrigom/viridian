<script setup lang="ts">
import { computed } from 'vue';
import type { NodeProps } from '@vue-flow/core';
import type { Project } from '@/types/projects';
import { useProjectsStore } from '@/stores/projects';
import { useRouter } from 'vue-router';
import { Bot, Zap, ZapOff } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import { toast } from 'vue-sonner';

const props = defineProps<NodeProps>();
const store = useProjectsStore();
const router = useRouter();

const project = computed(() => props.data.project as Project);
const isActive = computed(() => project.value.agentStatus === 'active');

async function activate() {
  try {
    const sessionId = await store.activateAgent(project.value.id);
    await router.push({ name: 'chat-session', params: { sessionId } });
  } catch {
    toast.error('Failed to activate agent');
  }
}

async function deactivate() {
  try {
    await store.deactivateAgent(project.value.id);
  } catch {
    toast.error('Failed to deactivate agent');
  }
}

function openChat() {
  if (project.value.agentSessionId) {
    router.push({ name: 'chat-session', params: { sessionId: project.value.agentSessionId } });
  }
}
</script>

<template>
  <div
    class="agent-node min-w-[180px] max-w-[230px] rounded-lg border bg-card text-card-foreground shadow-sm"
    :class="isActive ? 'border-violet-500/40 ring-1 ring-violet-500/20 agent-pulse' : 'border-border border-dashed'"
  >
    <!-- Header -->
    <div
      class="flex items-center gap-2 rounded-t-lg border-b px-3 py-1.5"
      :class="isActive ? 'bg-violet-500/8' : 'bg-muted/20'"
    >
      <Bot class="h-3.5 w-3.5 shrink-0" :class="isActive ? 'text-violet-400' : 'text-muted-foreground'" />
      <span class="flex-1 truncate text-xs font-semibold text-muted-foreground">Claude Agent</span>
      <span
        class="flex items-center gap-1 text-[10px]"
        :class="isActive ? 'text-violet-400' : 'text-muted-foreground'"
      >
        <span class="h-1.5 w-1.5 rounded-full" :class="isActive ? 'bg-violet-400 animate-pulse' : 'bg-muted-foreground'" />
        {{ isActive ? 'Active' : 'Inactive' }}
      </span>
    </div>

    <!-- Body -->
    <div class="px-3 py-2 text-xs space-y-1.5">
      <div v-if="isActive" class="font-mono text-[10px] text-muted-foreground truncate">
        {{ project.agentSessionId?.slice(0, 8) }}…
      </div>
      <div v-else class="text-[10px] text-muted-foreground">
        Activate to open a scoped chat session in this project's folder.
      </div>

      <div class="flex gap-1">
        <Button
          v-if="!isActive"
          size="sm"
          variant="outline"
          class="h-5 flex-1 px-2 text-[10px] gap-1 border-violet-500/30 text-violet-400 hover:bg-violet-500/10"
          @click.stop="activate"
        >
          <Zap class="h-2.5 w-2.5" />
          Activate
        </Button>
        <template v-else>
          <Button
            size="sm"
            variant="outline"
            class="h-5 flex-1 px-2 text-[10px] gap-1"
            @click.stop="openChat"
          >
            <Bot class="h-2.5 w-2.5" />
            Open Chat
          </Button>
          <Button
            size="sm"
            variant="ghost"
            class="h-5 px-2 text-[10px] text-muted-foreground hover:text-destructive"
            @click.stop="deactivate"
          >
            <ZapOff class="h-2.5 w-2.5" />
          </Button>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.agent-node {
  transition: box-shadow 0.2s ease, border-color 0.2s ease;
}
.agent-pulse {
  animation: agent-glow 2.5s ease-in-out infinite;
}
@keyframes agent-glow {
  0%, 100% { box-shadow: 0 0 0 0 oklch(0.6 0.2 290 / 0%); }
  50% { box-shadow: 0 0 10px 2px oklch(0.6 0.2 290 / 15%); }
}
</style>
