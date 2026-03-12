<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { useFilesStore } from '@/stores/files';
import { useChatStore } from '@/stores/chat';
import { apiFetch } from '@/lib/apiFetch';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { History, Eye, GitCompare, RotateCcw, X, Loader2 } from 'lucide-vue-next';
import { toast } from 'vue-sonner';

interface FileHistoryEntry {
  hash: string;
  date: string;
  message: string;
  author_name: string;
}

const props = defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void;
}>();

const files = useFilesStore();
const chat = useChatStore();

const history = ref<FileHistoryEntry[]>([]);
const loading = ref(false);
const selectedCommit = ref<FileHistoryEntry | null>(null);
const viewingContent = ref<string | null>(null);
const viewLoading = ref(false);
const showRestoreConfirm = ref(false);
const restoreTarget = ref<FileHistoryEntry | null>(null);
const restoreLoading = ref(false);

const currentFilePath = computed(() => files.activeFile);

function cwd() {
  return chat.projectPath || '';
}

async function fetchHistory() {
  if (!currentFilePath.value || !cwd()) return;
  loading.value = true;
  history.value = [];
  try {
    const res = await apiFetch(
      `/api/git/file-history?cwd=${encodeURIComponent(cwd())}&file=${encodeURIComponent(currentFilePath.value)}`,
    );
    if (!res.ok) throw new Error('HTTP error');
    const data = await res.json();
    history.value = data.history || [];
  } catch {
    toast.error('Failed to fetch file history');
  } finally {
    loading.value = false;
  }
}

async function viewVersion(entry: FileHistoryEntry) {
  if (!currentFilePath.value || !cwd()) return;
  selectedCommit.value = entry;
  viewLoading.value = true;
  viewingContent.value = null;
  try {
    const res = await apiFetch(
      `/api/git/file-at-commit?cwd=${encodeURIComponent(cwd())}&file=${encodeURIComponent(currentFilePath.value)}&commit=${encodeURIComponent(entry.hash)}`,
    );
    if (!res.ok) throw new Error('HTTP error');
    const data = await res.json();
    viewingContent.value = data.content || '';
  } catch {
    toast.error('Failed to load file version');
    viewingContent.value = null;
  } finally {
    viewLoading.value = false;
  }
}

async function compareWithCurrent(entry: FileHistoryEntry) {
  if (!currentFilePath.value || !cwd()) return;
  viewLoading.value = true;
  try {
    const res = await apiFetch(
      `/api/git/file-at-commit?cwd=${encodeURIComponent(cwd())}&file=${encodeURIComponent(currentFilePath.value)}&commit=${encodeURIComponent(entry.hash)}`,
    );
    if (!res.ok) throw new Error('HTTP error');
    const data = await res.json();

    const currentFile = files.openFiles.find(f => f.path === currentFilePath.value);
    const currentContent = currentFile?.content || '';

    const ext = currentFilePath.value.split('.').pop()?.toLowerCase() || '';
    const langMap: Record<string, string> = {
      ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
      py: 'python', html: 'html', vue: 'vue', svelte: 'svelte',
      css: 'css', scss: 'scss', json: 'json', md: 'markdown',
    };

    files.openDiff({
      path: currentFilePath.value,
      original: data.content || '',
      modified: currentContent,
      language: langMap[ext] || '',
    });

    emit('update:open', false);
  } catch {
    toast.error('Failed to compare versions');
  } finally {
    viewLoading.value = false;
  }
}

function promptRestore(entry: FileHistoryEntry) {
  restoreTarget.value = entry;
  showRestoreConfirm.value = true;
}

async function confirmRestore() {
  if (!restoreTarget.value || !currentFilePath.value || !cwd()) return;
  restoreLoading.value = true;
  try {
    const res = await apiFetch('/api/git/restore-file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cwd: cwd(),
        file: currentFilePath.value,
        commit: restoreTarget.value.hash,
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error((data as { error?: string }).error || 'Restore failed');
    }

    // Re-open the file to refresh its content in the editor
    const filePath = currentFilePath.value;
    files.closeFile(filePath);
    await files.openFile(filePath);

    toast.success(`Restored ${filePath} to ${restoreTarget.value.hash.slice(0, 7)}`);
    showRestoreConfirm.value = false;
    restoreTarget.value = null;
    emit('update:open', false);
  } catch (err) {
    toast.error(err instanceof Error ? err.message : 'Failed to restore file');
  } finally {
    restoreLoading.value = false;
  }
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) +
      ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  } catch {
    return dateStr;
  }
}

function closePanel() {
  selectedCommit.value = null;
  viewingContent.value = null;
  emit('update:open', false);
}

function backToList() {
  selectedCommit.value = null;
  viewingContent.value = null;
}

// Fetch history when panel opens
watch(() => props.open, (isOpen) => {
  if (isOpen) {
    selectedCommit.value = null;
    viewingContent.value = null;
    fetchHistory();
  }
});
</script>

