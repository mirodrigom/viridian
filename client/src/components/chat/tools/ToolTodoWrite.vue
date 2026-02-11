<script setup lang="ts">
import { computed } from 'vue';
import type { ToolUseInfo } from '@/stores/chat';
import { Check, Circle, Loader2 } from 'lucide-vue-next';

const props = defineProps<{ toolUse: ToolUseInfo }>();

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
</script>

<template>
  <div v-if="todos.length" class="overflow-hidden rounded-md border border-border">
    <div
      v-for="(todo, i) in todos"
      :key="i"
      class="flex items-start gap-2 border-b border-border px-3 py-1.5 last:border-b-0"
      :class="{
        'bg-muted/10': todo.status === 'pending',
        'bg-primary/5': todo.status === 'in_progress',
        'bg-green-500/5': todo.status === 'completed',
      }"
    >
      <div class="mt-0.5 shrink-0">
        <Check v-if="todo.status === 'completed'" class="h-3.5 w-3.5 text-green-500" />
        <Loader2 v-else-if="todo.status === 'in_progress'" class="h-3.5 w-3.5 animate-spin text-primary" />
        <Circle v-else class="h-3.5 w-3.5 text-muted-foreground/50" />
      </div>
      <span
        class="text-xs"
        :class="{
          'text-muted-foreground': todo.status === 'pending',
          'font-medium text-foreground': todo.status === 'in_progress',
          'text-foreground line-through opacity-70': todo.status === 'completed',
        }"
      >
        {{ todo.status === 'in_progress' && todo.activeForm ? todo.activeForm : todo.content }}
      </span>
    </div>
  </div>
  <div v-else-if="toolUse.isInputStreaming" class="rounded-md border border-border bg-muted/20 px-3 py-2">
    <span class="inline-block h-3 w-1 animate-pulse rounded-sm bg-primary" />
  </div>
</template>
