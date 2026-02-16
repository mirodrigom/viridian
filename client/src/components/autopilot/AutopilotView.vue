<script setup lang="ts">
import { ref, provide, onMounted, onUnmounted } from 'vue';
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '@/components/ui/resizable';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Menu, MessageSquare, Clock, BarChart3 } from 'lucide-vue-next';
import { useAutopilot } from '@/composables/useAutopilot';
import AutopilotSessionSidebar from './AutopilotSessionSidebar.vue';
import AutopilotDualChat from './AutopilotDualChat.vue';
import AutopilotTimeline from './AutopilotTimeline.vue';
import AutopilotDashboard from './AutopilotDashboard.vue';
import AutopilotConfigDialog from './AutopilotConfigDialog.vue';

const store = useAutopilot();
const showConfig = ref(false);
provide('showAutopilotConfig', showConfig);

// Mobile responsive
const isMobile = ref(false);
const showMobileSidebar = ref(false);
const mobileTab = ref<'chat' | 'timeline' | 'dashboard'>('chat');

function onResize() {
  isMobile.value = window.innerWidth < 768;
  if (!isMobile.value) showMobileSidebar.value = false;
}

onMounted(() => {
  onResize();
  window.addEventListener('resize', onResize);
});

onUnmounted(() => {
  window.removeEventListener('resize', onResize);
});
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- Desktop layout -->
    <template v-if="!isMobile">
      <div class="flex-1 overflow-hidden">
        <ResizablePanelGroup direction="horizontal" class="h-full">
          <ResizablePanel :default-size="18" :min-size="12" :max-size="30">
            <AutopilotSessionSidebar />
          </ResizablePanel>

          <ResizableHandle />

          <ResizablePanel :default-size="50" :min-size="30">
            <AutopilotDualChat />
          </ResizablePanel>

          <ResizableHandle with-handle />

          <ResizablePanel :default-size="32" :min-size="18">
            <Tabs default-value="timeline" class="flex h-full flex-col">
              <TabsList class="mx-2 mt-1 w-fit">
                <TabsTrigger value="timeline">Timeline</TabsTrigger>
                <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
              </TabsList>
              <TabsContent value="timeline" class="flex-1 overflow-hidden">
                <AutopilotTimeline />
              </TabsContent>
              <TabsContent value="dashboard" class="flex-1 overflow-hidden">
                <AutopilotDashboard />
              </TabsContent>
            </Tabs>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </template>

    <!-- Mobile layout -->
    <template v-else>
      <div class="relative flex flex-1 flex-col overflow-hidden">
        <!-- Mobile sidebar overlay (absolute, within tab content) -->
        <Transition name="fade">
          <div v-if="showMobileSidebar" class="absolute inset-0 z-30 bg-black/50" @click="showMobileSidebar = false" />
        </Transition>
        <Transition name="slide-left">
          <div v-if="showMobileSidebar" class="absolute inset-y-0 left-0 z-40 w-72 bg-background shadow-xl">
            <AutopilotSessionSidebar />
          </div>
        </Transition>

        <!-- Mobile header bar -->
        <div class="flex h-10 items-center gap-1 border-b border-border px-2">
          <Button variant="ghost" size="sm" class="h-8 w-8 p-0" @click="showMobileSidebar = true">
            <Menu class="h-4 w-4" />
          </Button>
          <button
            v-for="tab in ([
              { key: 'chat', label: 'Chat', icon: MessageSquare },
              { key: 'timeline', label: 'Timeline', icon: Clock },
              { key: 'dashboard', label: 'Dashboard', icon: BarChart3 },
            ] as const)"
            :key="tab.key"
            class="flex min-h-[44px] flex-1 items-center justify-center gap-1 rounded-md px-1 py-1.5 text-xs font-medium transition-colors"
            :class="mobileTab === tab.key
              ? 'bg-background text-foreground shadow-sm ring-1 ring-border/60'
              : 'text-muted-foreground hover:text-foreground'"
            @click="mobileTab = tab.key"
          >
            <component :is="tab.icon" class="h-3.5 w-3.5" />
            {{ tab.label }}
          </button>
        </div>

        <!-- Mobile content -->
        <div class="flex-1 overflow-hidden">
          <AutopilotDualChat v-if="mobileTab === 'chat'" />
          <AutopilotTimeline v-else-if="mobileTab === 'timeline'" />
          <AutopilotDashboard v-else />
        </div>
      </div>
    </template>

    <!-- Config dialog -->
    <AutopilotConfigDialog />
  </div>
</template>
