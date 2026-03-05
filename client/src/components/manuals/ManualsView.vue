<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useManualsStore } from '@/stores/manuals';
import { useChatStore } from '@/stores/chat';
import { useConfirmDialog } from '@/composables/useConfirmDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Plus, FileText, Trash2, Loader2 } from 'lucide-vue-next';
import ManualEditor from './ManualEditor.vue';

const manualsStore = useManualsStore();
const chatStore = useChatStore();
const { confirm } = useConfirmDialog();

const showEditor = ref(false);
const newTitle = ref('');
const creating = ref(false);

const projectPath = computed(() => chatStore.projectPath || '/tmp');

onMounted(() => {
  manualsStore.fetchManualList(projectPath.value);
});

async function createNew() {
  if (!newTitle.value.trim()) return;
  creating.value = true;
  const manual = await manualsStore.createManual(projectPath.value, {
    title: newTitle.value.trim(),
    prompt: '',
  });
  creating.value = false;
  if (manual) {
    newTitle.value = '';
    showEditor.value = true;
  }
}

async function openManual(id: string) {
  await manualsStore.loadManual(id);
  showEditor.value = true;
}

async function deleteManual(id: string, e: Event) {
  e.stopPropagation();
  const ok = await confirm({ title: 'Delete Manual', description: 'Are you sure you want to delete this manual? This action cannot be undone.' });
  if (!ok) return;
  await manualsStore.deleteManual(id, projectPath.value);
}

function goBack() {
  showEditor.value = false;
  manualsStore.clearManual();
  manualsStore.fetchManualList(projectPath.value);
}

function statusBadge(status: string) {
  switch (status) {
    case 'generated': return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400';
    case 'draft': return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400';
    default: return 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400';
  }
}
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- Editor view -->
    <ManualEditor v-if="showEditor && manualsStore.currentManual" @back="goBack" />

    <!-- List view -->
    <div v-else class="flex h-full flex-col">
      <!-- Header -->
      <div class="flex items-center gap-3 border-b border-border px-4 py-3">
        <FileText class="h-5 w-5 text-primary" />
        <h2 class="text-lg font-semibold">Manuals</h2>
        <div class="flex-1" />
        <div class="flex items-center gap-2">
          <Input
            v-model="newTitle"
            placeholder="New manual title..."
            class="h-8 w-48 text-sm"
            @keydown.enter="createNew"
          />
          <Button size="sm" :disabled="!newTitle.trim() || creating" @click="createNew">
            <Loader2 v-if="creating" class="mr-1 h-4 w-4 animate-spin" />
            <Plus v-else class="mr-1 h-4 w-4" />
            Create
          </Button>
        </div>
      </div>

      <!-- Manual list -->
      <div class="flex-1 overflow-auto p-4">
        <div v-if="manualsStore.loading" class="flex items-center justify-center py-12">
          <Loader2 class="h-6 w-6 animate-spin text-muted-foreground" />
        </div>

        <div v-else-if="manualsStore.manualList.length === 0" class="flex flex-col items-center justify-center py-16 text-center">
          <FileText class="mb-3 h-12 w-12 text-muted-foreground/50" />
          <h3 class="text-lg font-medium text-muted-foreground">No manuals yet</h3>
          <p class="mt-1 text-sm text-muted-foreground/70">
            Create a new manual to get started. Upload your company logos, describe the manual you need, and let AI generate it.
          </p>
        </div>

        <div v-else class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Card
            v-for="manual in manualsStore.manualList"
            :key="manual.id"
            class="cursor-pointer transition-shadow hover:shadow-md"
            @click="openManual(manual.id)"
          >
            <CardHeader class="pb-2">
              <div class="flex items-start justify-between">
                <CardTitle class="text-sm font-medium leading-tight">
                  {{ manual.title }}
                </CardTitle>
                <button
                  class="ml-2 shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                  title="Delete manual"
                  @click="deleteManual(manual.id, $event)"
                >
                  <Trash2 class="h-3.5 w-3.5" />
                </button>
              </div>
            </CardHeader>
            <CardContent>
              <div class="flex items-center justify-between">
                <span
                  class="rounded-full px-2 py-0.5 text-[10px] font-medium uppercase"
                  :class="statusBadge(manual.status)"
                >
                  {{ manual.status }}
                </span>
                <span class="text-[10px] text-muted-foreground">
                  {{ new Date(manual.updatedAt).toLocaleDateString() }}
                </span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  </div>
</template>
