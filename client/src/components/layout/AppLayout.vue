<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, defineAsyncComponent } from 'vue';
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
import TopBar from './TopBar.vue';
import MainTabs from './MainTabs.vue';
const TerminalPanel = defineAsyncComponent(() => import('./TerminalPanel.vue'));
import SettingsDialog from '@/components/settings/SettingsDialog.vue';
import ToolsSettingsDialog from '@/components/settings/ToolsSettingsDialog.vue';
import CommandPalette from './CommandPalette.vue';
import { useKeyboardShortcuts } from '@/composables/useKeyboardShortcuts';

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
const showToolsSettings = ref(false);
const showCommandPalette = ref(false);
const splitView = ref(false);
const isMobile = ref(false);

useKeyboardShortcuts(showCommandPalette, splitView);

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
    splitView.value = false;
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
      v-model:split-view="splitView"
      @toggle-terminal="toggleTerminal"
      @open-settings="showSettings = true"
      @open-tools-settings="showToolsSettings = true"
    />
    <main class="flex-1 overflow-hidden">
    <ResizablePanelGroup direction="vertical" class="h-full">
      <ResizablePanel :default-size="showTerminal ? 70 : 100" :min-size="30">
        <MainTabs v-model:active-tab="activeTab" :split-view="splitView" />
      </ResizablePanel>
      <template v-if="showTerminal">
        <ResizableHandle />
        <ResizablePanel :default-size="30" :min-size="10" :max-size="60">
          <TerminalPanel />
        </ResizablePanel>
      </template>
    </ResizablePanelGroup>
    </main>

    <SettingsDialog v-model:open="showSettings" />
    <ToolsSettingsDialog v-model:open="showToolsSettings" />
    <CommandPalette v-model:open="showCommandPalette" v-model:split-view="splitView" @toggle-terminal="toggleTerminal" />
  </div>
</template>
