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
import { PanelLeft, PanelLeftClose, Loader2, Plus } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import { useModeTheme } from '@/composables/useModeTheme';
import { useRouter } from 'vue-router';

const chat = useChatStore();
const router = useRouter();
const { modeClass } = useModeTheme();
const { init, sendMessage, respondToTool, abort } = useClaudeStream();
provide('respondToTool', respondToTool);
const showToolsSettings = ref(false);
const showMobileSidebar = ref(false);
const showSidebar = ref(false);
const isMobile = ref(false);

function handleNewSession() {
  if (chat.isStreaming) abort();
  chat.clearMessages();
  router.replace({ name: 'project' });
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

// Session title for mobile header (first user message, truncated)
const mobileSessionTitle = computed(() => {
  const firstUser = chat.messages.find(m => m.role === 'user');
  if (!firstUser?.content) return 'New Session';
  return firstUser.content.slice(0, 50);
});

// Swipe-to-close for mobile sidebar
const touchStartX = ref(0);
function handleSidebarTouchStart(e: TouchEvent) {
  touchStartX.value = e.touches[0].clientX;
}
function handleSidebarTouchEnd(e: TouchEvent) {
  const deltaX = e.changedTouches[0].clientX - touchStartX.value;
  if (deltaX < -60) {
    showMobileSidebar.value = false;
  }
}

defineExpose({ showToolsSettings });
</script>

<template>
  <div class="relative flex h-full">
    <!-- Desktop: collapsible sidebar + resizable right panels -->
    <template v-if="!isMobile">
      <!-- Single sidebar container: slides between 36px (collapsed) and 280px (expanded) -->
      <div
        class="sidebar-slide relative shrink-0 overflow-hidden border-r border-border bg-card/50"
        :class="showSidebar ? 'w-[280px]' : 'w-9'"
      >
        <!-- Collapsed: toggle button -->
        <div
          v-if="!showSidebar"
          class="flex h-full w-9 flex-col items-center justify-between py-2"
        >
          <Button
            variant="ghost"
            size="sm"
            class="h-7 w-7 p-0"
            title="Show sessions"
            @click="showSidebar = true"
          >
            <PanelLeft class="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            class="h-7 w-7 p-0"
            title="New session"
            @click="handleNewSession"
          >
            <Plus class="h-4 w-4" />
          </Button>
        </div>

        <!-- Expanded: full sidebar -->
        <div v-else class="h-full w-[280px]">
          <SessionSidebar
            @new-session="handleNewSession"
            @open-tools-settings="showToolsSettings = true"
          >
            <template #header-action>
              <Button
                variant="ghost"
                size="sm"
                class="h-6 w-6 shrink-0 p-0"
                title="Hide sessions"
                @click="showSidebar = false"
              >
                <PanelLeftClose class="h-3.5 w-3.5" />
              </Button>
            </template>
          </SessionSidebar>
        </div>
      </div>

      <!-- Chat + right panels -->
      <ResizablePanelGroup
        :key="chat.isPlanReviewActive ? 'plan' : hasTodos ? 'todos' : 'chat'"
        direction="horizontal"
        class="min-w-0 flex-1"
      >
        <ResizablePanel :default-size="hasRightPanel ? 80 : 100" :min-size="40">
          <div class="flex h-full flex-col" :class="modeClass">
            <MessageList
              class="flex-1 overflow-hidden"
              @approve-tool="(id) => respondToTool(id, true)"
              @reject-tool="(id) => respondToTool(id, false)"
              @send-prompt="(text) => sendMessage(text)"
            />
            <ChatInput @send="(msg, imgs) => sendMessage(msg, imgs)" @abort="abort" />
          </div>
        </ResizablePanel>
        <template v-if="chat.isPlanReviewActive">
          <ResizableHandle />
          <ResizablePanel :default-size="20" :min-size="18" :max-size="40">
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
    </template>

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
          class="absolute inset-y-0 left-0 z-40 w-[85vw] max-w-72 bg-background shadow-xl"
          @touchstart.passive="handleSidebarTouchStart"
          @touchend.passive="handleSidebarTouchEnd"
        >
          <SessionSidebar
            @new-session="handleNewSession(); showMobileSidebar = false;"
            @open-tools-settings="showToolsSettings = true; showMobileSidebar = false;"
          />
        </div>
      </Transition>

      <!-- Chat area (full width) -->
      <div class="flex h-full w-full flex-col" :class="modeClass">
        <!-- Mobile header bar -->
        <div class="flex items-center gap-2 border-b border-border bg-card/50 px-2 py-1.5">
          <Button variant="ghost" size="sm" class="h-9 w-9 shrink-0 p-0" @click="showMobileSidebar = true">
            <PanelLeft class="h-4 w-4" />
          </Button>
          <span class="flex-1 truncate text-xs text-muted-foreground">{{ mobileSessionTitle }}</span>
          <Loader2 v-if="chat.isStreaming" class="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
        </div>
        <MessageList
          class="flex-1 overflow-hidden"
          @approve-tool="(id) => respondToTool(id, true)"
          @reject-tool="(id) => respondToTool(id, false)"
          @send-prompt="(text) => sendMessage(text)"
        />
        <!-- Plan Review inline for mobile -->
        <div v-if="chat.isPlanReviewActive" class="max-h-[35dvh] sm:max-h-[60vh] border-t border-border overflow-y-auto">
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
