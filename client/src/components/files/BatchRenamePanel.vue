<script setup lang="ts">
import { ref } from 'vue';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useFilesStore } from '@/stores/files';
import { apiFetch } from '@/lib/apiFetch';
import { toast } from 'vue-sonner';
import { Loader2, ArrowRight, Check, X } from 'lucide-vue-next';

interface RenameMapping {
  original: string;
  renamed: string;
}

const files = useFilesStore();
const instruction = ref('');
const directoryPath = ref(files.rootPath || '');
const mappings = ref<RenameMapping[]>([]);
const loading = ref(false);
const executing = ref(false);
const previewed = ref(false);

async function preview() {
  if (!directoryPath.value || !instruction.value) {
    toast.error('Enter a directory path and rename instruction');
    return;
  }
  loading.value = true;
  previewed.value = false;
  mappings.value = [];
  try {
    const res = await apiFetch('/api/file-automation/batch-rename/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        directoryPath: directoryPath.value,
        instruction: instruction.value,
      }),
    });
    if (!res.ok) {
      const data = await res.json();
      toast.error(data.error || 'Preview failed');
      return;
    }
    const data = await res.json();
    mappings.value = data.mappings;
    previewed.value = true;
    if (data.mappings.length === 0) {
      toast.info('No files need renaming based on your instruction');
    }
  } catch (err) {
    toast.error('Failed to generate rename preview');
  } finally {
    loading.value = false;
  }
}

function removeMapping(idx: number) {
  mappings.value.splice(idx, 1);
}

async function execute() {
  if (mappings.value.length === 0) return;
  executing.value = true;
  try {
    const res = await apiFetch('/api/file-automation/batch-rename/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        directoryPath: directoryPath.value,
        mappings: mappings.value,
      }),
    });
    if (!res.ok) {
      const data = await res.json();
      toast.error(data.error || 'Rename failed');
      return;
    }
    const data = await res.json();
    toast.success(`Renamed ${data.success.length} files`);
    if (data.errors?.length) {
      toast.warning(`${data.errors.length} files failed to rename`);
    }
    // Refresh file tree
    files.fetchTree(files.rootPath);
    // Reset
    mappings.value = [];
    previewed.value = false;
    instruction.value = '';
  } catch (err) {
    toast.error('Failed to execute rename');
  } finally {
    executing.value = false;
  }
}
</script>

<template>
  <div class="flex h-full flex-col gap-4 p-4">
    <div class="space-y-3">
      <div class="space-y-1.5">
        <Label>Directory Path</Label>
        <Input v-model="directoryPath" placeholder="/path/to/directory" />
      </div>
      <div class="space-y-1.5">
        <Label>Rename Instruction</Label>
        <Input
          v-model="instruction"
          placeholder="e.g., rename to kebab-case, add date prefix YYYY-MM-DD..."
          @keydown.enter="preview"
        />
      </div>
      <Button :disabled="loading || !instruction || !directoryPath" @click="preview" class="w-full">
        <Loader2 v-if="loading" class="mr-2 h-4 w-4 animate-spin" />
        {{ loading ? 'Generating Preview...' : 'Preview Rename' }}
      </Button>
    </div>

    <template v-if="previewed && mappings.length > 0">
      <div class="flex items-center justify-between">
        <span class="text-sm font-medium text-muted-foreground">
          {{ mappings.length }} file{{ mappings.length !== 1 ? 's' : '' }} to rename
        </span>
      </div>
      <ScrollArea class="flex-1 rounded-md border">
        <div class="divide-y divide-border">
          <div
            v-for="(m, idx) in mappings"
            :key="m.original"
            class="flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted/50"
          >
            <span class="flex-1 truncate font-mono text-xs text-muted-foreground">{{ m.original }}</span>
            <ArrowRight class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span class="flex-1 truncate font-mono text-xs text-foreground">{{ m.renamed }}</span>
            <button
              class="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              @click="removeMapping(idx)"
            >
              <X class="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </ScrollArea>
      <Button :disabled="executing || mappings.length === 0" @click="execute" variant="default" class="w-full">
        <Loader2 v-if="executing" class="mr-2 h-4 w-4 animate-spin" />
        <Check v-else class="mr-2 h-4 w-4" />
        {{ executing ? 'Renaming...' : 'Confirm Rename' }}
      </Button>
    </template>

    <div v-else-if="previewed" class="flex flex-1 items-center justify-center text-sm text-muted-foreground">
      No files need renaming
    </div>
  </div>
</template>
