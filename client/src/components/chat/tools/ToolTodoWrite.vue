<script setup lang="ts">
import { computed } from 'vue';
import { useChatStore, type ToolUseInfo } from '@/stores/chat';
import { Check, Circle, Loader2 } from 'lucide-vue-next';

const props = defineProps<{ toolUse: ToolUseInfo }>();
const chat = useChatStore();

interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  activeForm?: string;
}

const todos = computed((): TodoItem[] => {
  const t = props.toolUse.input.todos;
  if (!Array.isArray(t)) return [];
  return t as TodoItem[];
});

const completedCount = computed(() => todos.value.filter(t => t.status === 'completed').length);
const inProgressCount = computed(() => todos.value.filter(t => t.status === 'in_progress').length);
const pendingCount = computed(() => todos.value.filter(t => t.status === 'pending').length);

const inProgressTask = computed(() => todos.value.find(t => t.status === 'in_progress'));
</script>

<template>
  <!-- Compact inline summary — full timeline is in the right panel -->
  <div v-if="todos.length" class="flex items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground">
    <div class="flex items-center gap-1.5">
      <span v-if="completedCount" class="flex items-center gap-0.5 rounded bg-green-500/15 px-1.5 py-0.5 text-[10px] text-green-400">
        <Check class="h-2.5 w-2.5" />{{ completedCount }}
      </span>
      <span v-if="inProgressCount" class="flex items-center gap-0.5 rounded bg-primary/15 px-1.5 py-0.5 text-[10px] text-primary">
        <Loader2 class="h-2.5 w-2.5 animate-spin" />{{ inProgressCount }}
      </span>
      <span v-if="pendingCount" class="flex items-center gap-0.5 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
        <Circle class="h-2.5 w-2.5" />{{ pendingCount }}
      </span>
    </div>
    <span v-if="inProgressTask" class="truncate text-foreground/70">
      {{ inProgressTask.activeForm || inProgressTask.content }}
    </span>
  </div>

  <div v-else-if="toolUse.isInputStreaming" class="px-3 py-2">
    <span class="inline-block h-3 w-1 animate-pulse rounded-sm bg-primary" />
  </div>
</template>
