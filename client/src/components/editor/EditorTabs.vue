<script setup lang="ts">
import { useFilesStore } from '@/stores/files';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

const files = useFilesStore();

function handleClose(e: Event, path: string) {
  e.stopPropagation();
  files.closeFile(path);
}
</script>

<template>
  <div v-if="files.openFiles.length > 0" class="flex items-center gap-0 overflow-x-auto border-b border-border bg-muted/30">
    <button
      v-for="file in files.openFiles"
      :key="file.path"
      class="flex shrink-0 items-center gap-1.5 border-r border-border px-3 py-1.5 text-sm transition-colors"
      :class="files.activeFile === file.path ? 'bg-background text-foreground' : 'text-muted-foreground hover:bg-background/50'"
      @click="files.activeFile = file.path"
    >
      <span v-if="file.modified" class="h-1.5 w-1.5 rounded-full bg-primary" />
      <span class="truncate max-w-32">{{ file.name }}</span>
      <button
        class="ml-1 rounded-sm p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        @click="(e) => handleClose(e, file.path)"
      >
        ✕
      </button>
    </button>
  </div>
</template>
