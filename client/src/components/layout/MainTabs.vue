<script setup lang="ts">
import { ref, watch, computed, onMounted, onUnmounted, defineAsyncComponent } from 'vue';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { useFilesStore } from '@/stores/files';
import { useChatStore } from '@/stores/chat';
import { useGitStore } from '@/stores/git';
import { MessageSquare, Code, GitBranch, ClipboardList, Loader2, Workflow, Bot, FolderOpen, LayoutDashboard, Network, BookOpen } from 'lucide-vue-next';
import ChatView from '@/components/chat/ChatView.vue';
import EditorTabs from '@/components/editor/EditorTabs.vue';
import DiffEditorView from '@/components/editor/DiffEditorView.vue';
import GitView from '@/components/git/GitView.vue';
import FileSidebar from '@/components/layout/FileSidebar.vue';
const MonacoEditor = defineAsyncComponent(() => import('@/components/editor/MonacoEditor.vue'));
const TaskBoard = defineAsyncComponent(() => import('@/components/tasks/TaskBoard.vue'));
const GraphEditor = defineAsyncComponent(() => import('@/components/graph/GraphEditor.vue'));
const AutopilotView = defineAsyncComponent(() => import('@/components/autopilot/AutopilotView.vue'));
const ManagementView = defineAsyncComponent(() => import('@/components/management/ManagementView.vue'));
const DiagramEditor = defineAsyncComponent(() => import('@/components/diagram/DiagramEditor.vue'));
const ManualsView = defineAsyncComponent(() => import('@/components/manuals/ManualsView.vue'));
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '@/components/ui/resizable';
import { useTasksStore } from '@/stores/tasks';
import { useGraphStore } from '@/stores/graph';
import { useAutopilotStore } from '@/stores/autopilot';
import { useManagementStore } from '@/stores/management';
import { useDiagramsStore } from '@/stores/diagrams';
import { useManualsStore } from '@/stores/manuals';

// Mobile responsive
const isMobile = ref(false);
const showMobileFileSidebar = ref(false);

function onResize() {
  isMobile.value = window.innerWidth < 768;
  if (!isMobile.value) showMobileFileSidebar.value = false;
}

onMounted(() => {
  onResize();
  window.addEventListener('resize', onResize);
});

onUnmounted(() => {
  window.removeEventListener('resize', onResize);
});

const activeTab = defineModel<string>('activeTab', { default: 'chat' });
const props = defineProps<{ splitView?: boolean }>();
const files = useFilesStore();
const chat = useChatStore();
const git = useGitStore();
const tasks = useTasksStore();
const graphStore = useGraphStore();
const autopilot = useAutopilotStore();
const managementStore = useManagementStore();
const diagramsStore = useDiagramsStore();
const manualsStore = useManualsStore();

// Auto-switch to editor when a file is opened or diff is opened
watch(() => files.activeFile, (val) => {
  if (val) activeTab.value = 'editor';
});
watch(() => files.diffData, (val) => {
  if (val) activeTab.value = 'editor';
});

const openFileCount = computed(() => files.openFiles?.length || 0);
const gitChanges = computed(() =>
  (git.staged?.length || 0) + (git.modified?.length || 0) + (git.untracked?.length || 0)
);

const tabs = [
  { value: 'chat', label: 'Chat', icon: MessageSquare },
  { value: 'editor', label: 'Editor', icon: Code },
  { value: 'git', label: 'Git', icon: GitBranch },
  { value: 'management', label: 'Management', icon: LayoutDashboard },
  { value: 'tasks', label: 'Tasks', icon: ClipboardList },
  { value: 'graph', label: 'Graph', icon: Workflow },
  { value: 'autopilot', label: 'Autopilot', icon: Bot },
  { value: 'diagrams', label: 'Diagrams', icon: Network },
  { value: 'manuals', label: 'Manuals', icon: BookOpen },
] as const;

function badgeFor(tab: string): number | null {
  if (tab === 'editor' && openFileCount.value > 0) return openFileCount.value;
  if (tab === 'git' && gitChanges.value > 0) return gitChanges.value;
  if (tab === 'tasks' && tasks.stats.total > 0) return tasks.stats.total - tasks.stats.done || null;
  if (tab === 'graph' && graphStore.nodeCount > 0) return graphStore.nodeCount;
  if (tab === 'management' && managementStore.runningCount > 0) return managementStore.runningCount;
  if (tab === 'diagrams' && diagramsStore.nodeCount > 0) return diagramsStore.nodeCount;
  if (tab === 'manuals' && manualsStore.manualCount > 0) return manualsStore.manualCount;
  return null;
}
</script>

