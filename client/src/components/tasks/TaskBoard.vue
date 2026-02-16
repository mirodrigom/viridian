<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue';
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
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
  DialogScrollContent,
} from '@/components/ui/dialog';
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Plus, Trash2, Sparkles, FileText, MessageSquare,
  Loader2, CheckCircle2, Circle, Clock,
  ArrowUpRight, Link2, ChevronRight, GripVertical,
} from 'lucide-vue-next';
import { renderMarkdown, setupCodeCopyHandler } from '@/lib/markdown';
import { useRouter } from 'vue-router';

const tasks = useTasksStore();
const chat = useChatStore();
const router = useRouter();
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

// Drag and drop state
const draggingTaskId = ref<string | null>(null);
const dragOverColumn = ref<TaskStatus | null>(null);

// Subtask collapse state
const collapsedParents = ref<Set<string>>(new Set());

// Markdown code copy handler
let cleanupCopyHandler: (() => void) | undefined;
onMounted(() => { cleanupCopyHandler = setupCodeCopyHandler(); });
onUnmounted(() => { cleanupCopyHandler?.(); });

// Detail dialog state
const descriptionPreview = ref(false);
const detailsPreview = ref(false);
const showDetailDialog = ref(false);
const detailTask = ref<Task | null>(null);
const editTitle = ref('');
const editDescription = ref('');
const editDetails = ref('');
const editPriority = ref<TaskPriority>('medium');
const editDirty = ref(false);

onMounted(() => {
  if (chat.projectPath) tasks.fetchTasks(chat.projectPath);
});

watch(() => chat.projectPath, (path) => {
  if (path) tasks.fetchTasks(path);
});

// ── Create / PRD / Expand ──────────────────────────────────────────────────

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

// ── Status cycling ─────────────────────────────────────────────────────────

async function cycleStatus(task: Task) {
  if (tasks.hasSubtasks(task.id)) return;
  const order: TaskStatus[] = ['todo', 'in_progress', 'done'];
  const next = order[(order.indexOf(task.status) + 1) % order.length];
  await tasks.updateTask(task.id, { status: next });
}

async function cycleSubtaskStatus(sub: Task) {
  const order: TaskStatus[] = ['todo', 'in_progress', 'done'];
  const next = order[(order.indexOf(sub.status) + 1) % order.length];
  await tasks.updateTask(sub.id, { status: next });
}

async function handleDelete(id: string) {
  const ok = await confirm({
    title: 'Delete task',
    description: 'This will delete the task and all its subtasks.',
  });
  if (!ok) return;
  await tasks.deleteTask(id);
  if (detailTask.value?.id === id) showDetailDialog.value = false;
}

const statusIcon = (status: TaskStatus) => {
  if (status === 'done') return CheckCircle2;
  if (status === 'in_progress') return Clock;
  return Circle;
};

// ── Drag and drop ──────────────────────────────────────────────────────────

function onDragStart(event: DragEvent, task: Task) {
  if (!event.dataTransfer) return;
  event.dataTransfer.setData('text/plain', task.id);
  event.dataTransfer.effectAllowed = 'move';
  draggingTaskId.value = task.id;
}

function onDragEnd() {
  draggingTaskId.value = null;
  dragOverColumn.value = null;
}

function onColumnDragOver(event: DragEvent, status: TaskStatus) {
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  dragOverColumn.value = status;
}

function onColumnDragLeave(event: DragEvent, status: TaskStatus) {
  const related = event.relatedTarget as HTMLElement | null;
  const current = event.currentTarget as HTMLElement;
  if (!related || !current.contains(related)) {
    if (dragOverColumn.value === status) dragOverColumn.value = null;
  }
}

async function onColumnDrop(event: DragEvent, targetStatus: TaskStatus) {
  event.preventDefault();
  dragOverColumn.value = null;

  const taskId = event.dataTransfer?.getData('text/plain');
  if (!taskId) return;

  const task = tasks.getTask(taskId);
  if (!task) return;

  if (task.status !== targetStatus) {
    await tasks.updateTask(taskId, { status: targetStatus });
  }

  const columnTasks = tasks.tasksByStatus[targetStatus].map(t => t.id);
  if (!columnTasks.includes(taskId)) columnTasks.push(taskId);
  await tasks.reorderTasks(columnTasks);

  draggingTaskId.value = null;
}

// ── Subtask collapse ───────────────────────────────────────────────────────

function toggleCollapse(taskId: string) {
  const s = new Set(collapsedParents.value);
  if (s.has(taskId)) s.delete(taskId); else s.add(taskId);
  collapsedParents.value = s;
}

// ── Detail dialog ──────────────────────────────────────────────────────────

