<script setup lang="ts">
import { computed, ref, watch, nextTick, onMounted, onUnmounted } from 'vue';
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '@/components/ui/resizable';
import { Badge } from '@/components/ui/badge';
import { Loader2, Brain, Wrench, Bot } from 'lucide-vue-next';
import { useAutopilotStore } from '@/stores/autopilot';
import { renderMarkdown, setupCodeCopyHandler } from '@/lib/markdown';
import ToolView from '@/components/chat/tools/ToolView.vue';
import type { ToolUseInfo } from '@/stores/chat';
import type { AutopilotToolCall } from '@/types/autopilot';

const store = useAutopilotStore();
const agentARef = ref<HTMLElement | null>(null);
const agentBRef = ref<HTMLElement | null>(null);

const currentCycle = computed(() => store.currentCycle);

// Auto-scroll to bottom when new content arrives
watch(
  () => currentCycle.value?.agentA.response,
  () => nextTick(() => scrollToBottom(agentARef.value)),
);
watch(
  () => currentCycle.value?.agentB.response,
  () => nextTick(() => scrollToBottom(agentBRef.value)),
);

function scrollToBottom(el: HTMLElement | null) {
  if (el) el.scrollTop = el.scrollHeight;
}

// Code copy handler (same pattern as MessageBubble)
let cleanupCopy: (() => void) | null = null;
onMounted(() => { cleanupCopy = setupCodeCopyHandler(); });
onUnmounted(() => { cleanupCopy?.(); });

function rendered(text: string): string {
  if (!text) return '';
  return renderMarkdown(text);
}

const proseClasses = 'prose prose-sm prose-neutral max-w-none dark:prose-invert prose-pre:bg-muted/60 prose-pre:border prose-pre:border-border prose-code:text-primary prose-code:before:content-none prose-code:after:content-none prose-p:leading-relaxed prose-headings:text-foreground';

function roleColor(role: string | undefined): string {
  switch (role) {
    case 'analyst': return 'text-blue-400';
    case 'architect': return 'text-purple-400';
    case 'reviewer': return 'text-amber-400';
    case 'serial_questioner': return 'text-cyan-400';
    case 'qa': return 'text-green-400';
    case 'feature_creator': return 'text-emerald-400';
    default: return 'text-muted-foreground';
  }
}

