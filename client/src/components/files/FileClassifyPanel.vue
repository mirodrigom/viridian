<script setup lang="ts">
import { ref, computed } from 'vue';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { useFilesStore } from '@/stores/files';
import { apiFetch } from '@/lib/apiFetch';
import { toast } from 'vue-sonner';
import { Loader2, Check, FolderOpen, X } from 'lucide-vue-next';

interface ClassifyResult {
  file: string;
  category: string;
  targetFolder: string;
}

const files = useFilesStore();
const directoryPath = ref(files.rootPath || '');
const rules = ref('');
const classifications = ref<ClassifyResult[]>([]);
const loading = ref(false);
const executing = ref(false);
const previewed = ref(false);

const groupedByCategory = computed(() => {
  const groups: Record<string, ClassifyResult[]> = {};
  for (const c of classifications.value) {
    if (!groups[c.category]) groups[c.category] = [];
    groups[c.category]!.push(c);
  }
  return groups;
});

async function preview() {
  if (!directoryPath.value) {
    toast.error('Enter a directory path');
    return;
  }
  loading.value = true;
  previewed.value = false;
  classifications.value = [];
  try {
    const res = await apiFetch('/api/file-automation/classify/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        directoryPath: directoryPath.value,
        rules: rules.value || undefined,
      }),
    });
    if (!res.ok) {
      const data = await res.json();
      toast.error(data.error || 'Classification failed');
      return;
    }
    const data = await res.json();
    classifications.value = data.classifications;
    previewed.value = true;
    if (data.classifications.length === 0) {
      toast.info('No files to classify');
    }
  } catch (err) {
    toast.error('Failed to classify files');
  } finally {
    loading.value = false;
  }
}

function removeItem(idx: number) {
  classifications.value.splice(idx, 1);
}

async function execute() {
  if (classifications.value.length === 0) return;
  executing.value = true;
  try {
    const res = await apiFetch('/api/file-automation/classify/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        directoryPath: directoryPath.value,
        classifications: classifications.value,
      }),
    });
    if (!res.ok) {
      const data = await res.json();
      toast.error(data.error || 'Classification move failed');
      return;
    }
    const data = await res.json();
    toast.success(`Organized ${data.success.length} files`);
    if (data.errors?.length) {
      toast.warning(`${data.errors.length} files failed`);
    }
    files.fetchTree(files.rootPath);
    classifications.value = [];
    previewed.value = false;
    rules.value = '';
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
        <Label>Classification Rules (optional)</Label>
        <Textarea
          v-model="rules"
          placeholder="e.g., Categorize by: code, docs, config, tests, assets..."
          :rows="2"
        />
      </div>
      <Button :disabled="loading || !directoryPath" @click="preview" class="w-full">
        <Loader2 v-if="loading" class="mr-2 h-4 w-4 animate-spin" />
        {{ loading ? 'Analyzing Files...' : 'Classify Files' }}
      </Button>
    </div>

    <template v-if="previewed && classifications.length > 0">
      <div class="flex items-center justify-between">
        <span class="text-sm font-medium text-muted-foreground">
          {{ classifications.length }} file{{ classifications.length !== 1 ? 's' : '' }} classified into
          {{ Object.keys(groupedByCategory).length }} categories
        </span>
      </div>
      <ScrollArea class="flex-1 rounded-md border">
        <div class="p-3 space-y-4">
          <div v-for="(items, category) in groupedByCategory" :key="category">
            <div class="mb-2 flex items-center gap-2">
              <FolderOpen class="h-4 w-4 text-primary" />
              <span class="text-sm font-semibold">{{ category }}</span>
              <Badge variant="secondary" class="text-[10px]">{{ items.length }}</Badge>
            </div>
            <div class="ml-6 space-y-1">
              <div
                v-for="(item, idx) in items"
                :key="item.file"
                class="flex items-center justify-between rounded px-2 py-1 text-xs hover:bg-muted/50"
              >
                <div class="flex-1 space-y-0.5">
                  <div class="font-mono text-foreground">{{ item.file }}</div>
                  <div class="text-muted-foreground">
                    &rarr; {{ item.targetFolder }}/
                  </div>
                </div>
                <button
                  class="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  @click="removeItem(classifications.indexOf(item))"
                >
                  <X class="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </ScrollArea>
      <Button :disabled="executing || classifications.length === 0" @click="execute" class="w-full">
        <Loader2 v-if="executing" class="mr-2 h-4 w-4 animate-spin" />
        <Check v-else class="mr-2 h-4 w-4" />
        {{ executing ? 'Moving Files...' : 'Confirm Classification' }}
      </Button>
    </template>

    <div v-else-if="previewed" class="flex flex-1 items-center justify-center text-sm text-muted-foreground">
      No files to classify
    </div>
  </div>
</template>
