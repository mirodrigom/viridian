<script setup lang="ts">
import { ref, watch, computed, nextTick } from 'vue';
import { apiFetch } from '@/lib/apiFetch';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { FolderOpen, ChevronRight, ArrowUp, Home, FolderPlus, Check, X } from 'lucide-vue-next';
import { toast } from 'vue-sonner';

interface DirEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
}

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
const fetchError = ref('');
watch(open, (isOpen) => {
  if (isOpen) {
    currentPath.value = props.initialPath;
    fetchError.value = '';
    fetchDir(currentPath.value);
  }
});

async function fetchDir(path: string) {
  isLoading.value = true;
  fetchError.value = '';
  try {
    const res = await apiFetch(`/api/files/tree?path=${encodeURIComponent(path)}&depth=1`);
    if (!res.ok) {
      // 401 is handled globally by apiFetch (redirects to login)
      if (res.status !== 401) {
        fetchError.value = `Failed to load directory (${res.status})`;
      }
      return;
    }
    const data = await res.json();
    directories.value = (data.tree || []).filter((e: DirEntry) => e.type === 'directory');
    currentPath.value = path;
  } catch {
    fetchError.value = 'Could not connect to server';
  } finally {
    isLoading.value = false;
  }
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

function selectCurrent() {
  emit('select', currentPath.value);
  open.value = false;
}

const creatingFolder = ref(false);
const newFolderName = ref('');
const newFolderInput = ref<InstanceType<typeof Input> | null>(null);

function startCreateFolder() {
  creatingFolder.value = true;
  newFolderName.value = '';
  nextTick(() => {
    (newFolderInput.value?.$el as HTMLInputElement)?.focus();
  });
}

function cancelCreateFolder() {
  creatingFolder.value = false;
  newFolderName.value = '';
}

async function confirmCreateFolder() {
  const name = newFolderName.value.trim();
  if (!name) return;
  try {
    await apiFetch('/api/files/mkdir', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parentPath: currentPath.value, name }),
    });
    creatingFolder.value = false;
    newFolderName.value = '';
    await fetchDir(currentPath.value);
  } catch {
    toast.error('Failed to create folder');
  }
}

const isAtRoot = computed(() => currentPath.value === '/');

const breadcrumbs = computed(() => {
  const parts = currentPath.value.split('/').filter(Boolean);
  return parts.map((part, idx) => ({
    name: part,
    path: '/' + parts.slice(0, idx + 1).join('/'),
  }));
});
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="w-[90vw] overflow-hidden sm:max-w-3xl">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2">
          <FolderOpen class="h-5 w-5" />
          Browse Directory
        </DialogTitle>
      </DialogHeader>

      <!-- Breadcrumbs + New Folder -->
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
        <div class="ml-auto shrink-0">
          <Button variant="ghost" size="sm" class="h-6 gap-1 px-1.5 text-xs" @click="startCreateFolder" :disabled="creatingFolder">
            <FolderPlus class="h-3.5 w-3.5" />
            New Folder
          </Button>
        </div>
      </div>

      <!-- Directory listing -->
      <ScrollArea class="h-72 rounded-md border border-border">
        <div v-if="isLoading" class="flex items-center justify-center py-8">
          <span class="text-sm text-muted-foreground">Loading...</span>
        </div>
        <div v-else class="p-1">
          <!-- Parent directory (always visible unless at root) -->
          <button
            v-if="!isAtRoot"
            class="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors hover:bg-accent"
            @click="goUp"
          >
            <ArrowUp class="h-4 w-4 shrink-0 text-muted-foreground" />
            <span class="text-muted-foreground">..</span>
          </button>
          <!-- New folder inline input -->
          <div v-if="creatingFolder" class="flex items-center gap-1.5 px-2.5 py-1.5">
            <FolderPlus class="h-4 w-4 shrink-0 text-primary/70" />
            <Input
              ref="newFolderInput"
              v-model="newFolderName"
              placeholder="Folder name"
              class="h-7 text-sm"
              @keydown.enter="confirmCreateFolder"
              @keydown.escape="cancelCreateFolder"
            />
            <Button variant="ghost" size="sm" class="h-7 w-7 shrink-0 p-0" @click="confirmCreateFolder" :disabled="!newFolderName.trim()">
              <Check class="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="sm" class="h-7 w-7 shrink-0 p-0" @click="cancelCreateFolder">
              <X class="h-3.5 w-3.5" />
            </Button>
          </div>
          <!-- Directories -->
          <button
            v-for="dir in directories"
            :key="dir.name"
            class="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors hover:bg-accent"
            @click="navigateTo(dir)"
          >
            <FolderOpen class="h-4 w-4 shrink-0 text-primary/70" />
            <span class="truncate text-foreground">{{ dir.name }}</span>
          </button>
          <!-- Error or empty state (after ".." so user can still go up) -->
          <div v-if="fetchError" class="flex flex-col items-center justify-center gap-2 py-6">
            <span class="text-sm text-destructive">{{ fetchError }}</span>
            <Button variant="outline" size="sm" @click="fetchDir(currentPath)">Retry</Button>
          </div>
          <div v-else-if="directories.length === 0" class="flex items-center justify-center py-6">
            <span class="text-sm text-muted-foreground">No subdirectories</span>
          </div>
        </div>
      </ScrollArea>

      <DialogFooter class="!flex-col gap-2 sm:!flex-row sm:items-center sm:justify-between">
        <span class="min-w-0 truncate font-mono text-xs text-muted-foreground">{{ currentPath }}</span>
        <Button @click="selectCurrent" class="shrink-0 gap-1.5">
          <FolderOpen class="h-4 w-4" />
          Select This Directory
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
