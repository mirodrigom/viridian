<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '@/components/ui/resizable';
import { useSettingsStore } from '@/stores/settings';
import TopBar from './TopBar.vue';
import MainTabs from './MainTabs.vue';
import FileSidebar from './FileSidebar.vue';
import TerminalPanel from './TerminalPanel.vue';
import SettingsDialog from '@/components/settings/SettingsDialog.vue';
import ToolsSettingsDialog from '@/components/settings/ToolsSettingsDialog.vue';

const settings = useSettingsStore();
const activeTab = ref('chat');
const showFiles = ref(true);
const showTerminal = ref(false);
const showSettings = ref(false);
const showToolsSettings = ref(false);
const isMobile = ref(false);

function checkMobile() {
  isMobile.value = window.innerWidth < 768;
  if (isMobile.value) {
    showFiles.value = false;
    showTerminal.value = false;
  }
}

onMounted(() => {
  settings.init();
  checkMobile();
  window.addEventListener('resize', checkMobile);
});

onUnmounted(() => {
  window.removeEventListener('resize', checkMobile);
});

function toggleFiles() {
  showFiles.value = !showFiles.value;
}

function toggleTerminal() {
  showTerminal.value = !showTerminal.value;
}
</script>

<template>
  <div class="flex h-screen flex-col overflow-hidden bg-background">
    <TopBar
      @toggle-files="toggleFiles"
      @toggle-terminal="toggleTerminal"
      @open-settings="showSettings = true"
      @open-tools-settings="showToolsSettings = true"
    />
    <ResizablePanelGroup direction="vertical" class="flex-1">
      <ResizablePanel :default-size="showTerminal ? 70 : 100" :min-size="30">
        <ResizablePanelGroup direction="horizontal">
          <ResizablePanel :default-size="showFiles && activeTab === 'editor' ? 75 : 100" :min-size="40">
            <MainTabs v-model:active-tab="activeTab" />
          </ResizablePanel>
          <template v-if="showFiles && activeTab === 'editor'">
            <ResizableHandle />
            <ResizablePanel :default-size="25" :min-size="15" :max-size="40">
              <FileSidebar />
            </ResizablePanel>
          </template>
        </ResizablePanelGroup>
      </ResizablePanel>
      <template v-if="showTerminal">
        <ResizableHandle />
        <ResizablePanel :default-size="30" :min-size="10" :max-size="60">
          <TerminalPanel />
        </ResizablePanel>
      </template>
    </ResizablePanelGroup>

    <SettingsDialog v-model:open="showSettings" />
    <ToolsSettingsDialog v-model:open="showToolsSettings" />
  </div>
</template>
