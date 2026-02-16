<script setup lang="ts">
import { useFilesStore } from '@/stores/files';

const files = useFilesStore();

function handleClose(e: Event, path: string) {
  e.stopPropagation();
  files.closeFile(path);
}
</script>

<template>
  <div v-if="files.openFiles.length > 0" class="flex shrink-0 items-center gap-0 overflow-x-auto border-b border-border bg-muted/30">
    <button
      v-for="file in files.openFiles"
      :key="file.path"
      class="group flex shrink-0 items-center gap-1.5 border-r border-border px-3 py-1.5 text-sm transition-colors duration-150"
      :class="files.activeFile === file.path ? 'bg-background text-foreground' : 'text-muted-foreground hover:bg-background/50 hover:text-foreground'"
      @click="files.activeFile = file.path"
    >
      <span v-if="file.modified" class="h-1.5 w-1.5 rounded-full bg-primary dirty-pulse" />
      <span class="truncate max-w-32">{{ file.name }}</span>
      <button
        class="ml-1 rounded-sm p-0.5 text-muted-foreground opacity-60 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100"
        aria-label="Close tab"
        @click="(e) => handleClose(e, file.path)"
      >
        ✕
      </button>
    </button>
  </div>
</template>
