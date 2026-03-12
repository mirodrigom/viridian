<script setup lang="ts">
import { ref, nextTick } from 'vue';
import { useFilesStore } from '@/stores/files';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { FilePlus, History } from 'lucide-vue-next';
import { toast } from 'vue-sonner';

const files = useFilesStore();

const showHistoryPanel = defineModel<boolean>('showHistoryPanel', { default: false });

const showNewFileDialog = ref(false);
const newFileName = ref('');
const isCreating = ref(false);
const fileNameInput = ref<InstanceType<typeof Input> | null>(null);

function handleClose(e: Event, path: string) {
  e.stopPropagation();
  files.closeFile(path);
}

function openNewFileDialog() {
  newFileName.value = '';
  showNewFileDialog.value = true;
  nextTick(() => {
    // Focus the input after the dialog opens
    const input = document.querySelector('[data-new-file-input]') as HTMLInputElement | null;
    input?.focus();
  });
}

async function handleCreateFile() {
  const name = newFileName.value.trim();
  if (!name) {
    toast.error('Please enter a file name');
    return;
  }
  if (!files.rootPath) {
    toast.error('No project is open');
    return;
  }

  isCreating.value = true;
  try {
    const success = await files.createFile(name);
    if (success) {
      showNewFileDialog.value = false;
      newFileName.value = '';
    }
  } finally {
    isCreating.value = false;
  }
}
</script>

<template>
  <div v-if="files.openFiles.length > 0 || files.rootPath" class="flex shrink-0 items-center gap-0 overflow-x-auto border-b border-border bg-muted/30">
    <button
      v-for="file in files.openFiles"
      :key="file.path"
      class="group flex shrink-0 items-center gap-1.5 border-r border-border px-3 py-1.5 text-sm transition-colors duration-150"
      :class="files.activeFile === file.path ? 'bg-background text-foreground' : 'text-muted-foreground hover:bg-background/50 hover:text-foreground'"
      @click="files.activeFile = file.path"
      @mousedown.middle.prevent="files.closeFile(file.path)"
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

    <!-- New File button -->
    <Button
      variant="ghost"
      size="sm"
      class="ml-1 h-7 w-7 shrink-0 p-0 text-muted-foreground hover:text-foreground"
      title="New File"
      @click="openNewFileDialog"
    >
      <FilePlus class="h-3.5 w-3.5" />
    </Button>

    <!-- File History button -->
    <Button
      v-if="files.activeFile"
      variant="ghost"
      size="sm"
      class="h-7 w-7 shrink-0 p-0 text-muted-foreground hover:text-foreground"
      :class="showHistoryPanel ? 'text-primary' : ''"
      title="File History"
      @click="showHistoryPanel = !showHistoryPanel"
    >
      <History class="h-3.5 w-3.5" />
    </Button>
  </div>

  <!-- New File Dialog -->
  <Dialog v-model:open="showNewFileDialog">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>New File</DialogTitle>
        <DialogDescription>
          Enter a file name or path relative to the project root. Parent directories will be created automatically.
        </DialogDescription>
      </DialogHeader>
      <form @submit.prevent="handleCreateFile">
        <Input
          v-model="newFileName"
          data-new-file-input
          placeholder="e.g. src/utils/helpers.ts"
          :disabled="isCreating"
          class="font-mono text-sm"
        />
        <DialogFooter class="mt-4">
          <Button type="button" variant="outline" @click="showNewFileDialog = false" :disabled="isCreating">
            Cancel
          </Button>
          <Button type="submit" :disabled="isCreating || !newFileName.trim()">
            {{ isCreating ? 'Creating...' : 'Create' }}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
