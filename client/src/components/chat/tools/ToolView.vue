<script setup lang="ts">
import type { ToolUseInfo } from '@/stores/chat';
import ToolBash from './ToolBash.vue';
import ToolEdit from './ToolEdit.vue';
import ToolRead from './ToolRead.vue';
import ToolWrite from './ToolWrite.vue';
import ToolGrepGlob from './ToolGrepGlob.vue';
import ToolTodoWrite from './ToolTodoWrite.vue';
import ToolDefault from './ToolDefault.vue';

defineProps<{ toolUse: ToolUseInfo }>();

const TOOL_COMPONENTS: Record<string, unknown> = {
  Bash: ToolBash,
  Edit: ToolEdit,
  MultiEdit: ToolEdit,
  Read: ToolRead,
  Write: ToolWrite,
  Grep: ToolGrepGlob,
  Glob: ToolGrepGlob,
  TodoWrite: ToolTodoWrite,
};
</script>

<template>
  <component
    :is="(TOOL_COMPONENTS[toolUse.tool] as any) || ToolDefault"
    :tool-use="toolUse"
  />
</template>
