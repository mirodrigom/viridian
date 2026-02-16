<script setup lang="ts">
import { useFilesStore } from '@/stores/files';
import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-vue-next';
import FileTree from '@/components/files/FileTree.vue';

const files = useFilesStore();
</script>

<template>
  <div class="flex h-full flex-col border-r border-border bg-background">
    <div class="flex h-9 items-center justify-between border-b border-border px-3">
      <span class="text-xs font-medium uppercase tracking-wider text-muted-foreground">Explorer</span>
      <Button variant="ghost" size="sm" class="h-6 w-6 p-0" @click="files.fetchTree(files.rootPath)">
        <RefreshCw class="h-3.5 w-3.5" />
      </Button>
    </div>
    <FileTree class="flex-1" />
  </div>
</template>
