<script setup lang="ts">
import { ref } from 'vue';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { apiFetch } from '@/lib/apiFetch';
import { toast } from 'vue-sonner';
import { Undo2, FileEdit, Tags, FolderTree, Merge } from 'lucide-vue-next';
import BatchRenamePanel from './BatchRenamePanel.vue';
import FileClassifyPanel from './FileClassifyPanel.vue';
import FileOrganizePanel from './FileOrganizePanel.vue';
import FileMergePanel from './FileMergePanel.vue';

const open = defineModel<boolean>('open', { default: false });
const activeTab = ref('rename');

async function undo() {
  try {
    const res = await apiFetch('/api/file-automation/undo', {
      method: 'POST',
    });
    if (!res.ok) {
      const data = await res.json();
      toast.error(data.error || 'Nothing to undo');
      return;
    }
    const data = await res.json();
    if (data.undone) {
      toast.success(`Undone ${data.undone.operation} operation (${data.success.length} files restored)`);
      if (data.errors?.length) {
        toast.warning(`${data.errors.length} files could not be restored`);
      }
    }
  } catch (err) {
    toast.error('Failed to undo');
  }
}

const tabItems = [
  { value: 'rename', label: 'Rename', icon: FileEdit },
  { value: 'classify', label: 'Classify', icon: Tags },
  { value: 'organize', label: 'Organize', icon: FolderTree },
  { value: 'merge', label: 'Merge', icon: Merge },
];
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="flex h-[80vh] max-h-[700px] w-full max-w-2xl flex-col gap-0 p-0">
      <DialogHeader class="border-b px-6 py-4">
        <div class="flex items-center justify-between">
          <div>
            <DialogTitle>File Tools</DialogTitle>
            <DialogDescription>
              AI-powered file management operations
            </DialogDescription>
          </div>
          <Button variant="ghost" size="sm" @click="undo" class="gap-1.5">
            <Undo2 class="h-4 w-4" />
            Undo
          </Button>
        </div>
      </DialogHeader>

      <Tabs v-model="activeTab" class="flex flex-1 flex-col overflow-hidden">
        <TabsList class="mx-6 mt-3 w-auto justify-start">
          <TabsTrigger
            v-for="tab in tabItems"
            :key="tab.value"
            :value="tab.value"
            class="gap-1.5"
          >
            <component :is="tab.icon" class="h-3.5 w-3.5" />
            {{ tab.label }}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="rename" class="mt-0 flex-1 overflow-hidden">
          <ScrollArea class="h-full">
            <BatchRenamePanel />
          </ScrollArea>
        </TabsContent>
        <TabsContent value="classify" class="mt-0 flex-1 overflow-hidden">
          <ScrollArea class="h-full">
            <FileClassifyPanel />
          </ScrollArea>
        </TabsContent>
        <TabsContent value="organize" class="mt-0 flex-1 overflow-hidden">
          <ScrollArea class="h-full">
            <FileOrganizePanel />
          </ScrollArea>
        </TabsContent>
        <TabsContent value="merge" class="mt-0 flex-1 overflow-hidden">
          <ScrollArea class="h-full">
            <FileMergePanel />
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </DialogContent>
  </Dialog>
</template>
