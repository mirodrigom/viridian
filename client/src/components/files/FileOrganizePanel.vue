<script setup lang="ts">
import { ref } from 'vue';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useFilesStore } from '@/stores/files';
import { apiFetch } from '@/lib/apiFetch';
import { toast } from 'vue-sonner';
import { Loader2, ArrowRight, Check, X } from 'lucide-vue-next';

interface OrganizeResult {
  source: string;
  destination: string;
}

const files = useFilesStore();
const directoryPath = ref(files.rootPath || '');
const instruction = ref('');
const moves = ref<OrganizeResult[]>([]);
const loading = ref(false);
const executing = ref(false);
const previewed = ref(false);

async function preview() {
  if (!directoryPath.value || !instruction.value) {
    toast.error('Enter a directory path and organization instruction');
    return;
  }
  loading.value = true;
  previewed.value = false;
  moves.value = [];
  try {
    const res = await apiFetch('/api/file-automation/organize/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        directoryPath: directoryPath.value,
        instruction: instruction.value,
      }),
    });
    if (!res.ok) {
      const data = await res.json();
      toast.error(data.error || 'Organization preview failed');
      return;
    }
    const data = await res.json();
    moves.value = data.moves;
    previewed.value = true;
    if (data.moves.length === 0) {
      toast.info('No files need to be moved');
    }
  } catch (err) {
    toast.error('Failed to generate organization preview');
  } finally {
    loading.value = false;
  }
}

function removeMove(idx: number) {
  moves.value.splice(idx, 1);
}

async function execute() {
  if (moves.value.length === 0) return;
  executing.value = true;
  try {
    const res = await apiFetch('/api/file-automation/organize/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        directoryPath: directoryPath.value,
        moves: moves.value,
      }),
    });
    if (!res.ok) {
      const data = await res.json();
      toast.error(data.error || 'Organization failed');
      return;
    }
    const data = await res.json();
    toast.success(`Moved ${data.success.length} files`);
    if (data.errors?.length) {
      toast.warning(`${data.errors.length} files failed to move`);
    }
    files.fetchTree(files.rootPath);
    moves.value = [];
    previewed.value = false;
    instruction.value = '';
  } catch (err) {
    toast.error('Failed to organize files');
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
        <Label>Organization Instruction</Label>
        <Textarea
          v-model="instruction"
          placeholder="e.g., organize by file type into src/, docs/, assets/ folders..."
          :rows="2"
        />
      </div>
      <Button :disabled="loading || !instruction || !directoryPath" @click="preview" class="w-full">
        <Loader2 v-if="loading" class="mr-2 h-4 w-4 animate-spin" />
        {{ loading ? 'Planning Organization...' : 'Preview Organization' }}
      </Button>
    </div>

    <template v-if="previewed && moves.length > 0">
      <div class="flex items-center justify-between">
        <span class="text-sm font-medium text-muted-foreground">
          {{ moves.length }} file{{ moves.length !== 1 ? 's' : '' }} to move
        </span>
      </div>
      <ScrollArea class="flex-1 rounded-md border">
        <div class="divide-y divide-border">
          <div
            v-for="(m, idx) in moves"
            :key="m.source"
            class="flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted/50"
          >
            <span class="flex-1 truncate font-mono text-xs text-muted-foreground">{{ m.source }}</span>
            <ArrowRight class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span class="flex-1 truncate font-mono text-xs text-foreground">{{ m.destination }}</span>
            <button
              class="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              @click="removeMove(idx)"
            >
              <X class="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </ScrollArea>
      <Button :disabled="executing || moves.length === 0" @click="execute" class="w-full">
        <Loader2 v-if="executing" class="mr-2 h-4 w-4 animate-spin" />
        <Check v-else class="mr-2 h-4 w-4" />
        {{ executing ? 'Moving Files...' : 'Confirm Organization' }}
      </Button>
    </template>

    <div v-else-if="previewed" class="flex flex-1 items-center justify-center text-sm text-muted-foreground">
      No files need to be moved
    </div>
  </div>
</template>
