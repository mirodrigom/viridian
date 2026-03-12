<script setup lang="ts">
import { ref } from 'vue';
import { useFilesStore } from '@/stores/files';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { RefreshCw, Wand2 } from 'lucide-vue-next';
import FileTree from '@/components/files/FileTree.vue';
import FileAutomationDialog from '@/components/files/FileAutomationDialog.vue';

const files = useFilesStore();
const showAutomation = ref(false);
</script>

<template>
  <div class="flex h-full flex-col border-r border-border bg-background">
    <div class="flex h-9 items-center justify-between border-b border-border px-3">
      <span class="text-xs font-medium uppercase tracking-wider text-muted-foreground">Explorer</span>
      <div class="flex items-center gap-0.5">
        <TooltipProvider :delay-duration="300">
          <Tooltip>
            <TooltipTrigger as-child>
              <Button variant="ghost" size="sm" class="h-6 w-6 p-0" @click="showAutomation = true">
                <Wand2 class="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>File Tools</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <Button variant="ghost" size="sm" class="h-6 w-6 p-0" @click="files.fetchTree(files.rootPath)">
          <RefreshCw class="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
    <FileTree class="flex-1" />
    <FileAutomationDialog v-model:open="showAutomation" />
  </div>
</template>
