<script setup lang="ts">
import { ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useDiagramsStore } from '@/stores/diagrams';
import { useChatStore } from '@/stores/chat';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'vue-sonner';
import { Trash2, FolderOpen } from 'lucide-vue-next';

const open = defineModel<boolean>('open', { default: false });
const diagrams = useDiagramsStore();
const chat = useChatStore();
const router = useRouter();
const loadingId = ref<string | null>(null);

watch(open, (val) => {
  if (val) {
    diagrams.fetchDiagramList(chat.projectPath || '');
  }
});

async function onLoad(id: string) {
  loadingId.value = id;
  try {
    await diagrams.loadDiagram(id);
    router.replace({ name: 'diagram-open', params: { diagramId: id } });
    toast.success('Diagram loaded');
    open.value = false;
  } catch {
    toast.error('Failed to load diagram');
  } finally {
    loadingId.value = null;
  }
}

async function onDelete(id: string) {
  const wasCurrent = diagrams.currentDiagramId === id;
  try {
    await diagrams.deleteDiagram(id);
    if (wasCurrent) {
      router.replace({ name: 'diagrams' });
    }
    toast.success('Diagram deleted');
  } catch {
    toast.error('Failed to delete diagram');
  }
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Load Diagram</DialogTitle>
        <DialogDescription>Select a saved diagram to open</DialogDescription>
      </DialogHeader>

      <ScrollArea class="max-h-[300px]">
        <div v-if="diagrams.loading" class="py-8 text-center text-sm text-muted-foreground">
          Loading...
        </div>

        <div v-else-if="diagrams.diagramList.length === 0" class="py-8 text-center text-sm text-muted-foreground">
          No saved diagrams yet
        </div>

        <div v-else class="space-y-1 p-1">
          <div
            v-for="d in diagrams.diagramList"
            :key="d.id"
            class="flex items-center gap-2 rounded-md border border-transparent px-3 py-2 transition-colors hover:border-border hover:bg-muted/50"
          >
            <div class="min-w-0 flex-1">
              <div class="truncate text-sm font-medium">{{ d.name }}</div>
              <div class="text-xs text-muted-foreground">{{ formatDate(d.updatedAt) }}</div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              class="h-7 w-7 shrink-0 p-0"
              :disabled="loadingId === d.id"
              @click="onLoad(d.id)"
            >
              <FolderOpen class="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              class="h-7 w-7 shrink-0 p-0 text-destructive hover:text-destructive"
              @click="onDelete(d.id)"
            >
              <Trash2 class="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </ScrollArea>
    </DialogContent>
  </Dialog>
</template>
