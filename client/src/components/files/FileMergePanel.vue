<script setup lang="ts">
import { ref, computed } from 'vue';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useFilesStore } from '@/stores/files';
import { apiFetch } from '@/lib/apiFetch';
import { toast } from 'vue-sonner';
import { Loader2, Check, Plus, X, FileText } from 'lucide-vue-next';

const files = useFilesStore();
const filePaths = ref<string[]>(['', '']);
const instruction = ref('');
const outputPath = ref('');
const mergedContent = ref('');
const loading = ref(false);
const executing = ref(false);
const previewed = ref(false);

const validFiles = computed(() => filePaths.value.filter(f => f.trim().length > 0));

function addFile() {
  filePaths.value.push('');
}

function removeFile(idx: number) {
  if (filePaths.value.length <= 2) return;
  filePaths.value.splice(idx, 1);
}

async function preview() {
  if (validFiles.value.length < 2) {
    toast.error('Enter at least 2 file paths');
    return;
  }
  if (!instruction.value) {
    toast.error('Enter a merge instruction');
    return;
  }
  loading.value = true;
  previewed.value = false;
  mergedContent.value = '';
  try {
    const res = await apiFetch('/api/file-automation/merge/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filePaths: validFiles.value,
        instruction: instruction.value,
        rootPath: files.rootPath,
      }),
    });
    if (!res.ok) {
      const data = await res.json();
      toast.error(data.error || 'Merge preview failed');
      return;
    }
    const data = await res.json();
    mergedContent.value = data.mergedContent;
    previewed.value = true;

    // Auto-suggest output path if empty
    if (!outputPath.value && validFiles.value.length > 0) {
      const first = validFiles.value[0]!;
      const dir = first.includes('/') ? first.substring(0, first.lastIndexOf('/') + 1) : '';
      outputPath.value = `${dir}merged-output${first.substring(first.lastIndexOf('.'))}`;
    }
  } catch (err) {
    toast.error('Failed to generate merge preview');
  } finally {
    loading.value = false;
  }
}

async function execute() {
  if (!mergedContent.value || !outputPath.value) {
    toast.error('Output path is required');
    return;
  }
  executing.value = true;
  try {
    const res = await apiFetch('/api/file-automation/merge/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filePaths: validFiles.value,
        mergedContent: mergedContent.value,
        outputPath: outputPath.value,
        rootPath: files.rootPath,
      }),
    });
    if (!res.ok) {
      const data = await res.json();
      toast.error(data.error || 'Merge failed');
      return;
    }
    toast.success(`Merged file saved to ${outputPath.value}`);
    files.fetchTree(files.rootPath);
    // Open the merged file
    files.openFile(outputPath.value);
    // Reset
    mergedContent.value = '';
    previewed.value = false;
  } catch (err) {
    toast.error('Failed to save merged file');
  } finally {
    executing.value = false;
  }
}
</script>

<template>
  <div class="flex h-full flex-col gap-4 p-4">
    <div class="space-y-3">
      <div class="space-y-1.5">
        <Label>Files to Merge</Label>
        <div class="space-y-2">
          <div v-for="(_, idx) in filePaths" :key="idx" class="flex items-center gap-2">
            <FileText class="h-4 w-4 shrink-0 text-muted-foreground" />
            <Input
              v-model="filePaths[idx]"
              :placeholder="`File path ${idx + 1} (relative to project root)`"
              class="flex-1"
            />
            <button
              v-if="filePaths.length > 2"
              class="shrink-0 rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              @click="removeFile(idx)"
            >
              <X class="h-3.5 w-3.5" />
            </button>
          </div>
          <Button variant="outline" size="sm" @click="addFile" class="w-full">
            <Plus class="mr-1.5 h-3.5 w-3.5" />
            Add File
          </Button>
        </div>
      </div>
      <div class="space-y-1.5">
        <Label>Merge Instruction</Label>
        <Textarea
          v-model="instruction"
          placeholder="e.g., combine into a single module, merge keeping all unique functions, interleave sections..."
          :rows="2"
        />
      </div>
      <Button :disabled="loading || validFiles.length < 2 || !instruction" @click="preview" class="w-full">
        <Loader2 v-if="loading" class="mr-2 h-4 w-4 animate-spin" />
        {{ loading ? 'Generating Merge Preview...' : 'Preview Merge' }}
      </Button>
    </div>

    <template v-if="previewed && mergedContent">
      <div class="space-y-1.5">
        <Label>Output File Path</Label>
        <Input v-model="outputPath" placeholder="path/to/merged-file.ext" />
      </div>
      <div class="flex items-center justify-between">
        <span class="text-sm font-medium text-muted-foreground">
          Merged result preview
        </span>
        <span class="text-xs text-muted-foreground">
          {{ mergedContent.split('\n').length }} lines
        </span>
      </div>
      <ScrollArea class="flex-1 rounded-md border bg-muted/30">
        <pre class="p-3 font-mono text-xs text-foreground whitespace-pre-wrap break-all">{{ mergedContent }}</pre>
      </ScrollArea>
      <Button :disabled="executing || !outputPath" @click="execute" class="w-full">
        <Loader2 v-if="executing" class="mr-2 h-4 w-4 animate-spin" />
        <Check v-else class="mr-2 h-4 w-4" />
        {{ executing ? 'Saving...' : 'Save Merged File' }}
      </Button>
    </template>
  </div>
</template>
