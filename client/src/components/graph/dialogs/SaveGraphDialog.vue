<script setup lang="ts">
import { ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useGraphStore } from '@/stores/graph';
import { useChatStore } from '@/stores/chat';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'vue-sonner';

const open = defineModel<boolean>('open', { default: false });
const graph = useGraphStore();
const chat = useChatStore();
const router = useRouter();
const saving = ref(false);
const name = ref('');

watch(open, (val) => {
  if (val) name.value = graph.currentGraphName;
});

async function onSave() {
  saving.value = true;
  try {
    graph.currentGraphName = name.value || 'Untitled Graph';
    const saved = await graph.saveGraph(chat.projectPath || '', graph.savedViewport ?? undefined);
    if (saved?.id) {
      router.replace({ name: 'graph-open', params: { graphId: saved.id } });
    }
    toast.success('Graph saved');
    open.value = false;
  } catch (e) {
    toast.error('Failed to save graph');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Save Graph</DialogTitle>
        <DialogDescription>Save your agent graph configuration</DialogDescription>
      </DialogHeader>

      <div class="space-y-3 py-2">
        <div class="space-y-1.5">
          <Label class="text-sm">Name</Label>
          <Input v-model="name" placeholder="My Agent Graph" @keydown.enter="onSave" />
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" @click="open = false">Cancel</Button>
        <Button :disabled="saving" @click="onSave">
          {{ saving ? 'Saving...' : graph.currentGraphId ? 'Update' : 'Save' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