function openDetail(task: Task) {
  detailTask.value = task;
  editTitle.value = task.title;
  editDescription.value = task.description;
  editDetails.value = task.details;
  editPriority.value = task.priority;
  editDirty.value = false;
  descriptionPreview.value = false;
  detailsPreview.value = false;
  showDetailDialog.value = true;
}

function markDirty() {
  editDirty.value = true;
}

async function saveDetail() {
  if (!detailTask.value || !editDirty.value) return;
  await tasks.updateTask(detailTask.value.id, {
    title: editTitle.value.trim(),
    description: editDescription.value.trim(),
    details: editDetails.value.trim(),
    priority: editPriority.value,
  });
  editDirty.value = false;
}

async function handleDetailClose(open: boolean) {
  if (!open && editDirty.value) await saveDetail();
  showDetailDialog.value = open;
}

// ── Send to Chat ──────────────────────────────────────────────────────────

function buildTaskPrompt(task: Task): string {
  const lines: string[] = [`Work on: ${task.title}`];

  if (task.description) {
    lines.push('', task.description);
  }

  if (task.details) {
    lines.push('', `Implementation notes:\n${task.details}`);
  }

  const subtasks = tasks.getSubtasks(task.id);
  if (subtasks.length > 0) {
    lines.push('', 'Subtasks:');
    for (const sub of subtasks) {
      const check = sub.status === 'done' ? 'x' : ' ';
      lines.push(`- [${check}] ${sub.title}`);
    }
  }

  const deps = tasks.getDependencyTitles(task);
  if (deps.length > 0) {
    lines.push('', `Dependencies: ${deps.join(', ')}`);
  }

  return lines.join('\n');
}

