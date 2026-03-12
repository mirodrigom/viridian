import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { apiFetch } from '@/lib/apiFetch';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ScheduledTask {
  id: string;
  name: string;
  description: string;
  prompt: string;
  schedule: string;
  projectDir: string;
  enabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  status: string;
  createdAt: string;
}

export interface TaskExecution {
  id: string;
  taskId: string;
  status: string;
  output: string;
  error: string | null;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
}

export interface CreateScheduledTaskInput {
  name: string;
  description?: string;
  prompt: string;
  schedule: string;
  projectDir: string;
  enabled?: boolean;
}

export interface UpdateScheduledTaskInput {
  name?: string;
  description?: string;
  prompt?: string;
  schedule?: string;
  projectDir?: string;
  enabled?: boolean;
}

// ─── Schedule presets ─────────────────────────────────────────────────────────

export const SCHEDULE_PRESETS = [
  { label: 'Every 15 minutes', value: '*/15 * * * *' },
  { label: 'Every 30 minutes', value: '*/30 * * * *' },
  { label: 'Every hour', value: '0 * * * *' },
  { label: 'Every 6 hours', value: '0 */6 * * *' },
  { label: 'Daily at midnight', value: '0 0 * * *' },
  { label: 'Daily at 9 AM', value: '0 9 * * *' },
  { label: 'Daily at 6 PM', value: '0 18 * * *' },
  { label: 'Weekly on Monday', value: '0 9 * * 1' },
  { label: 'Weekly on Friday', value: '0 9 * * 5' },
  { label: 'Monthly (1st)', value: '0 0 1 * *' },
] as const;

// ─── Store ────────────────────────────────────────────────────────────────────

export const useScheduledTasksStore = defineStore('scheduledTasks', () => {
  const tasks = ref<ScheduledTask[]>([]);
  const loading = ref(false);
  const executionHistory = ref<Map<string, TaskExecution[]>>(new Map());
  const executionLoading = ref(false);

  // ─── Computed ─────────────────────────────────────────────────────────────

  const enabledCount = computed(() => tasks.value.filter(t => t.enabled).length);
  const runningCount = computed(() => tasks.value.filter(t => t.status === 'running').length);
  const taskCount = computed(() => tasks.value.length);

  // ─── Actions ──────────────────────────────────────────────────────────────

  async function fetchTasks() {
    loading.value = true;
    try {
      const res = await apiFetch('/api/scheduled-tasks');
      if (!res.ok) throw new Error('Failed to fetch scheduled tasks');
      const data = await res.json();
      tasks.value = data.tasks;
    } finally {
      loading.value = false;
    }
  }

  async function createTask(input: CreateScheduledTaskInput): Promise<ScheduledTask> {
    const res = await apiFetch('/api/scheduled-tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to create scheduled task');
    }
    const task: ScheduledTask = await res.json();
    tasks.value.unshift(task);
    return task;
  }

  async function updateTask(id: string, input: UpdateScheduledTaskInput): Promise<ScheduledTask> {
    const res = await apiFetch(`/api/scheduled-tasks/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to update scheduled task');
    }
    const updated: ScheduledTask = await res.json();
    const idx = tasks.value.findIndex(t => t.id === id);
    if (idx !== -1) tasks.value[idx] = updated;
    return updated;
  }

  async function deleteTask(id: string) {
    const res = await apiFetch(`/api/scheduled-tasks/${id}`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error('Failed to delete scheduled task');
    tasks.value = tasks.value.filter(t => t.id !== id);
    executionHistory.value.delete(id);
  }

  async function toggleTask(id: string, enabled: boolean) {
    return updateTask(id, { enabled });
  }

  async function runTaskNow(id: string) {
    const res = await apiFetch(`/api/scheduled-tasks/${id}/run`, {
      method: 'POST',
    });
    if (!res.ok) throw new Error('Failed to trigger task');
    // Optimistically update status
    const task = tasks.value.find(t => t.id === id);
    if (task) task.status = 'running';
  }

  async function fetchHistory(taskId: string, limit = 20) {
    executionLoading.value = true;
    try {
      const res = await apiFetch(`/api/scheduled-tasks/${taskId}/history?limit=${limit}`);
      if (!res.ok) throw new Error('Failed to fetch execution history');
      const data = await res.json();
      executionHistory.value.set(taskId, data.executions);
      // Force reactivity
      executionHistory.value = new Map(executionHistory.value);
      return data.executions as TaskExecution[];
    } finally {
      executionLoading.value = false;
    }
  }

  function getHistory(taskId: string): TaskExecution[] {
    return executionHistory.value.get(taskId) ?? [];
  }

  return {
    tasks,
    loading,
    executionHistory,
    executionLoading,
    enabledCount,
    runningCount,
    taskCount,
    fetchTasks,
    createTask,
    updateTask,
    deleteTask,
    toggleTask,
    runTaskNow,
    fetchHistory,
    getHistory,
  };
});