<template>
  <Transition name="slide-right">
    <div
      v-if="open"
      class="absolute inset-y-0 right-0 z-30 flex w-80 flex-col border-l border-border bg-background shadow-xl"
    >
      <!-- Header -->
      <div class="flex items-center gap-2 border-b border-border px-3 py-2">
        <History class="h-4 w-4 text-primary" />
        <span class="text-sm font-medium text-foreground">File History</span>
        <span v-if="currentFilePath" class="truncate text-xs text-muted-foreground">
          {{ currentFilePath.split('/').pop() }}
        </span>
        <Button variant="ghost" size="sm" class="ml-auto h-6 w-6 p-0" @click="closePanel">
          <X class="h-3.5 w-3.5" />
        </Button>
      </div>

      <!-- Content: viewing a specific version -->
      <template v-if="selectedCommit && viewingContent !== null">
        <div class="flex items-center gap-2 border-b border-border px-3 py-1.5 bg-muted/30">
          <Button variant="ghost" size="sm" class="h-6 px-2 text-xs" @click="backToList">
            Back
          </Button>
          <span class="truncate text-xs text-muted-foreground font-mono">
            {{ selectedCommit.hash.slice(0, 7) }}
          </span>
        </div>
        <ScrollArea class="flex-1">
          <pre class="p-3 text-xs font-mono whitespace-pre-wrap text-foreground/90 leading-relaxed">{{ viewingContent }}</pre>
        </ScrollArea>
      </template>

      <!-- Content: commit list -->
      <template v-else>
        <div v-if="loading" class="flex flex-1 items-center justify-center">
          <Loader2 class="h-5 w-5 animate-spin text-muted-foreground" />
        </div>

        <div v-else-if="!currentFilePath" class="flex flex-1 items-center justify-center px-4">
          <p class="text-sm text-muted-foreground text-center">Open a file to view its history</p>
        </div>

        <div v-else-if="history.length === 0" class="flex flex-1 items-center justify-center px-4">
          <p class="text-sm text-muted-foreground text-center">No commit history found for this file</p>
        </div>

        <ScrollArea v-else class="flex-1">
          <div class="flex flex-col gap-0.5 p-1.5">
            <div
              v-for="entry in history"
              :key="entry.hash"
              class="group rounded-md border border-transparent px-2.5 py-2 transition-colors hover:border-border hover:bg-muted/40"
            >
              <!-- Commit info -->
              <div class="flex items-start gap-2">
                <span class="mt-0.5 shrink-0 font-mono text-[10px] text-primary/70">
                  {{ entry.hash.slice(0, 7) }}
                </span>
                <div class="min-w-0 flex-1">
                  <p class="text-xs font-medium text-foreground leading-snug line-clamp-2">
                    {{ entry.message }}
                  </p>
                  <p class="mt-0.5 text-[10px] text-muted-foreground">
                    {{ entry.author_name }} &middot; {{ formatDate(entry.date) }}
                  </p>
                </div>
              </div>

              <!-- Actions -->
              <div class="mt-1.5 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                <Button
                  variant="ghost"
                  size="sm"
                  class="h-6 gap-1 px-1.5 text-[10px]"
                  :disabled="viewLoading"
                  @click="viewVersion(entry)"
                >
                  <Eye class="h-3 w-3" />
                  View
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  class="h-6 gap-1 px-1.5 text-[10px]"
                  :disabled="viewLoading"
                  @click="compareWithCurrent(entry)"
                >
                  <GitCompare class="h-3 w-3" />
                  Compare
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  class="h-6 gap-1 px-1.5 text-[10px] text-orange-500 hover:text-orange-600"
                  :disabled="viewLoading"
                  @click="promptRestore(entry)"
                >
                  <RotateCcw class="h-3 w-3" />
                  Restore
                </Button>
              </div>
            </div>
          </div>
        </ScrollArea>
      </template>
    </div>
  </Transition>

  <!-- Restore confirmation dialog -->
  <Dialog v-model:open="showRestoreConfirm">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Restore File</DialogTitle>
        <DialogDescription>
          This will overwrite the current file with the version from commit
          <span class="font-mono font-medium">{{ restoreTarget?.hash.slice(0, 7) }}</span>.
          Unsaved changes will be lost.
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button variant="outline" :disabled="restoreLoading" @click="showRestoreConfirm = false">
          Cancel
        </Button>
        <Button variant="destructive" :disabled="restoreLoading" @click="confirmRestore">
          <Loader2 v-if="restoreLoading" class="mr-1.5 h-3.5 w-3.5 animate-spin" />
          Restore
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<style scoped>
.slide-right-enter-active,
.slide-right-leave-active {
  transition: transform 0.2s ease;
}
.slide-right-enter-from,
.slide-right-leave-to {
  transform: translateX(100%);
}
</style>