function toToolUseInfo(tc: AutopilotToolCall): ToolUseInfo {
  return { tool: tc.tool, input: tc.input, requestId: tc.requestId, status: 'approved' };
}
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- Empty state -->
    <div
      v-if="!store.currentRun"
      class="flex flex-1 items-center justify-center text-center"
    >
      <div class="max-w-sm space-y-2">
        <Bot class="mx-auto h-12 w-12 text-muted-foreground/40" />
        <p class="text-sm text-muted-foreground">
          Configure and start an Autopilot session to watch two Claude instances
          collaborate autonomously.
        </p>
      </div>
    </div>

    <!-- Dual chat panels -->
    <template v-else>
      <ResizablePanelGroup direction="horizontal" class="h-full">
        <!-- Agent A panel -->
        <ResizablePanel :default-size="50" :min-size="25">
          <div class="flex h-full flex-col border-r border-border">
            <!-- Header -->
            <div class="flex items-center gap-2 border-b border-border px-3 py-2">
              <div class="flex h-6 w-6 items-center justify-center rounded-full bg-blue-500/15">
                <Brain class="h-3.5 w-3.5 text-blue-400" />
              </div>
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2">
                  <span class="text-sm font-medium truncate">
                    {{ store.currentRun.agentAProfile.name }}
                  </span>
                  <Badge variant="outline" class="text-[10px] px-1.5 py-0" :class="roleColor(store.currentRun.agentAProfile.role)">
                    Agent A
                  </Badge>
                </div>
                <p class="text-[11px] text-muted-foreground truncate">
                  {{ store.currentRun.agentAProfile.description }}
                </p>
              </div>
              <Loader2
                v-if="store.isRunning && currentCycle?.status === 'agent_a_running'"
                class="h-4 w-4 animate-spin text-blue-400 shrink-0"
              />
            </div>

            <!-- Messages -->
            <div ref="agentARef" class="flex-1 overflow-y-auto p-3 space-y-3">
              <template v-for="cycle in store.currentRun.cycles" :key="cycle.cycleNumber">
                <!-- Cycle separator -->
                <div v-if="cycle.cycleNumber > 0" class="flex items-center gap-2 py-1">
                  <div class="flex-1 h-px bg-border" />
                  <span class="text-[10px] text-muted-foreground">Cycle {{ cycle.cycleNumber + 1 }}</span>
                  <div class="flex-1 h-px bg-border" />
                </div>

                <!-- Thinking indicator -->
                <div
                  v-if="store.isRunning && cycle.agentA.isThinking && cycle.cycleNumber === store.currentRun!.currentCycleNumber"
                  class="flex items-center gap-2 text-xs text-muted-foreground"
                >
                  <Loader2 class="h-3 w-3 animate-spin" />
                  <span>Thinking...</span>
                </div>

                <!-- Response (rendered markdown) -->
                <div
                  v-if="cycle.agentA.response"
                  :class="proseClasses"
                  v-html="rendered(cycle.agentA.response)"
                />

                <!-- Tool calls -->
                <div v-if="cycle.agentA.toolCalls.length > 0" class="space-y-1.5">
                  <ToolView
                    v-for="tc in cycle.agentA.toolCalls"
                    :key="tc.requestId"
                    :tool-use="toToolUseInfo(tc)"
                  />
                </div>
              </template>
            </div>
          </div>
        </ResizablePanel>

        <ResizableHandle />

        <!-- Agent B panel -->
        <ResizablePanel :default-size="50" :min-size="25">
          <div class="flex h-full flex-col">
            <!-- Header -->
            <div class="flex items-center gap-2 border-b border-border px-3 py-2">
              <div class="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/15">
                <Wrench class="h-3.5 w-3.5 text-emerald-400" />
              </div>
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2">
                  <span class="text-sm font-medium truncate">
                    {{ store.currentRun.agentBProfile.name }}
                  </span>
                  <Badge variant="outline" class="text-[10px] px-1.5 py-0" :class="roleColor(store.currentRun.agentBProfile.role)">
                    Agent B
                  </Badge>
                </div>
                <p class="text-[11px] text-muted-foreground truncate">
                  {{ store.currentRun.agentBProfile.description }}
                </p>
              </div>
              <Loader2
                v-if="store.isRunning && currentCycle?.status === 'agent_b_running'"
                class="h-4 w-4 animate-spin text-emerald-400 shrink-0"
              />
            </div>

            <!-- Messages -->
            <div ref="agentBRef" class="flex-1 overflow-y-auto p-3 space-y-3">
              <template v-for="cycle in store.currentRun.cycles" :key="cycle.cycleNumber">
                <!-- Cycle separator -->
                <div v-if="cycle.cycleNumber > 0" class="flex items-center gap-2 py-1">
                  <div class="flex-1 h-px bg-border" />
                  <span class="text-[10px] text-muted-foreground">Cycle {{ cycle.cycleNumber + 1 }}</span>
                  <div class="flex-1 h-px bg-border" />
                </div>

                <!-- Thinking indicator -->
                <div
                  v-if="store.isRunning && cycle.agentB.isThinking && cycle.cycleNumber === store.currentRun!.currentCycleNumber"
                  class="flex items-center gap-2 text-xs text-muted-foreground"
                >
                  <Loader2 class="h-3 w-3 animate-spin" />
                  <span>Thinking...</span>
                </div>

                <!-- Response (rendered markdown) -->
                <div
                  v-if="cycle.agentB.response"
                  :class="proseClasses"
                  v-html="rendered(cycle.agentB.response)"
                />

                <!-- Tool calls -->
                <div v-if="cycle.agentB.toolCalls.length > 0" class="space-y-1.5">
                  <ToolView
                    v-for="tc in cycle.agentB.toolCalls"
                    :key="tc.requestId"
                    :tool-use="toToolUseInfo(tc)"
                  />
                </div>

                <!-- Commit badge -->
                <div
                  v-if="cycle.commit"
                  class="flex items-center gap-2 rounded-md bg-green-500/10 border border-green-500/20 px-2.5 py-1.5 text-xs"
                >
                  <span class="font-mono text-green-400">{{ cycle.commit.hash.slice(0, 7) }}</span>
                  <span class="text-muted-foreground truncate">{{ cycle.commit.message }}</span>
                  <Badge variant="outline" class="ml-auto text-[10px] shrink-0">
                    {{ cycle.commit.filesChanged.length }} files
                  </Badge>
                </div>

                <!-- Cycle summary -->
                <div v-if="cycle.summary" class="flex items-center gap-2 py-1.5">
                  <div class="h-px flex-1 bg-gradient-to-r from-transparent via-primary/30 to-transparent" />
                  <span
                    class="text-[10px] text-muted-foreground truncate max-w-[300px]"
                    :title="cycle.summary"
                  >
                    {{ cycle.summary }}
                  </span>
                  <div class="h-px flex-1 bg-gradient-to-r from-transparent via-primary/30 to-transparent" />
                </div>
              </template>
            </div>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </template>
  </div>
</template>
