<script setup lang="ts">
import { ref, watch } from 'vue';
import { useAuthStore } from '@/stores/auth';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { FolderOpen, ChevronRight, ArrowUp, Home } from 'lucide-vue-next';

interface DirEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
}

const auth = useAuthStore();
const open = defineModel<boolean>('open', { default: false });
const emit = defineEmits<{ select: [path: string] }>();

const props = withDefaults(defineProps<{
  initialPath?: string;
}>(), {
  initialPath: '/home',
});

const currentPath = ref(props.initialPath);
const directories = ref<DirEntry[]>([]);
const isLoading = ref(false);
const pathInput = ref('');

watch(open, (isOpen) => {
  if (isOpen) {
    currentPath.value = props.initialPath;
    pathInput.value = currentPath.value;
    fetchDir(currentPath.value);
  }
});

async function fetchDir(path: string) {
  isLoading.value = true;
  try {
    const res = await fetch(
      `/api/files/tree?path=${encodeURIComponent(path)}&depth=1`,
      { headers: { Authorization: `Bearer ${auth.token}` } },
    );
    if (!res.ok) return;
    const data = await res.json();
    directories.value = (data.tree || []).filter((e: DirEntry) => e.type === 'directory');
    currentPath.value = path;
    pathInput.value = path;
  } catch { /* ignore */ }
  isLoading.value = false;
}

function navigateTo(dir: DirEntry) {
  const fullPath = currentPath.value === '/' ? `/${dir.name}` : `${currentPath.value}/${dir.name}`;
  fetchDir(fullPath);
}

function goUp() {
  const parent = currentPath.value.split('/').slice(0, -1).join('/') || '/';
  fetchDir(parent);
}

function goHome() {
  fetchDir(props.initialPath);
}

function goToPath() {
  if (pathInput.value.trim()) fetchDir(pathInput.value.trim());
}

function selectCurrent() {
  emit('select', currentPath.value);
  open.value = false;
}

const breadcrumbs = computed(() => {
  const parts = currentPath.value.split('/').filter(Boolean);
  return parts.map((part, idx) => ({
    name: part,
    path: '/' + parts.slice(0, idx + 1).join('/'),
  }));
});
</script>

<script lang="ts">
import { computed } from 'vue';
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="max-w-lg">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2">
          <FolderOpen class="h-5 w-5" />
          Browse Directory
        </DialogTitle>
      </DialogHeader>

      <!-- Path input -->
      <div class="flex gap-1.5">
        <Input
          v-model="pathInput"
          class="font-mono text-xs"
          placeholder="/home/user/project"
          @keydown.enter="goToPath"
        />
        <Button variant="outline" size="sm" class="shrink-0" @click="goToPath">Go</Button>
      </div>

      <!-- Breadcrumbs -->
      <div class="flex items-center gap-0.5 overflow-x-auto text-xs">
        <Button variant="ghost" size="sm" class="h-6 w-6 shrink-0 p-0" @click="goHome">
          <Home class="h-3.5 w-3.5" />
        </Button>
        <ChevronRight class="h-3 w-3 shrink-0 text-muted-foreground" />
        <button
          class="shrink-0 rounded px-1 py-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          @click="fetchDir('/')"
        >
          /
        </button>
        <template v-for="bc in breadcrumbs" :key="bc.path">
          <ChevronRight class="h-3 w-3 shrink-0 text-muted-foreground" />
          <button
            class="shrink-0 truncate rounded px-1 py-0.5 hover:bg-accent hover:text-foreground"
            :class="bc.path === currentPath ? 'font-medium text-foreground' : 'text-muted-foreground'"
            @click="fetchDir(bc.path)"
          >
            {{ bc.name }}
          </button>
        </template>
      </div>

      <!-- Directory listing -->
      <ScrollArea class="h-64 rounded-md border border-border">
        <div v-if="isLoading" class="flex items-center justify-center py-8">
          <span class="text-sm text-muted-foreground">Loading...</span>
        </div>
        <div v-else-if="directories.length === 0" class="flex items-center justify-center py-8">
          <span class="text-sm text-muted-foreground">No subdirectories</span>
        </div>
        <div v-else class="p-1">
          <!-- Parent directory -->
          <button
            class="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors hover:bg-accent"
            @click="goUp"
          >
            <ArrowUp class="h-4 w-4 shrink-0 text-muted-foreground" />
            <span class="text-muted-foreground">..</span>
          </button>
          <!-- Directories -->
          <button
            v-for="dir in directories"
            :key="dir.name"
            class="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors hover:bg-accent"
            @dblclick="navigateTo(dir)"
            @click="navigateTo(dir)"
          >
            <FolderOpen class="h-4 w-4 shrink-0 text-primary/70" />
            <span class="truncate text-foreground">{{ dir.name }}</span>
          </button>
        </div>
      </ScrollArea>

      <DialogFooter>
        <div class="flex w-full items-center justify-between">
          <span class="truncate text-xs text-muted-foreground">{{ currentPath }}</span>
          <Button @click="selectCurrent" class="gap-1.5">
            <FolderOpen class="h-4 w-4" />
            Select This Directory
          </Button>
        </div>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
