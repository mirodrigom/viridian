<script setup lang="ts">
import { ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useGraphStore } from '@/stores/graph';
import { useChatStore } from '@/stores/chat';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'vue-sonner';
import { Trash2, FolderOpen } from 'lucide-vue-next';

const open = defineModel<boolean>('open', { default: false });
const graph = useGraphStore();
const chat = useChatStore();
const router = useRouter();
const loadingId = ref<string | null>(null);

watch(open, (val) => {
  if (val) {
    graph.fetchGraphList(chat.projectPath || '');
  }
});

async function onLoad(id: string) {
  loadingId.value = id;
  try {
    await graph.loadGraph(id);
    router.replace({ name: 'graph-open', params: { graphId: id } });
    toast.success('Graph loaded');
    open.value = false;
  } catch {
    toast.error('Failed to load graph');
  } finally {
    loadingId.value = null;
  }
}

async function onDelete(id: string) {
  const wasCurrent = graph.currentGraphId === id;
  try {
    await graph.deleteGraph(id);
    if (wasCurrent) {
      router.replace({ name: 'graph' });
    }
    toast.success('Graph deleted');
  } catch {
    toast.error('Failed to delete graph');
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
        <DialogTitle>Load Graph</DialogTitle>
        <DialogDescription>Select a saved graph to open</DialogDescription>
      </DialogHeader>

      <ScrollArea class="max-h-[300px]">
        <div v-if="graph.loading" class="py-8 text-center text-sm text-muted-foreground">
          Loading...
        </div>

        <div v-else-if="graph.graphList.length === 0" class="py-8 text-center text-sm text-muted-foreground">
          No saved graphs yet
        </div>

        <div v-else class="space-y-1 p-1">
          <div
            v-for="g in graph.graphList"
            :key="g.id"
            class="flex items-center gap-2 rounded-md border border-transparent px-3 py-2 transition-colors hover:border-border hover:bg-muted/50"
          >
            <div class="min-w-0 flex-1">
              <div class="truncate text-sm font-medium">{{ g.name }}</div>
              <div class="text-xs text-muted-foreground">{{ formatDate(g.updatedAt) }}</div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              class="h-7 w-7 shrink-0 p-0"
              :disabled="loadingId === g.id"
              @click="onLoad(g.id)"
            >
              <FolderOpen class="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              class="h-7 w-7 shrink-0 p-0 text-destructive hover:text-destructive"
              @click="onDelete(g.id)"
            >
              <Trash2 class="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </ScrollArea>
    </DialogContent>
  </Dialog>
</template>