function sendToChat(task: Task) {
  chat.setPendingPrompt(buildTaskPrompt(task));
  showDetailDialog.value = false;

  if (chat.claudeSessionId) {
    router.push({ name: 'chat-session', params: { sessionId: chat.claudeSessionId } });
  } else {
    router.push({ name: 'project' });
  }
}
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- Header -->
    <div class="flex h-9 items-center justify-between border-b border-border px-3">
      <div class="flex items-center gap-3">
        <span class="text-xs font-medium uppercase tracking-wider text-muted-foreground">Tasks</span>
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
      <div v-else class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <div
          v-for="col in STATUS_OPTIONS"
          :key="col.value"
          class="flex flex-col gap-2"
          @dragover="(e) => onColumnDragOver(e, col.value)"
          @dragleave="(e) => onColumnDragLeave(e, col.value)"
          @drop="(e) => onColumnDrop(e, col.value)"
        >
          <div class="flex items-center gap-2 pb-1">
            <component :is="statusIcon(col.value)" class="h-3.5 w-3.5" :class="col.value === 'done' ? 'text-green-500' : col.value === 'in_progress' ? 'text-blue-500' : 'text-muted-foreground'" />
            <span class="text-xs font-medium">{{ col.label }}</span>
            <Badge variant="secondary" class="h-4 px-1.5 text-[10px]">{{ tasks.tasksByStatus[col.value].length }}</Badge>
          </div>

          <!-- Drop zone with visual feedback -->
          <div
            :class="[
              'space-y-2 min-h-[60px] rounded-md border-2 border-dashed p-1 transition-all duration-200',
              dragOverColumn === col.value
                ? 'border-primary bg-primary/10 shadow-inner'
                : 'border-transparent',
            ]"
          >
            <Card
              v-for="task in tasks.tasksByStatus[col.value]"
              :key="task.id"
              draggable="true"
              @dragstart="(e: DragEvent) => onDragStart(e, task)"
              @dragend="onDragEnd"
              @click="openDetail(task)"
              :class="[
                'transition-all cursor-pointer',
                draggingTaskId === task.id ? 'opacity-40 scale-95 shadow-lg' : '',
                tasks.hasSubtasks(task.id)
                  ? 'border-l-2 border-l-primary/60 bg-accent/20'
                  : 'hover:bg-accent/50',
              ]"
            >
              <CardContent class="p-3">
                <div class="flex items-start gap-2">
                  <!-- Drag handle + Status button -->
                  <div class="mt-0.5 flex shrink-0 flex-col items-center gap-0.5">
                    <GripVertical class="h-3 w-3 cursor-grab text-muted-foreground/40 active:cursor-grabbing" />
                    <button
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
                  </div>
                  <div class="min-w-0 flex-1">
                    <!-- Parent badge (for orphaned subtasks) -->
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
                    <div
                      v-if="task.description"
                      class="mt-0.5 text-[10px] leading-tight text-muted-foreground line-clamp-2 prose prose-sm prose-neutral max-w-none dark:prose-invert [&>*]:m-0 [&>*]:text-[10px] [&>*]:leading-tight prose-code:text-primary prose-code:text-[9px] prose-code:before:content-none prose-code:after:content-none"
                      v-html="renderMarkdown(task.description)"
                    />
                    <div class="mt-1.5 flex flex-wrap items-center gap-1">
                      <!-- Priority badge -->
                      <Badge variant="outline" class="h-4.5 px-1.5 text-[10px]" :class="PRIORITY_OPTIONS.find(p => p.value === task.priority)?.color">
                        {{ task.priority }}
                      </Badge>

                      <!-- Epic progress indicator (for parents with subtasks) -->
                      <Badge v-if="tasks.hasSubtasks(task.id)" variant="secondary" class="h-4.5 px-1.5 text-[10px]">
                        {{ tasks.getSubtasks(task.id).filter(s => s.status === 'done').length }}/{{ tasks.getSubtasks(task.id).length }}
                      </Badge>

                      <!-- Dependency badges -->
                      <TooltipProvider v-if="task.dependencyIds.length > 0">
                        <Tooltip v-for="depTitle in tasks.getDependencyTitles(task)" :key="depTitle">
                          <TooltipTrigger as-child>
                            <Badge
                              variant="outline"
                              class="h-4.5 max-w-20 gap-0.5 truncate px-1.5 text-[10px]"
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
                        class="h-4.5 px-1.5 text-[10px] border-orange-500/40 text-orange-500"
                      >
                        blocked
                      </Badge>
                    </div>

                    <!-- Nested subtasks (collapsible) -->
                    <Collapsible
                      v-if="tasks.hasSubtasks(task.id)"
                      :open="!collapsedParents.has(task.id)"
                      class="mt-2"
                    >
                      <CollapsibleTrigger
                        class="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                        @click.stop="toggleCollapse(task.id)"
                      >
                        <ChevronRight
                          class="h-3 w-3 transition-transform duration-200"
                          :class="{ 'rotate-90': !collapsedParents.has(task.id) }"
                        />
                        <span>{{ tasks.getSubtasks(task.id).length }} subtasks</span>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <div class="mt-1.5 space-y-0.5 border-l border-border/50 pl-2 ml-1">
                          <div
                            v-for="sub in tasks.getSubtasks(task.id)"
                            :key="sub.id"
                            class="flex items-center gap-1.5 rounded py-0.5 px-1 group hover:bg-accent/30 transition-colors"
                          >
                            <button
                              class="shrink-0 cursor-pointer"
                              @click.stop="cycleSubtaskStatus(sub)"
                            >
                              <component
                                :is="statusIcon(sub.status)"
                                class="h-3 w-3"
                                :class="sub.status === 'done' ? 'text-green-500' : sub.status === 'in_progress' ? 'text-blue-500' : 'text-muted-foreground'"
                              />
                            </button>
                            <span
                              class="text-[10px] leading-tight flex-1 truncate"
                              :class="sub.status === 'done' ? 'line-through text-muted-foreground' : ''"
                              @click.stop="openDetail(sub)"
                            >
                              {{ sub.title }}
                            </span>
                            <Badge
                              variant="outline"
                              class="h-3 px-1 text-[8px] opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                              :class="PRIORITY_OPTIONS.find(p => p.value === sub.priority)?.color"
                            >
                              {{ sub.priority }}
                            </Badge>
                          </div>
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
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
                      class="rounded p-0.5 text-muted-foreground hover:bg-primary/10 hover:text-primary"
                      title="Send to Chat"
                      @click.stop="sendToChat(task)"
                    >
                      <MessageSquare class="h-3 w-3" />
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

    <!-- Task Detail Dialog -->
    <Dialog :open="showDetailDialog" @update:open="handleDetailClose">
      <DialogScrollContent class="max-w-lg">
        <DialogHeader>
          <DialogTitle>Task Details</DialogTitle>
          <DialogDescription>View and edit task information</DialogDescription>
        </DialogHeader>

        <div v-if="detailTask" class="space-y-4 py-2">
          <!-- Status display -->
          <div class="flex items-center gap-2">
            <component
              :is="statusIcon(detailTask.status)"
              class="h-4 w-4"
              :class="detailTask.status === 'done' ? 'text-green-500' : detailTask.status === 'in_progress' ? 'text-blue-500' : 'text-muted-foreground'"
            />
            <Badge :class="STATUS_OPTIONS.find(s => s.value === detailTask.status)?.color">
              {{ STATUS_OPTIONS.find(s => s.value === detailTask.status)?.label }}
            </Badge>
            <Badge v-if="tasks.isBlockedByDependency(detailTask)" variant="outline" class="border-orange-500/40 text-orange-500">
              blocked
            </Badge>
          </div>

          <!-- Title -->
          <div class="space-y-1">
            <label class="text-xs font-medium">Title</label>
            <Input v-model="editTitle" class="h-8 text-sm" @input="markDirty" />
          </div>

          <!-- Description -->
          <div class="space-y-1">
            <div class="flex items-center justify-between">
              <label class="text-xs font-medium">Description</label>
              <button
                v-if="editDescription"
                class="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                @click="descriptionPreview = !descriptionPreview"
              >
                {{ descriptionPreview ? 'Edit' : 'Preview' }}
              </button>
            </div>
            <div
              v-if="descriptionPreview && editDescription"
              class="min-h-[60px] rounded-md border border-border bg-muted/30 p-3 prose prose-sm prose-neutral max-w-none dark:prose-invert prose-pre:bg-muted/60 prose-pre:border prose-pre:border-border prose-code:text-primary prose-code:before:content-none prose-code:after:content-none prose-p:leading-relaxed prose-headings:text-foreground"
              v-html="renderMarkdown(editDescription)"
            />
            <Textarea
              v-else
              v-model="editDescription"
              placeholder="No description"
              class="min-h-[60px] text-sm"
              @input="markDirty"
            />
          </div>

          <!-- Details -->
          <div class="space-y-1">
            <div class="flex items-center justify-between">
              <label class="text-xs font-medium">Details / Implementation Notes</label>
              <button
                v-if="editDetails"
                class="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                @click="detailsPreview = !detailsPreview"
              >
                {{ detailsPreview ? 'Edit' : 'Preview' }}
              </button>
            </div>
            <div
              v-if="detailsPreview && editDetails"
              class="min-h-[80px] rounded-md border border-border bg-muted/30 p-3 prose prose-sm prose-neutral max-w-none dark:prose-invert prose-pre:bg-muted/60 prose-pre:border prose-pre:border-border prose-code:text-primary prose-code:before:content-none prose-code:after:content-none prose-p:leading-relaxed prose-headings:text-foreground"
              v-html="renderMarkdown(editDetails)"
            />
            <Textarea
              v-else
              v-model="editDetails"
              placeholder="No details"
              class="min-h-[80px] text-sm font-mono"
              @input="markDirty"
            />
          </div>

          <!-- Priority -->
          <div class="space-y-1">
            <label class="text-xs font-medium">Priority</label>
            <Select :model-value="editPriority" @update:model-value="(v: any) => { editPriority = v; markDirty(); }">
              <SelectTrigger class="h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="p in PRIORITY_OPTIONS" :key="p.value" :value="p.value">{{ p.label }}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <!-- Subtasks -->
          <div v-if="tasks.hasSubtasks(detailTask.id)">
            <label class="text-xs font-medium">Subtasks</label>
            <div class="mt-1 space-y-1">
              <div
                v-for="sub in tasks.getSubtasks(detailTask.id)"
                :key="sub.id"
                class="flex items-center gap-2 rounded-md border border-border/50 px-2 py-1.5 hover:bg-accent/30 transition-colors"
              >
                <button @click="cycleSubtaskStatus(sub)">
                  <component
                    :is="statusIcon(sub.status)"
                    class="h-3.5 w-3.5"
                    :class="sub.status === 'done' ? 'text-green-500' : sub.status === 'in_progress' ? 'text-blue-500' : 'text-muted-foreground'"
                  />
                </button>
                <span class="flex-1 text-xs" :class="sub.status === 'done' ? 'line-through text-muted-foreground' : ''">{{ sub.title }}</span>
                <Badge variant="outline" class="h-4 px-1 text-[9px] shrink-0" :class="PRIORITY_OPTIONS.find(p => p.value === sub.priority)?.color">
                  {{ sub.priority }}
                </Badge>
              </div>
            </div>
          </div>

          <!-- Dependencies -->
          <div v-if="detailTask.dependencyIds.length > 0">
            <label class="text-xs font-medium">Dependencies</label>
            <div class="mt-1 flex flex-wrap gap-1">
              <Badge v-for="title in tasks.getDependencyTitles(detailTask)" :key="title" variant="outline" class="gap-1">
                <Link2 class="h-2.5 w-2.5" />
                {{ title }}
              </Badge>
            </div>
          </div>

          <DialogFooter class="gap-2">
            <Button variant="outline" size="sm" class="gap-1" @click="sendToChat(detailTask!)">
              <MessageSquare class="h-3.5 w-3.5" />
              Send to Chat
            </Button>
            <div class="flex-1" />
            <Button variant="outline" size="sm" @click="showDetailDialog = false">
              {{ editDirty ? 'Cancel' : 'Close' }}
            </Button>
            <Button v-if="editDirty" size="sm" @click="saveDetail">
              Save Changes
            </Button>
          </DialogFooter>
        </div>
      </DialogScrollContent>
    </Dialog>
  </div>
</template>