<template>
  <Tabs v-model="activeTab" class="flex h-full flex-col">
    <!-- Custom tab bar -->
    <div class="flex min-h-[44px] sm:min-h-0 sm:h-10 items-center gap-0.5 overflow-x-auto border-b border-border bg-muted/30 px-1.5 snap-x snap-mandatory scrollbar-none">
      <TooltipProvider :delay-duration="300">
        <Tooltip v-for="tab in tabs" :key="tab.value">
          <TooltipTrigger as-child>
            <button
              class="relative flex min-h-[44px] sm:min-h-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-all duration-150 snap-start shrink-0"
              :class="[
                activeTab === tab.value
                  ? 'bg-background text-foreground shadow-sm ring-1 ring-border/60'
                  : 'text-muted-foreground hover:bg-background/50 hover:text-foreground/80',
              ]"
              @click="activeTab = tab.value"
            >
              <component
                :is="tab.icon"
                class="h-4 w-4 shrink-0"
                :class="[activeTab === tab.value ? 'text-primary' : '']"
              />
              <span class="hidden sm:inline">{{ tab.label }}</span>
              <!-- Streaming indicator for chat -->
              <Loader2
                v-if="tab.value === 'chat' && chat.isStreaming"
                class="h-3 w-3 animate-spin text-primary"
              />
              <!-- Badge for counts -->
              <span
                v-else-if="badgeFor(tab.value)"
                class="flex h-5 min-w-5 sm:h-4 sm:min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold leading-none"
                :class="[
                  activeTab === tab.value
                    ? 'bg-primary/15 text-primary'
                    : 'bg-muted text-muted-foreground',
                ]"
              >
                {{ badgeFor(tab.value) }}
              </span>
            </button>
          </TooltipTrigger>
          <TooltipContent class="sm:hidden">{{ tab.label }}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>

    <TabsContent value="chat" class="mt-0 flex-1 overflow-hidden">
      <!-- Split view: chat + editor side-by-side -->
      <template v-if="props.splitView && !isMobile">
        <ResizablePanelGroup direction="horizontal">
          <ResizablePanel :default-size="50" :min-size="25">
            <ChatView />
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel :default-size="50" :min-size="25">
            <div class="flex h-full min-h-0 flex-col">
              <DiffEditorView v-if="files.diffData" />
              <template v-else>
                <EditorTabs />
                <MonacoEditor v-if="files.openFiles.length > 0" class="min-h-0 flex-1" />
                <div v-else class="flex flex-1 items-center justify-center text-muted-foreground">
                  <p class="text-sm">Open a file to see it here</p>
                </div>
              </template>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </template>
      <ChatView v-else />
    </TabsContent>
    <TabsContent value="editor" class="mt-0 flex-1 overflow-hidden">
      <!-- Desktop: side-by-side file sidebar + editor -->
      <template v-if="!isMobile">
        <ResizablePanelGroup direction="horizontal">
          <ResizablePanel :default-size="20" :min-size="15" :max-size="40">
            <FileSidebar />
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel :default-size="80" :min-size="40">
            <DiffEditorView v-if="files.diffData" />
            <div v-else class="flex h-full min-h-0 flex-col">
              <EditorTabs />
              <MonacoEditor class="min-h-0 flex-1" />
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </template>
      <!-- Mobile: full-width editor + overlay file sidebar -->
      <template v-else>
        <div class="relative flex h-full flex-col">
          <!-- Backdrop + sidebar overlay (absolute, within tab content) -->
          <Transition name="fade">
            <div v-if="showMobileFileSidebar" class="absolute inset-0 z-30 bg-black/50" @click="showMobileFileSidebar = false" />
          </Transition>
          <Transition name="slide-left">
            <div v-if="showMobileFileSidebar" class="absolute inset-y-0 left-0 z-40 w-[85vw] max-w-72 bg-background shadow-xl">
              <FileSidebar />
            </div>
          </Transition>

          <DiffEditorView v-if="files.diffData" />
          <div v-else class="flex h-full min-h-0 flex-col">
            <div class="flex items-center border-b border-border">
              <Button variant="ghost" size="sm" class="h-8 w-8 shrink-0 p-0 ml-1" aria-label="Open file sidebar" @click="showMobileFileSidebar = true">
                <FolderOpen class="h-4 w-4" />
              </Button>
              <EditorTabs class="flex-1" />
            </div>
            <MonacoEditor class="min-h-0 flex-1" />
          </div>
        </div>
      </template>
    </TabsContent>
    <TabsContent value="git" class="mt-0 flex-1 overflow-hidden">
      <GitView />
    </TabsContent>
    <TabsContent value="tasks" class="mt-0 flex-1 overflow-hidden">
      <TaskBoard />
    </TabsContent>
    <TabsContent value="graph" class="mt-0 flex-1 overflow-hidden" :force-mount="true"
      :style="{ display: activeTab === 'graph' ? undefined : 'none' }"
    >
      <GraphEditor />
    </TabsContent>
    <TabsContent value="autopilot" class="mt-0 flex-1 overflow-hidden">
      <AutopilotView />
    </TabsContent>
    <TabsContent value="management" class="mt-0 flex-1 overflow-hidden">
      <ManagementView />
    </TabsContent>
    <TabsContent value="diagrams" class="mt-0 flex-1 overflow-hidden" :force-mount="true"
      :style="{ display: activeTab === 'diagrams' ? undefined : 'none' }"
    >
      <DiagramEditor />
    </TabsContent>
    <TabsContent value="manuals" class="mt-0 flex-1 overflow-hidden">
      <ManualsView />
    </TabsContent>
  </Tabs>
</template>
