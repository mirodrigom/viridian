<script setup lang="ts">
import { ref, computed, provide, onMounted, onUnmounted } from 'vue';
import { useClaudeStream } from '@/composables/useClaudeStream';
import { useChatStore } from '@/stores/chat';
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '@/components/ui/resizable';
import SessionSidebar from './SessionSidebar.vue';
import MessageList from './MessageList.vue';
import ChatInput from './ChatInput.vue';
import TodoTimeline from './TodoTimeline.vue';
import PlanReviewPanel from './PlanReviewPanel.vue';
import ToolsSettingsDialog from '@/components/settings/ToolsSettingsDialog.vue';
import { PanelLeft } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import { useModeTheme } from '@/composables/useModeTheme';

const chat = useChatStore();
const { modeClass } = useModeTheme();
const { init, sendMessage, respondToTool, abort } = useClaudeStream();
provide('respondToTool', respondToTool);
const showToolsSettings = ref(false);
const showMobileSidebar = ref(false);
const isMobile = ref(false);

function handleNewSession() {
  if (chat.isStreaming) abort();
}

const hasTodos = computed(() => chat.latestTodos.length > 0);
const hasRightPanel = computed(() => chat.isPlanReviewActive || hasTodos.value);

function handlePlanApprove() {
  chat.dismissPlanReview();
  sendMessage('Proceed with the plan.');
}

function handlePlanDeny() {
  chat.dismissPlanReview();
  sendMessage('Cancel this plan. Do not proceed.');
}

function handlePlanChange(feedback: string) {
  chat.dismissPlanReview();
  sendMessage(`I'd like changes to the plan: ${feedback}`);
}

function checkMobile() {
  isMobile.value = window.innerWidth < 768;
  if (!isMobile.value) showMobileSidebar.value = false;
}

onMounted(() => {
  init();
  checkMobile();
  window.addEventListener('resize', checkMobile);
});

onUnmounted(() => {
  window.removeEventListener('resize', checkMobile);
});

defineExpose({ showToolsSettings });
</script>

<template>
  <div class="relative flex h-full">
    <!-- Desktop: resizable sidebar -->
    <ResizablePanelGroup v-if="!isMobile" direction="horizontal" class="h-full">
      <ResizablePanel :default-size="22" :min-size="15" :max-size="35">
        <SessionSidebar
          @new-session="handleNewSession"
          @open-tools-settings="showToolsSettings = true"
        />
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel :default-size="hasRightPanel ? 58 : 78" :min-size="40">
        <div class="flex h-full flex-col" :class="modeClass">
          <MessageList
            class="flex-1 overflow-hidden"
            @approve-tool="(id) => respondToTool(id, true)"
            @reject-tool="(id) => respondToTool(id, false)"
          />
          <ChatInput @send="(msg, imgs) => sendMessage(msg, imgs)" @abort="abort" />
        </div>
      </ResizablePanel>
      <template v-if="chat.isPlanReviewActive">
        <ResizableHandle />
        <ResizablePanel :default-size="25" :min-size="18" :max-size="40">
          <PlanReviewPanel
            @approve="handlePlanApprove"
            @deny="handlePlanDeny"
            @change="handlePlanChange"
          />
        </ResizablePanel>
      </template>
      <template v-else-if="hasTodos">
        <ResizableHandle />
        <ResizablePanel :default-size="20" :min-size="14" :max-size="35">
          <TodoTimeline />
        </ResizablePanel>
      </template>
    </ResizablePanelGroup>

    <!-- Mobile: overlay sidebar + full-width chat -->
    <template v-else>
      <!-- Backdrop -->
      <Transition name="fade">
        <div
          v-if="showMobileSidebar"
          class="absolute inset-0 z-30 bg-black/50"
          @click="showMobileSidebar = false"
        />
      </Transition>

      <!-- Slide-out sidebar -->
      <Transition name="slide-left">
        <div
          v-if="showMobileSidebar"
          class="absolute inset-y-0 left-0 z-40 w-72 shadow-xl"
        >
          <SessionSidebar
            @new-session="handleNewSession(); showMobileSidebar = false;"
            @open-tools-settings="showToolsSettings = true; showMobileSidebar = false;"
          />
        </div>
      </Transition>

      <!-- Chat area (full width) -->
      <div class="flex h-full w-full flex-col" :class="modeClass">
        <!-- Mobile sidebar toggle -->
        <div class="flex items-center gap-2 border-b border-border bg-card/50 px-2 py-1.5">
          <Button variant="ghost" size="sm" class="h-7 w-7 p-0" @click="showMobileSidebar = true">
            <PanelLeft class="h-4 w-4" />
          </Button>
          <span class="text-xs text-muted-foreground">Sessions</span>
        </div>
        <MessageList
          class="flex-1 overflow-hidden"
          @approve-tool="(id) => respondToTool(id, true)"
          @reject-tool="(id) => respondToTool(id, false)"
        />
        <!-- Plan Review inline for mobile -->
        <div v-if="chat.isPlanReviewActive" class="max-h-[60vh] border-t border-border overflow-y-auto">
          <PlanReviewPanel
            @approve="handlePlanApprove"
            @deny="handlePlanDeny"
            @change="handlePlanChange"
          />
        </div>
        <ChatInput @send="(msg, imgs) => sendMessage(msg, imgs)" @abort="abort" />
      </div>
    </template>

    <ToolsSettingsDialog v-model:open="showToolsSettings" />
  </div>
</template>
