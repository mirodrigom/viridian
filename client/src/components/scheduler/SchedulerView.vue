<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useScheduledTasksStore, type ScheduledTask } from '@/stores/scheduledTasks';
import { useChatStore } from '@/stores/chat';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'vue-sonner';
import {
  CalendarClock,
  Plus,
  Play,
  Trash2,
  Pencil,
  History,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertCircle,
} from 'lucide-vue-next';
import TaskForm from './TaskForm.vue';
import TaskHistoryDialog from './TaskHistoryDialog.vue';

const store = useScheduledTasksStore();
const chat = useChatStore();

const showForm = ref(false);
const editingTask = ref<ScheduledTask | null>(null);
const historyTaskId = ref<string | null>(null);

onMounted(() => {
  store.fetchTasks();
});

function openCreateForm() {
  editingTask.value = null;
  showForm.value = true;
}

function openEditForm(task: ScheduledTask) {
  editingTask.value = task;
  showForm.value = true;
}

function closeForm() {
  showForm.value = false;
  editingTask.value = null;
}

async function handleToggle(task: ScheduledTask, enabled: boolean) {
  try {
    await store.toggleTask(task.id, enabled);
    toast.success(`Task "${task.name}" ${enabled ? 'enabled' : 'disabled'}`);
  } catch {
    toast.error('Failed to toggle task');
  }
}

async function handleDelete(task: ScheduledTask) {
  if (!confirm(`Delete scheduled task "${task.name}"?`)) return;
  try {
    await store.deleteTask(task.id);
    toast.success('Task deleted');
  } catch {
    toast.error('Failed to delete task');
  }
}

async function handleRunNow(task: ScheduledTask) {
  try {
    await store.runTaskNow(task.id);
    toast.success(`Task "${task.name}" triggered`);
    // Refresh after a delay to pick up status changes
    setTimeout(() => store.fetchTasks(), 3000);
  } catch {
    toast.error('Failed to trigger task');
  }
}

function openHistory(taskId: string) {
  historyTaskId.value = taskId;
}

function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return 'Never';
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const absDiff = Math.abs(diffMs);

  if (absDiff < 60_000) return diffMs > 0 ? 'in less than a minute' : 'just now';
  if (absDiff < 3600_000) {
    const mins = Math.round(absDiff / 60_000);
    return diffMs > 0 ? `in ${mins}m` : `${mins}m ago`;
  }
  if (absDiff < 86400_000) {
    const hours = Math.round(absDiff / 3600_000);
    return diffMs > 0 ? `in ${hours}h` : `${hours}h ago`;
  }
  const days = Math.round(absDiff / 86400_000);
  return diffMs > 0 ? `in ${days}d` : `${days}d ago`;
}

function statusColor(status: string): string {
  switch (status) {
    case 'running': return 'bg-blue-500/15 text-blue-500';
    case 'success':
    case 'idle': return 'bg-green-500/15 text-green-500';
    case 'failure':
    case 'error': return 'bg-red-500/15 text-red-500';
    default: return 'bg-muted text-muted-foreground';
  }
}
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- Header -->
    <div class="flex items-center justify-between border-b border-border px-4 py-3">
      <div class="flex items-center gap-2">
        <CalendarClock class="h-5 w-5 text-primary" />
        <h2 class="text-lg font-semibold">Scheduled Tasks</h2>
        <Badge v-if="store.enabledCount > 0" variant="secondary" class="text-xs">
          {{ store.enabledCount }} active
        </Badge>
      </div>
      <Button size="sm" @click="openCreateForm">
        <Plus class="mr-1 h-4 w-4" />
        New Task
      </Button>
    </div>

    <!-- Task list -->
    <ScrollArea class="flex-1">
      <div v-if="store.loading" class="flex items-center justify-center py-12">
        <Loader2 class="h-6 w-6 animate-spin text-muted-foreground" />
      </div>

      <div v-else-if="store.tasks.length === 0" class="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <CalendarClock class="mb-3 h-12 w-12 opacity-40" />
        <p class="text-sm font-medium">No scheduled tasks yet</p>
        <p class="mt-1 text-xs">Create a task to automate recurring AI operations</p>
        <Button variant="outline" size="sm" class="mt-4" @click="openCreateForm">
          <Plus class="mr-1 h-4 w-4" />
          Create Task
        </Button>
      </div>

      <div v-else class="divide-y divide-border">
        <div
          v-for="task in store.tasks"
          :key="task.id"
          class="group flex items-start gap-3 px-4 py-3 hover:bg-muted/30 transition-colors"
        >
          <!-- Enable toggle -->
          <div class="pt-0.5">
            <Switch
              :checked="task.enabled"
              @update:checked="(v: boolean) => handleToggle(task, v)"
            />
          </div>

          <!-- Task info -->
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <span class="font-medium text-sm truncate" :class="{ 'text-muted-foreground': !task.enabled }">
                {{ task.name }}
              </span>
              <Badge :class="statusColor(task.status)" class="text-[10px] px-1.5 py-0">
                <Loader2 v-if="task.status === 'running'" class="mr-1 h-3 w-3 animate-spin" />
                <CheckCircle2 v-else-if="task.status === 'idle' || task.status === 'success'" class="mr-1 h-3 w-3" />
                <XCircle v-else-if="task.status === 'failure' || task.status === 'error'" class="mr-1 h-3 w-3" />
                <AlertCircle v-else class="mr-1 h-3 w-3" />
                {{ task.status }}
              </Badge>
            </div>

            <p v-if="task.description" class="mt-0.5 text-xs text-muted-foreground truncate">
              {{ task.description }}
            </p>

            <div class="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <span class="flex items-center gap-1" :title="task.schedule">
                <Clock class="h-3 w-3" />
                <code class="rounded bg-muted px-1 py-0.5 text-[10px]">{{ task.schedule }}</code>
              </span>
              <span v-if="task.nextRunAt && task.enabled" class="flex items-center gap-1">
                Next: {{ formatRelativeTime(task.nextRunAt) }}
              </span>
              <span v-if="task.lastRunAt" class="flex items-center gap-1">
                Last: {{ formatRelativeTime(task.lastRunAt) }}
              </span>
            </div>
          </div>

          <!-- Actions -->
          <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
            <Button variant="ghost" size="sm" class="h-7 w-7 p-0" title="Run now" @click="handleRunNow(task)">
              <Play class="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="sm" class="h-7 w-7 p-0" title="History" @click="openHistory(task.id)">
              <History class="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="sm" class="h-7 w-7 p-0" title="Edit" @click="openEditForm(task)">
              <Pencil class="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="sm" class="h-7 w-7 p-0 text-destructive" title="Delete" @click="handleDelete(task)">
              <Trash2 class="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>
    </ScrollArea>

    <!-- Task form dialog -->
    <TaskForm
      :open="showForm"
      :task="editingTask"
      :default-project-dir="chat.projectPath || '/home'"
      @close="closeForm"
      @saved="closeForm"
    />

    <!-- Execution history dialog -->
    <TaskHistoryDialog
      :task-id="historyTaskId"
      :task-name="store.tasks.find(t => t.id === historyTaskId)?.name ?? ''"
      @close="historyTaskId = null"
    />
  </div>
</template>
