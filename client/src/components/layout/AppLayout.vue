<script setup lang="ts">
import { ref, watch, provide, onMounted, onUnmounted, defineAsyncComponent } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '@/components/ui/resizable';
import { useSettingsStore } from '@/stores/settings';
import { useProviderStore } from '@/stores/provider';
import { useChatStore } from '@/stores/chat';
import { useGraphStore } from '@/stores/graph';
import { useAutopilotStore } from '@/stores/autopilot';
import { useDiagramsStore } from '@/stores/diagrams';
import { useAudioProviderStore } from '@/stores/audioProvider';
import TopBar from './TopBar.vue';
import MainTabs from './MainTabs.vue';
const TerminalPanel = defineAsyncComponent(() => import('./TerminalPanel.vue'));
import AudioOverlay from '@/components/chat/AudioOverlay.vue';
import SettingsDialog from '@/components/settings/SettingsDialog.vue';
import CommandPalette from './CommandPalette.vue';
import { useKeyboardShortcuts } from '@/composables/useKeyboardShortcuts';
import { useWakeWord } from '@/composables/useWakeWord';
import { useGlobalVoiceCommands } from '@/composables/useGlobalVoiceCommands';
import { toast } from 'vue-sonner';

const settings = useSettingsStore();
const providerStore = useProviderStore();
const chat = useChatStore();
const graphStore = useGraphStore();
const autopilotStore = useAutopilotStore();
const diagramsStore = useDiagramsStore();
const route = useRoute();
const router = useRouter();

// Derive initial tab from route meta
const initialTab = (route.meta.tab as string) || 'chat';
const activeTab = ref(initialTab);
const showTerminal = ref(false);
const showSettings = ref(false);
const settingsSection = ref('providers');
const showCommandPalette = ref(false);

// ─── Global Audio Overlay & Wake Word ──────────────────────────────────
const audioStore = useAudioProviderStore();
const globalVoice = useGlobalVoiceCommands();
const showAudioOverlay = ref(false);

const { start: startWakeWord, stop: stopWakeWord } = useWakeWord({
  onWakeWordDetected: () => {
    if (chat.isStreaming) {
      toast.info('Wait for Claude to finish before sending another message');
      return;
    }
    showAudioOverlay.value = true;
  },
  paused: showAudioOverlay,
});

watch(() => audioStore.wakeWordEnabled, (enabled) => {
  if (enabled) startWakeWord();
  else stopWakeWord();
}, { immediate: true });

function activateGlobalMic() {
  if (chat.isStreaming) {
    toast.info('Wait for Claude to finish before sending another message');
    return;
  }
  showAudioOverlay.value = true;
}

// Callback that ChatView registers to receive voice transcripts meant for chat
let chatTranscriptHandler: ((text: string, mode: string) => void) | null = null;

provide('activateGlobalMic', activateGlobalMic);
provide('showAudioOverlay', showAudioOverlay);
provide('registerChatTranscriptHandler', (handler: (text: string, mode: string) => void) => {
  chatTranscriptHandler = handler;
});

function handleVoiceTranscript(text: string, mode: string) {
  // Try global commands first (navigation, theme, git, chat management)
  if (globalVoice.tryExecute(text)) return;

  // Forward to ChatView if registered
  if (chatTranscriptHandler) {
    chatTranscriptHandler(text, mode);
  }
}

function openToolsSettings() {
  settingsSection.value = 'tools';
  showSettings.value = true;
}

// Provide so deeply nested components (ChatView → SessionSidebar) can open settings
provide('openToolsSettings', openToolsSettings);
provide('openTerminal', () => { showTerminal.value = true; });
provide('openSettingsProviders', () => { settingsSection.value = 'providers'; showSettings.value = true; });
const isMobile = ref(false);

useKeyboardShortcuts(showCommandPalette);

// Route → tab: when route changes, sync the active tab
watch(() => route.meta.tab, (tab) => {
  if (tab && typeof tab === 'string') {
    activeTab.value = tab;
  }
});

