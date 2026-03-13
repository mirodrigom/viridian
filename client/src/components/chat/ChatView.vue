<script setup lang="ts">
import { ref, computed, provide, inject, watch, onMounted, onUnmounted, type Ref } from 'vue';
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
import TracesPanel from './TracesPanel.vue';
import { PanelLeft, PanelLeftClose, PanelRight, PanelRightClose, Loader2, Plus } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import { useModeTheme } from '@/composables/useModeTheme';
import { usePersonasStore } from '@/stores/personas';
import { useRouter } from 'vue-router';
import { toast } from 'vue-sonner';

const chat = useChatStore();
const personaStore = usePersonasStore();
const router = useRouter();
const { modeClass } = useModeTheme();
const { init, sendMessage, sendSilentMessage, respondToTool, abort } = useClaudeStream();
provide('respondToTool', respondToTool);
provide('sendSilentMessage', sendSilentMessage);
const openToolsSettings = inject<() => void>('openToolsSettings', () => {});
const activateGlobalMic = inject<() => void>('activateGlobalMic', () => {});
const registerChatTranscriptHandler = inject<(handler: (text: string, mode: string) => void) => void>('registerChatTranscriptHandler', () => {});
const showMobileSidebar = ref(false);
const showSidebar = ref(false);
const chatInputRef = ref<InstanceType<typeof ChatInput> | null>(null);
const chatInputMobileRef = ref<InstanceType<typeof ChatInput> | null>(null);

// Register handler so AppLayout can forward voice transcripts to this chat
registerChatTranscriptHandler((text: string, mode: string) => {
  if (mode === 'voice-send') {
    sendMessage(text);
    return;
  }
  const inputRef = isMobile.value ? chatInputMobileRef.value : chatInputRef.value;
  inputRef?.handleVoiceTranscript(text, mode);
});

function activateMic() {
  activateGlobalMic();
}
const showTracesSidebar = ref(localStorage.getItem('traces-panel-open') !== 'false');
const isMobile = ref(false);

// Persist traces sidebar state
watch(showTracesSidebar, (val) => {
  localStorage.setItem('traces-panel-open', String(val));
});

// Auto-expand traces when Claude starts responding (only if not explicitly closed)
watch(() => chat.isStreaming, (streaming) => {
  if (streaming && localStorage.getItem('traces-panel-open') !== 'false') {
    showTracesSidebar.value = true;
  }
});

function handleNewSession() {
  if (chat.isStreaming) abort();
  chat.clearMessages();
  router.replace({ name: 'project' });
}

const hasTodos = computed(() => chat.latestTodos.length > 0);
const hasSecondPanel = computed(() => chat.isPlanReviewActive || hasTodos.value);

function handlePlanApprove() {
  const requestId = chat.planReviewRequestId;
  chat.dismissPlanReview();
  // Mark the ExitPlanMode tool as approved visually
  if (requestId) {
    const msg = chat.messages.find(m => m.toolUse?.requestId === requestId);
    if (msg?.toolUse) msg.toolUse.status = 'approved';
  }
  // Always send a visible user message — starts a new --resume stream so
  // Claude knows the plan was approved and continues with implementation.
  sendMessage('Proceed with the plan.');
}

function handlePlanDeny() {
  const requestId = chat.planReviewRequestId;
  chat.dismissPlanReview();
  if (requestId) {
    const msg = chat.messages.find(m => m.toolUse?.requestId === requestId);
    if (msg?.toolUse) msg.toolUse.status = 'rejected';
  }
  sendMessage('Cancel this plan. Do not proceed.');
}

