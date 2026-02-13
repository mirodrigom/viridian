<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import { useTasksStore, STATUS_OPTIONS, PRIORITY_OPTIONS, type Task, type TaskStatus, type TaskPriority } from '@/stores/tasks';
import { useChatStore } from '@/stores/chat';
import { useConfirmDialog } from '@/composables/useConfirmDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Plus, Trash2, Sparkles, FileText,
  Loader2, CheckCircle2, Circle, Clock,
  ArrowUpRight, Link2,
} from 'lucide-vue-next';

const tasks = useTasksStore();
const chat = useChatStore();
const { confirm } = useConfirmDialog();

const showCreateDialog = ref(false);
const showPrdDialog = ref(false);
const expandingTaskId = ref<string | null>(null);
const expandOutput = ref('');

// Create task form
const newTitle = ref('');
const newDescription = ref('');
const newPriority = ref<TaskPriority>('medium');

// PRD form
const prdText = ref('');
const prdOutput = ref('');

onMounted(() => {
  if (chat.projectPath) tasks.fetchTasks(chat.projectPath);
});

watch(() => chat.projectPath, (path) => {
  if (path) tasks.fetchTasks(path);
});

async function handleCreate() {
  if (!newTitle.value.trim() || !chat.projectPath) return;
  await tasks.createTask(chat.projectPath, {
    title: newTitle.value.trim(),
    description: newDescription.value.trim(),
    priority: newPriority.value,
  });
  newTitle.value = '';
  newDescription.value = '';
  newPriority.value = 'medium';
  showCreateDialog.value = false;
}

async function handleParsePrd() {
  if (!prdText.value.trim() || !chat.projectPath) return;
  prdOutput.value = '';
  await tasks.parsePrd(chat.projectPath, prdText.value, (text) => {
    prdOutput.value += text;
  });
  prdText.value = '';
  showPrdDialog.value = false;
}

async function handleExpand(taskId: string) {
  expandingTaskId.value = taskId;
  expandOutput.value = '';
  await tasks.expandTask(taskId, (text) => {
    expandOutput.value += text;
  });
  expandingTaskId.value = null;
}

async function cycleStatus(task: Task) {
  // Prevent manual status change for parents with subtasks (auto-sync controls it)
  if (tasks.hasSubtasks(task.id)) return;
  const order: TaskStatus[] = ['todo', 'in_progress', 'done'];
  const next = order[(order.indexOf(task.status) + 1) % order.length];
  await tasks.updateTask(task.id, { status: next });
}

async function handleDelete(id: string) {
  const ok = await confirm({
    title: 'Delete task',
    description: 'This will delete the task and all its subtasks.',
  });
  if (!ok) return;
  await tasks.deleteTask(id);
}

