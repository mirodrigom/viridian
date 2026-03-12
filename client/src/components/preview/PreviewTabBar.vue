<script setup lang="ts">
import { usePreviewStore, type PreviewTab } from '@/stores/preview';
import { Button } from '@/components/ui/button';
import { RefreshCw, X } from 'lucide-vue-next';
import {
  FileText, FileCode, Image, Globe, Network, FileType,
} from 'lucide-vue-next';

const preview = usePreviewStore();

function getIcon(tab: PreviewTab) {
  switch (tab.fileType) {
    case 'markdown': return FileText;
    case 'html': return Globe;
    case 'mermaid': return Network;
    case 'image': return Image;
    case 'pdf': return FileType;
    case 'code': return FileCode;
    default: return FileCode;
  }
}

function handleClose(e: Event, tabId: string) {
  e.stopPropagation();
  preview.closeTab(tabId);
}

function handleRefresh(e: Event, tabId: string) {
  e.stopPropagation();
  preview.refreshTab(tabId);
}
</script>

<template>
  <div
    v-if="preview.tabs.length > 0"
    class="flex shrink-0 items-center gap-0 overflow-x-auto border-b border-border bg-muted/30"
  >
    <button
      v-for="tab in preview.tabs"
      :key="tab.id"
      class="group flex shrink-0 items-center gap-1.5 border-r border-border px-3 py-1.5 text-sm transition-colors duration-150"
      :class="
        preview.activeTabId === tab.id
          ? 'bg-background text-foreground'
          : 'text-muted-foreground hover:bg-background/50 hover:text-foreground'
      "
      @click="preview.setActiveTab(tab.id)"
      @mousedown.middle.prevent="preview.closeTab(tab.id)"
    >
      <component :is="getIcon(tab)" class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span class="max-w-32 truncate">{{ tab.name }}</span>
      <button
        class="ml-1 rounded-sm p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100"
        title="Refresh"
        @click="(e) => handleRefresh(e, tab.id)"
      >
        <RefreshCw class="h-2.5 w-2.5" />
      </button>
      <button
        class="rounded-sm p-0.5 text-muted-foreground opacity-60 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100"
        aria-label="Close tab"
        @click="(e) => handleClose(e, tab.id)"
      >
        <X class="h-3 w-3" />
      </button>
    </button>
  </div>
</template>
