<script setup lang="ts">
import { watch, computed } from 'vue';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { useFilesStore } from '@/stores/files';
import { useChatStore } from '@/stores/chat';
import { useGitStore } from '@/stores/git';
import { MessageSquare, Code, GitBranch, ClipboardList, Loader2 } from 'lucide-vue-next';
import ChatView from '@/components/chat/ChatView.vue';
import EditorTabs from '@/components/editor/EditorTabs.vue';
import EditorView from '@/components/editor/EditorView.vue';
import DiffEditorView from '@/components/editor/DiffEditorView.vue';
import GitView from '@/components/git/GitView.vue';
import TaskBoard from '@/components/tasks/TaskBoard.vue';
import { useTasksStore } from '@/stores/tasks';

const activeTab = defineModel<string>('activeTab', { default: 'chat' });
const files = useFilesStore();
const chat = useChatStore();
const git = useGitStore();
const tasks = useTasksStore();

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
  { value: 'tasks', label: 'Tasks', icon: ClipboardList },
] as const;

function badgeFor(tab: string): number | null {
  if (tab === 'editor' && openFileCount.value > 0) return openFileCount.value;
  if (tab === 'git' && gitChanges.value > 0) return gitChanges.value;
  if (tab === 'tasks' && tasks.stats.total > 0) return tasks.stats.total - tasks.stats.done || null;
  return null;
}
</script>

<template>
  <Tabs v-model="activeTab" class="flex h-full flex-col">
    <!-- Custom tab bar -->
    <div class="flex h-10 items-center gap-0.5 border-b border-border bg-muted/30 px-1.5">
      <button
        v-for="tab in tabs"
        :key="tab.value"
        class="relative flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-all duration-150"
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
        <span>{{ tab.label }}</span>
        <!-- Streaming indicator for chat -->
        <Loader2
          v-if="tab.value === 'chat' && chat.isStreaming"
          class="h-3 w-3 animate-spin text-primary"
        />
        <!-- Badge for counts -->
        <span
          v-else-if="badgeFor(tab.value)"
          class="flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold leading-none"
          :class="[
            activeTab === tab.value
              ? 'bg-primary/15 text-primary'
              : 'bg-muted text-muted-foreground',
          ]"
        >
          {{ badgeFor(tab.value) }}
        </span>
      </button>
    </div>

    <TabsContent value="chat" class="mt-0 flex-1 overflow-hidden">
      <ChatView />
    </TabsContent>
    <TabsContent value="editor" class="mt-0 flex-1 overflow-hidden">
      <DiffEditorView v-if="files.diffData" />
      <div v-else class="flex h-full flex-col">
        <EditorTabs />
        <EditorView class="flex-1" />
      </div>
    </TabsContent>
    <TabsContent value="git" class="mt-0 flex-1 overflow-hidden">
      <GitView />
    </TabsContent>
    <TabsContent value="tasks" class="mt-0 flex-1 overflow-hidden">
      <TaskBoard />
    </TabsContent>
  </Tabs>
</template>
