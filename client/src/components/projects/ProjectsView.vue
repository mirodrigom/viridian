<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue';
import { useProjectsStore } from '@/stores/projects';
import { toast } from 'vue-sonner';
import { Plus, RefreshCw, FolderKanban, Trash2 } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '@/components/ui/resizable';
import ProjectsGraph from './ProjectsGraph.vue';
import AddProjectDialog from './AddProjectDialog.vue';
import ProjectLogPanel from './ProjectLogPanel.vue';

const store = useProjectsStore();
const showAddDialog = ref(false);

onMounted(() => {
  store.connect();
  store.fetchProjects();
});

onUnmounted(() => {
  // Keep WS alive (store persists) — do not disconnect
});

async function refresh() {
  await store.fetchProjects();
  toast.success('Projects refreshed');
}

const hasLogs = computed(() => store.selectedServiceId !== null);
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden">
    <!-- Toolbar -->
    <div class="flex items-center gap-2 border-b px-3 py-2 shrink-0 bg-muted/10">
      <FolderKanban class="h-4 w-4 text-primary shrink-0" />
      <span class="text-sm font-semibold">Projects</span>

      <span
        v-if="store.runningCount > 0"
        class="flex h-4 min-w-4 items-center justify-center rounded-full bg-green-500/15 px-1 text-[10px] font-semibold text-green-500"
      >
        {{ store.runningCount }} running
      </span>

      <div class="ml-auto flex items-center gap-1.5">
        <TooltipProvider :delay-duration="300">
          <Tooltip>
            <TooltipTrigger as-child>
              <Button variant="ghost" size="sm" class="h-7 w-7 p-0" @click="refresh" :disabled="store.loading">
                <RefreshCw class="h-3.5 w-3.5" :class="store.loading ? 'animate-spin' : ''" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Refresh</TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <Button size="sm" class="h-7 gap-1.5 text-xs" @click="showAddDialog = true">
          <Plus class="h-3.5 w-3.5" />
          Add Project
        </Button>
      </div>
    </div>

    <!-- Main content: graph + optional log panel -->
    <ResizablePanelGroup v-if="hasLogs" direction="vertical" class="flex-1 min-h-0">
      <ResizablePanel :default-size="65" :min-size="30">
        <ProjectsGraph />
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel :default-size="35" :min-size="15" :max-size="60">
        <ProjectLogPanel />
      </ResizablePanel>
    </ResizablePanelGroup>

    <ProjectsGraph v-else class="flex-1 min-h-0" />

    <!-- Add project dialog -->
    <AddProjectDialog v-model:open="showAddDialog" />
  </div>
</template>