const statusIcon = (status: TaskStatus) => {
  if (status === 'done') return CheckCircle2;
  if (status === 'in_progress') return Clock;
  return Circle;
};
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- Header -->
    <div class="flex items-center justify-between border-b border-border px-4 py-3">
      <div class="flex items-center gap-3">
        <h2 class="text-sm font-semibold">Tasks</h2>
        <div v-if="tasks.stats.total > 0" class="flex items-center gap-2">
          <div class="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
            <div class="h-full rounded-full bg-green-500 transition-all" :style="{ width: `${tasks.stats.progress}%` }" />
          </div>
          <span class="text-xs text-muted-foreground">{{ tasks.stats.done }}/{{ tasks.stats.total }}</span>
        </div>
      </div>
      <div class="flex items-center gap-1">
        <!-- Filters -->
        <Select :model-value="tasks.filterStatus || 'all'" @update:model-value="(v: any) => tasks.filterStatus = v === 'all' ? '' : v">
          <SelectTrigger class="h-7 w-28 text-xs">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem v-for="s in STATUS_OPTIONS" :key="s.value" :value="s.value">{{ s.label }}</SelectItem>
          </SelectContent>
        </Select>
        <Select :model-value="tasks.filterPriority || 'all'" @update:model-value="(v: any) => tasks.filterPriority = v === 'all' ? '' : v">
          <SelectTrigger class="h-7 w-28 text-xs">
            <SelectValue placeholder="Priority" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Priority</SelectItem>
            <SelectItem v-for="p in PRIORITY_OPTIONS" :key="p.value" :value="p.value">{{ p.label }}</SelectItem>
          </SelectContent>
        </Select>

        <Separator orientation="vertical" class="mx-1 h-5" />

        <Button variant="outline" size="sm" class="h-7 gap-1 text-xs" @click="showPrdDialog = true">
          <FileText class="h-3 w-3" />
          From PRD
        </Button>
        <Button size="sm" class="h-7 gap-1 text-xs" @click="showCreateDialog = true">
          <Plus class="h-3 w-3" />
          Add Task
        </Button>
      </div>
    </div>

    <!-- Task list -->
    <div class="flex-1 overflow-y-auto p-4">
      <div v-if="tasks.loading" class="flex items-center justify-center py-12">
        <Loader2 class="h-5 w-5 animate-spin text-muted-foreground" />
      </div>

      <div v-else-if="tasks.tasks.length === 0" class="flex flex-col items-center justify-center gap-3 py-12 text-center">
        <div class="rounded-full bg-muted p-3">
          <FileText class="h-5 w-5 text-muted-foreground" />
        </div>
        <div>
          <p class="text-sm font-medium">No tasks yet</p>
          <p class="text-xs text-muted-foreground">Create tasks manually or parse a PRD to get started</p>
        </div>
      </div>

      <!-- Kanban columns -->
      <div v-else class="grid grid-cols-3 gap-4">
        <div v-for="col in STATUS_OPTIONS" :key="col.value" class="flex flex-col gap-2">
          <div class="flex items-center gap-2 pb-1">
            <component :is="statusIcon(col.value)" class="h-3.5 w-3.5" :class="col.value === 'done' ? 'text-green-500' : col.value === 'in_progress' ? 'text-blue-500' : 'text-muted-foreground'" />
            <span class="text-xs font-medium">{{ col.label }}</span>
            <Badge variant="secondary" class="h-4 px-1.5 text-[10px]">{{ tasks.tasksByStatus[col.value].length }}</Badge>
          </div>

          <div class="space-y-2">
            <Card
              v-for="task in tasks.tasksByStatus[col.value]"
              :key="task.id"
              :class="[
                'transition-colors',
                tasks.hasSubtasks(task.id)
                  ? 'border-l-2 border-l-primary/60 bg-accent/20'
                  : 'hover:bg-accent/50',
              ]"
            >
              <CardContent class="p-3">
                <div class="flex items-start gap-2">
                  <!-- Status button: disabled for parents with subtasks -->
                  <button
                    class="mt-0.5 shrink-0"
                    :class="tasks.hasSubtasks(task.id) ? 'cursor-default' : 'cursor-pointer'"
                    @click.stop="cycleStatus(task)"
                  >
                    <component
                      :is="statusIcon(task.status)"
                      class="h-4 w-4"
                      :class="[
                        task.status === 'done' ? 'text-green-500' : task.status === 'in_progress' ? 'text-blue-500' : 'text-muted-foreground',
                        tasks.hasSubtasks(task.id) ? 'opacity-50' : '',
                      ]"
                    />
                  </button>
                  <div class="min-w-0 flex-1">
                    <!-- Parent badge (for subtasks) -->
                    <div v-if="task.parentId" class="mb-0.5 flex items-center gap-1">
                      <ArrowUpRight class="h-2.5 w-2.5 text-muted-foreground" />
                      <span class="max-w-32 truncate text-[9px] text-muted-foreground">
                        {{ tasks.getParentTitle(task) }}
                      </span>
                    </div>

                    <p
                      class="text-xs leading-tight"
                      :class="{
                        'line-through text-muted-foreground': task.status === 'done',
                        'font-semibold': tasks.hasSubtasks(task.id),
                        'font-medium': !tasks.hasSubtasks(task.id),
                      }"
                    >
                      {{ task.title }}
                    </p>
                    <p v-if="task.description" class="mt-0.5 text-[10px] leading-tight text-muted-foreground line-clamp-2">
                      {{ task.description }}
                    </p>
                    <div class="mt-1.5 flex flex-wrap items-center gap-1">
                      <!-- Priority badge -->
                      <Badge variant="outline" class="h-4 px-1 text-[9px]" :class="PRIORITY_OPTIONS.find(p => p.value === task.priority)?.color">
                        {{ task.priority }}
                      </Badge>

                      <!-- Epic progress indicator (for parents with subtasks) -->
                      <Badge v-if="tasks.hasSubtasks(task.id)" variant="secondary" class="h-4 px-1 text-[9px]">
                        {{ tasks.getSubtasks(task.id).filter(s => s.status === 'done').length }}/{{ tasks.getSubtasks(task.id).length }}
                      </Badge>

                      <!-- Dependency badges -->
                      <TooltipProvider v-if="task.dependencyIds.length > 0">
                        <Tooltip v-for="depTitle in tasks.getDependencyTitles(task)" :key="depTitle">
                          <TooltipTrigger as-child>
                            <Badge
                              variant="outline"
                              class="h-4 max-w-20 gap-0.5 truncate px-1 text-[9px]"
                              :class="tasks.isBlockedByDependency(task)
                                ? 'border-orange-500/40 text-orange-500'
                                : 'border-green-500/40 text-green-500'"
                            >
                              <Link2 class="h-2 w-2 shrink-0" />
                              {{ depTitle }}
                            </Badge>
                          </TooltipTrigger>
                          <TooltipContent side="top" class="text-xs">
                            Depends on: {{ depTitle }}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>

                      <!-- Blocked indicator -->
                      <Badge
                        v-if="tasks.isBlockedByDependency(task)"
                        variant="outline"
                        class="h-4 px-1 text-[9px] border-orange-500/40 text-orange-500"
                      >
                        blocked
                      </Badge>
                    </div>
                  </div>
                  <div class="flex shrink-0 items-center gap-0.5">
                    <!-- Sparkles: only for root tasks (expand into subtasks) -->
                    <button
                      v-if="!task.parentId"
                      class="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                      title="Expand into subtasks"
                      @click.stop="handleExpand(task.id)"
                    >
                      <Sparkles v-if="expandingTaskId !== task.id" class="h-3 w-3" />
                      <Loader2 v-else class="h-3 w-3 animate-spin" />
                    </button>
                    <button
                      class="rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      @click.stop="handleDelete(task.id)"
                    >
                      <Trash2 class="h-3 w-3" />
                    </button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>

    <!-- Create Task Dialog -->
    <Dialog v-model:open="showCreateDialog">
      <DialogContent class="max-w-md">
        <DialogHeader>
          <DialogTitle>New Task</DialogTitle>
          <DialogDescription>Add a task to the current project</DialogDescription>
        </DialogHeader>
        <div class="space-y-3 py-2">
          <div class="space-y-1">
            <label class="text-xs font-medium">Title</label>
            <Input v-model="newTitle" placeholder="e.g. Add user authentication" class="h-8 text-sm" @keydown.enter="handleCreate" />
          </div>
          <div class="space-y-1">
            <label class="text-xs font-medium">Description</label>
            <Textarea v-model="newDescription" placeholder="Optional description..." class="min-h-[60px] text-sm" />
          </div>
          <div class="space-y-1">
            <label class="text-xs font-medium">Priority</label>
            <Select :model-value="newPriority" @update:model-value="(v: any) => newPriority = v">
              <SelectTrigger class="h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="p in PRIORITY_OPTIONS" :key="p.value" :value="p.value">{{ p.label }}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button class="w-full" size="sm" :disabled="!newTitle.trim()" @click="handleCreate">
            Create Task
          </Button>
        </div>
      </DialogContent>
    </Dialog>

    <!-- Parse PRD Dialog -->
    <Dialog v-model:open="showPrdDialog">
      <DialogContent class="max-w-lg">
        <DialogHeader>
          <DialogTitle>Parse PRD</DialogTitle>
          <DialogDescription>Paste a Product Requirements Document and Claude will break it into hierarchical tasks</DialogDescription>
        </DialogHeader>
        <div class="space-y-3 py-2">
          <Textarea
            v-model="prdText"
            placeholder="Paste your PRD content here..."
            class="min-h-[200px] text-sm"
          />
          <div v-if="prdOutput" class="max-h-32 overflow-y-auto rounded border border-border bg-muted/50 p-2 text-xs font-mono whitespace-pre-wrap">
            {{ prdOutput }}
          </div>
          <Button class="w-full gap-2" size="sm" :disabled="!prdText.trim() || tasks.prdParsing" @click="handleParsePrd">
            <Loader2 v-if="tasks.prdParsing" class="h-4 w-4 animate-spin" />
            <Sparkles v-else class="h-4 w-4" />
            {{ tasks.prdParsing ? 'Parsing...' : 'Parse into Tasks' }}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  </div>
</template>
