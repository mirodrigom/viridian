<script setup lang="ts">
import { ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useDiagramsStore } from '@/stores/diagrams';
import { useChatStore } from '@/stores/chat';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'vue-sonner';

const open = defineModel<boolean>('open', { default: false });
const diagrams = useDiagramsStore();
const chat = useChatStore();
const router = useRouter();
const saving = ref(false);
const name = ref('');

watch(open, (val) => {
  if (val) name.value = diagrams.currentDiagramName;
});

async function onSave() {
  saving.value = true;
  try {
    diagrams.currentDiagramName = name.value || 'Untitled Diagram';
    const saved = await diagrams.saveDiagram(chat.projectPath || '', diagrams.savedViewport ?? undefined);
    if (saved?.id) {
      router.replace({ name: 'diagram-open', params: { diagramId: saved.id } });
    }
    toast.success('Diagram saved');
    open.value = false;
  } catch {
    toast.error('Failed to save diagram');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Save Diagram</DialogTitle>
        <DialogDescription>Save your AWS architecture diagram</DialogDescription>
      </DialogHeader>

      <div class="space-y-3 py-2">
        <div class="space-y-1.5">
          <Label class="text-sm">Name</Label>
          <Input v-model="name" data-testid="save-diagram-name" placeholder="My Architecture Diagram" @keydown.enter="onSave" />
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" @click="open = false">Cancel</Button>
        <Button data-testid="save-diagram-submit" :disabled="saving" @click="onSave">
          {{ saving ? 'Saving...' : diagrams.currentDiagramId ? 'Update' : 'Save' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
