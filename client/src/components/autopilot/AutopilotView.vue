<script setup lang="ts">
import { ref, provide } from 'vue';
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '@/components/ui/resizable';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAutopilot } from '@/composables/useAutopilot';
import AutopilotSessionSidebar from './AutopilotSessionSidebar.vue';
import AutopilotDualChat from './AutopilotDualChat.vue';
import AutopilotTimeline from './AutopilotTimeline.vue';
import AutopilotDashboard from './AutopilotDashboard.vue';
import AutopilotConfigDialog from './AutopilotConfigDialog.vue';

const store = useAutopilot();
const showConfig = ref(false);
provide('showAutopilotConfig', showConfig);
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- Main content: sidebar + dual chat + right panel -->
    <div class="flex-1 overflow-hidden">
      <ResizablePanelGroup direction="horizontal" class="h-full">
        <!-- Left: Session Sidebar -->
        <ResizablePanel :default-size="18" :min-size="12" :max-size="30">
          <AutopilotSessionSidebar />
        </ResizablePanel>

        <ResizableHandle />

        <!-- Center: Dual Chat -->
        <ResizablePanel :default-size="50" :min-size="30">
          <AutopilotDualChat />
        </ResizablePanel>

        <ResizableHandle with-handle />

        <!-- Right: Timeline + Dashboard -->
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

    <!-- Config dialog -->
    <AutopilotConfigDialog />
  </div>
</template>