function handlePlanChange(feedback: string) {
  const requestId = chat.planReviewRequestId;
  chat.dismissPlanReview();
  if (requestId) {
    const msg = chat.messages.find(m => m.toolUse?.requestId === requestId);
    if (msg?.toolUse) msg.toolUse.status = 'rejected';
  }
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
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
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
          <div class="flex flex-col items-center gap-1">
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
        </div>

        <!-- Expanded: full sidebar -->
        <div v-else class="h-full w-[280px]">
          <SessionSidebar
            @new-session="handleNewSession"
            @open-tools-settings="openToolsSettings"
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

      <!-- Chat + optional second panel (todos / plan review) -->
      <ResizablePanelGroup
        :key="chat.isPlanReviewActive ? 'plan' : hasTodos ? 'todos' : 'chat'"
        direction="horizontal"
        class="min-w-0 flex-1"
      >
        <!-- Main chat area -->
        <ResizablePanel :default-size="hasSecondPanel ? 70 : 100" :min-size="40">
          <div class="relative flex h-full flex-col" :class="modeClass">
            <MessageList
              class="flex-1 overflow-hidden"
              @approve-tool="(id) => respondToTool(id, true)"
              @reject-tool="(id) => respondToTool(id, false)"
              @send-prompt="(text) => sendMessage(text)"
            />
            <ChatInput ref="chatInputRef" @send="(msg, imgs) => sendMessage(msg, imgs)" @abort="abort" @activate-mic="activateMic" />
          </div>
        </ResizablePanel>

        <!-- Second panel: Plan Review or Todos (when active) -->
        <template v-if="chat.isPlanReviewActive">
          <ResizableHandle />
          <ResizablePanel :default-size="30" :min-size="15" :max-size="45">
            <PlanReviewPanel
              @approve="handlePlanApprove"
              @deny="handlePlanDeny"
              @change="handlePlanChange"
            />
          </ResizablePanel>
        </template>
        <template v-else-if="hasTodos">
          <ResizableHandle />
          <ResizablePanel :default-size="30" :min-size="12" :max-size="40">
            <TodoTimeline />
          </ResizablePanel>
        </template>
      </ResizablePanelGroup>

      <!-- Traces sidebar: always present, collapsible -->
      <div
        class="sidebar-slide relative shrink-0 overflow-hidden border-l border-border bg-card/50"
        :class="showTracesSidebar ? 'w-[300px]' : 'w-9'"
      >
        <!-- Collapsed: toggle button -->
        <div
          v-if="!showTracesSidebar"
          class="flex h-full w-9 flex-col items-center justify-start py-2"
        >
          <Button
            variant="ghost"
            size="sm"
            class="h-7 w-7 p-0"
            title="Show traces"
            @click="showTracesSidebar = true"
          >
            <PanelRight class="h-4 w-4" />
          </Button>
        </div>

        <!-- Expanded: full traces panel -->
        <div v-else class="h-full w-[300px]">
          <TracesPanel :session-id="chat.claudeSessionId ?? undefined">
            <template #header-action>
              <Button
                variant="ghost"
                size="sm"
                class="h-5 w-5 p-0 text-muted-foreground"
                title="Hide traces"
                @click="showTracesSidebar = false"
              >
                <PanelRightClose class="h-3.5 w-3.5" />
              </Button>
            </template>
          </TracesPanel>
        </div>
      </div>
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
            @open-tools-settings="openToolsSettings(); showMobileSidebar = false;"
          />
        </div>
      </Transition>

      <!-- Chat area (full width) -->
      <div class="relative flex h-full w-full flex-col" :class="modeClass">
        <!-- Mobile header bar -->
        <div class="flex items-center gap-2 border-b border-border bg-card/50 px-2 py-1.5">
          <Button variant="ghost" size="sm" class="h-9 w-9 shrink-0 p-0" @click="showMobileSidebar = true">
            <PanelLeft class="h-4 w-4" />
          </Button>
          <span class="flex-1 truncate text-xs text-muted-foreground">{{ mobileSessionTitle }}</span>
          <span
            v-if="personaStore.activePersona"
            class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium shrink-0"
            :style="{ backgroundColor: personaStore.activePersona.color + '18', color: personaStore.activePersona.color }"
          >
            {{ personaStore.activePersona.name }}
          </span>
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
        <ChatInput ref="chatInputMobileRef" @send="(msg, imgs) => sendMessage(msg, imgs)" @abort="abort" @activate-mic="activateMic" />
      </div>
    </template>

  </div>
</template>
