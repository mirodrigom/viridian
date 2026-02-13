<script setup lang="ts">
import { onMounted } from 'vue';
import { useFilesStore, type FileNode } from '@/stores/files';
import { useChatStore } from '@/stores/chat';
import { TreeRoot, TreeItem } from 'reka-ui';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  ChevronRight, File, Folder, FolderOpen,
  FileCode, FileJson, FileText, Image,
} from 'lucide-vue-next';

const files = useFilesStore();
const chat = useChatStore();

onMounted(() => {
  if (chat.projectPath) {
    files.fetchTree(chat.projectPath);
  }
});

const codeExts = new Set(['ts', 'tsx', 'js', 'jsx', 'vue', 'py', 'rs', 'go', 'java', 'c', 'cpp', 'h', 'rb', 'php', 'swift', 'kt', 'sh', 'bash', 'css', 'scss', 'html']);
const jsonExts = new Set(['json', 'jsonc', 'json5']);
const textExts = new Set(['md', 'txt', 'log', 'csv', 'yaml', 'yml', 'toml']);
const imageExts = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico']);

function getFileIcon(name: string) {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  if (codeExts.has(ext)) return FileCode;
  if (jsonExts.has(ext)) return FileJson;
  if (textExts.has(ext)) return FileText;
  if (imageExts.has(ext)) return Image;
  return File;
}

function handleItemSelect(node: FileNode) {
  if (node.type === 'file') {
    files.openFile(node.path);
  } else if (node.type === 'directory') {
    // Lazy load children when expanding a directory
    files.expandFolder(node.path);
  }
}
</script>

<template>
  <ScrollArea class="h-full">
    <div v-if="files.loading" class="flex items-center justify-center p-4">
      <span class="text-sm text-muted-foreground">Loading...</span>
    </div>
    <div v-else-if="files.tree.length === 0" class="p-4 text-center text-sm text-muted-foreground">
      No files found
    </div>
    <TreeRoot
      v-else
      v-slot="{ flattenItems }"
      :items="files.tree"
      :get-key="(item: FileNode) => item.path"
      :get-children="(item: FileNode) => item.children"
      class="py-1"
    >
      <TreeItem
        v-for="item in flattenItems.filter(i => !i.value.path.endsWith('/__placeholder'))"
        v-slot="{ isExpanded }"
        :key="item._id"
        v-bind="item.bind"
        :style="{ paddingLeft: `${item.level * 16 + 8}px` }"
        class="flex cursor-pointer select-none items-center gap-1.5 rounded-sm px-1.5 py-[5px] text-[13px] outline-none hover:bg-accent focus-visible:bg-accent data-[selected]:bg-accent/70"
        @select="handleItemSelect(item.value)"
      >
        <template v-if="item.hasChildren">
          <ChevronRight
            class="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-150"
            :class="{ 'rotate-90': isExpanded }"
          />
          <component
            :is="isExpanded ? FolderOpen : Folder"
            class="h-4 w-4 shrink-0 text-primary/70"
          />
        </template>
        <template v-else>
          <span class="w-3.5 shrink-0" />
          <component
            :is="getFileIcon(item.value.name)"
            class="h-4 w-4 shrink-0 text-muted-foreground"
          />
        </template>
        <span class="truncate">{{ item.value.name }}</span>
      </TreeItem>
    </TreeRoot>
  </ScrollArea>
</template>