// Tab → route: when tab changes (from MainTabs click), update the URL
const TAB_ROUTES: Record<string, string> = {
  chat: 'project',
  editor: 'editor',
  git: 'git',
  tasks: 'tasks',
  management: 'management',
  graph: 'graph',
  autopilot: 'autopilot',
  diagrams: 'diagrams',
  manuals: 'manuals',
};

watch(activeTab, (newTab, oldTab) => {
  if (newTab === oldTab) return;
  // For chat, preserve session id if we had one
  if (newTab === 'chat' && route.name === 'chat-session') return;
  // For chat, navigate to session route if a session is active
  if (newTab === 'chat' && chat.sessionId) {
    if (route.name !== 'chat-session') {
      router.replace({ name: 'chat-session', params: { sessionId: chat.sessionId } });
    }
    return;
  }
  // For graph, navigate to graph-open if a graph is loaded
  if (newTab === 'graph' && graphStore.currentGraphId) {
    if (route.name !== 'graph-open') {
      router.replace({ name: 'graph-open', params: { graphId: graphStore.currentGraphId } });
    }
    return;
  }
  // For diagrams, navigate to diagram-open if a diagram is loaded
  if (newTab === 'diagrams' && diagramsStore.currentDiagramId) {
    if (route.name !== 'diagram-open') {
      router.replace({ name: 'diagram-open', params: { diagramId: diagramsStore.currentDiagramId } });
    }
    return;
  }
  // For autopilot, preserve run/cycle in URL if a run is loaded
  if (newTab === 'autopilot' && (route.name === 'autopilot-run' || route.name === 'autopilot-cycle')) return;
  if (newTab === 'autopilot' && autopilotStore.currentRun) {
    const runId = autopilotStore.currentRun.runId;
    if (autopilotStore.selectedCycleNumber !== null) {
      router.replace({ name: 'autopilot-cycle', params: { runId, cycleNumber: String(autopilotStore.selectedCycleNumber) } });
    } else {
      router.replace({ name: 'autopilot-run', params: { runId } });
    }
    return;
  }
  const targetRoute = TAB_ROUTES[newTab];
  if (targetRoute && route.name !== targetRoute) {
    router.replace({ name: targetRoute });
  }
});

function checkMobile() {
  isMobile.value = window.innerWidth < 768;
  if (isMobile.value) {
    showTerminal.value = false;
  }
}

onMounted(() => {
  settings.init();
  providerStore.fetchProviders();
  checkMobile();
  window.addEventListener('resize', checkMobile);
});

onUnmounted(() => {
  window.removeEventListener('resize', checkMobile);
});

function toggleTerminal() {
  showTerminal.value = !showTerminal.value;
}
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden bg-background">
    <h1 class="sr-only">Viridian</h1>
    <TopBar
      @toggle-terminal="toggleTerminal"
      @open-settings="showSettings = true"
    />
    <main class="flex-1 overflow-hidden">
    <ResizablePanelGroup direction="vertical" class="h-full">
      <ResizablePanel :default-size="showTerminal ? 70 : 100" :min-size="30">
        <MainTabs v-model:active-tab="activeTab" />
      </ResizablePanel>
      <template v-if="showTerminal">
        <ResizableHandle />
        <ResizablePanel :default-size="30" :min-size="10" :max-size="60">
          <TerminalPanel />
        </ResizablePanel>
      </template>
    </ResizablePanelGroup>
    </main>

    <!-- Global Audio Overlay — works from any view via "Hey Buddy" -->
    <Teleport to="body">
      <div v-if="showAudioOverlay" class="fixed inset-0 z-[100]">
        <AudioOverlay
          :open="showAudioOverlay"
          @update:open="showAudioOverlay = $event"
          @transcript="handleVoiceTranscript"
        />
      </div>
    </Teleport>

    <SettingsDialog v-model:open="showSettings" v-model:section="settingsSection" />
    <CommandPalette v-model:open="showCommandPalette" @toggle-terminal="toggleTerminal" />
  </div>
</template>
