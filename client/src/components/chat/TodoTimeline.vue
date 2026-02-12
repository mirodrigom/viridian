<script setup lang="ts">
import { computed } from 'vue';
import { useChatStore } from '@/stores/chat';
import { Check, Circle, Loader2, ListTodo } from 'lucide-vue-next';

const chat = useChatStore();

const todos = computed(() => chat.latestTodos);
const completedCount = computed(() => todos.value.filter(t => t.status === 'completed').length);
const totalCount = computed(() => todos.value.length);
const progressPercent = computed(() => totalCount.value === 0 ? 0 : Math.round((completedCount.value / totalCount.value) * 100));
</script>

<template>
  <div class="flex h-full flex-col bg-card/50">
    <!-- Header -->
    <div class="flex items-center gap-2 border-b border-border px-3 py-2.5">
      <ListTodo class="h-4 w-4 text-primary" />
      <span class="text-xs font-semibold text-foreground">Tasks</span>
      <span v-if="totalCount" class="ml-auto text-[10px] tabular-nums text-muted-foreground">
        {{ completedCount }}/{{ totalCount }}
      </span>
    </div>

    <!-- Progress bar -->
    <div v-if="totalCount" class="px-3 pt-2.5 pb-1">
      <div class="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          class="h-full rounded-full bg-primary transition-all duration-500 ease-out"
          :style="{ width: `${progressPercent}%` }"
        />
      </div>
      <p class="mt-1 text-right text-[10px] tabular-nums text-muted-foreground">{{ progressPercent }}%</p>
    </div>

    <!-- Timeline -->
    <div v-if="totalCount" class="flex-1 overflow-y-auto px-3 pb-3">
      <div class="relative">
        <!-- Vertical line -->
        <div class="absolute left-[7px] top-2 bottom-2 w-px bg-border" />

        <div
          v-for="(todo, i) in todos"
          :key="i"
          class="relative flex items-start gap-3 py-1.5"
        >
          <!-- Node -->
          <div class="relative z-10 mt-0.5 flex h-[15px] w-[15px] shrink-0 items-center justify-center">
            <div
              v-if="todo.status === 'completed'"
              class="flex h-[15px] w-[15px] items-center justify-center rounded-full bg-green-500"
            >
              <Check class="h-2.5 w-2.5 text-white" />
            </div>
            <div
              v-else-if="todo.status === 'in_progress'"
              class="flex h-[15px] w-[15px] items-center justify-center rounded-full border-2 border-primary bg-card"
            >
              <Loader2 class="h-2.5 w-2.5 animate-spin text-primary" />
            </div>
            <div
              v-else
              class="h-[9px] w-[9px] rounded-full border-2 border-muted-foreground/40 bg-card"
              style="margin: 3px"
            />
          </div>

          <!-- Label -->
          <span
            class="text-xs leading-snug"
            :class="{
              'text-muted-foreground/60': todo.status === 'pending',
              'font-medium text-foreground': todo.status === 'in_progress',
              'text-muted-foreground line-through': todo.status === 'completed',
            }"
          >
            {{ todo.status === 'in_progress' && todo.activeForm ? todo.activeForm : todo.content }}
          </span>
        </div>
      </div>
    </div>

    <!-- Empty state -->
    <div v-else class="flex flex-1 items-center justify-center p-4">
      <p class="text-center text-xs text-muted-foreground/50">
        No tasks yet
      </p>
    </div>
  </div>
</template>
