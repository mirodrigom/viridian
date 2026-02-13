<script setup lang="ts">
import { computed } from 'vue';
import { Brain, Shield, Wrench, Code, Search, HelpCircle, User } from 'lucide-vue-next';
import type { AutopilotProfile } from '@/types/autopilot';

const props = defineProps<{
  profile: AutopilotProfile;
  selected: boolean;
}>();

const emit = defineEmits<{
  select: [];
}>();

const roleIcon = computed(() => {
  switch (props.profile.role) {
    case 'analyst': return Brain;
    case 'architect': return Shield;
    case 'qa': return Search;
    case 'feature_creator': return Code;
    case 'reviewer': return Wrench;
    case 'serial_questioner': return HelpCircle;
    default: return User;
  }
});

const roleColor = computed(() => {
  switch (props.profile.role) {
    case 'analyst': return 'text-blue-400 bg-blue-500/15';
    case 'architect': return 'text-purple-400 bg-purple-500/15';
    case 'qa': return 'text-green-400 bg-green-500/15';
    case 'feature_creator': return 'text-emerald-400 bg-emerald-500/15';
    case 'reviewer': return 'text-amber-400 bg-amber-500/15';
    case 'serial_questioner': return 'text-cyan-400 bg-cyan-500/15';
    default: return 'text-muted-foreground bg-muted';
  }
});

const hasWriteTools = computed(() => {
  const writeTools = ['Write', 'Edit', 'Bash'];
  return props.profile.allowedTools.some(t => writeTools.includes(t));
});
</script>

<template>
  <button
    class="flex items-start gap-3 rounded-lg border p-3 text-left transition-all"
    :class="[
      selected
        ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
        : 'border-border hover:border-border/80 hover:bg-muted/30',
    ]"
    @click="emit('select')"
  >
    <div
      class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
      :class="roleColor"
    >
      <component :is="roleIcon" class="h-4 w-4" />
    </div>

    <div class="min-w-0 flex-1">
      <div class="flex items-center gap-2">
        <span class="text-sm font-medium">{{ profile.name }}</span>
        <span
          v-if="hasWriteTools"
          class="rounded bg-emerald-500/15 px-1 text-[10px] text-emerald-400"
        >
          executor
        </span>
        <span
          v-else
          class="rounded bg-blue-500/15 px-1 text-[10px] text-blue-400"
        >
          thinker
        </span>
      </div>
      <p class="mt-0.5 text-xs text-muted-foreground line-clamp-2">
        {{ profile.description }}
      </p>
    </div>
  </button>
</template>
