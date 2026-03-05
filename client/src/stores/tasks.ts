import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { apiFetch } from '@/lib/apiFetch';
import { useProviderStore } from './provider';

export interface Task {
  id: string;
  projectPath: string;
  title: string;
  description: string;
  details: string;
  status: 'todo' | 'in_progress' | 'done';
  priority: 'low' | 'medium' | 'high';
  parentId: string | null;
  dependencyIds: string[];
  prdSource: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export type TaskStatus = Task['status'];
export type TaskPriority = Task['priority'];

export const STATUS_OPTIONS: { value: TaskStatus; label: string; color: string }[] = [
  { value: 'todo', label: 'To Do', color: 'bg-muted text-muted-foreground' },
  { value: 'in_progress', label: 'In Progress', color: 'bg-blue-500/15 text-blue-500' },
  { value: 'done', label: 'Done', color: 'bg-green-500/15 text-green-500' },
];

export const PRIORITY_OPTIONS: { value: TaskPriority; label: string; color: string }[] = [
  { value: 'high', label: 'High', color: 'bg-red-500/15 text-red-500' },
  { value: 'medium', label: 'Medium', color: 'bg-yellow-500/15 text-yellow-600' },
  { value: 'low', label: 'Low', color: 'bg-muted text-muted-foreground' },
];

export const useTasksStore = defineStore('tasks', () => {
  const tasks = ref<Task[]>([]);
  const loading = ref(false);
  const filterStatus = ref<TaskStatus | ''>('');
  const filterPriority = ref<TaskPriority | ''>('');
  const prdParsing = ref(false);
  const prdChatting = ref(false);
  const prdFinalizing = ref(false);

  const rootTasks = computed(() =>
    tasks.value
      .filter(t => !t.parentId)
      .filter(t => !filterStatus.value || t.status === filterStatus.value)
      .filter(t => !filterPriority.value || t.priority === filterPriority.value),
  );

  const allFilteredTasks = computed(() =>
    tasks.value
      .filter(t => !filterStatus.value || t.status === filterStatus.value)
      .filter(t => !filterPriority.value || t.priority === filterPriority.value),
  );

  const tasksByStatus = computed(() => {
    const grouped: Record<TaskStatus, Task[]> = { todo: [], in_progress: [], done: [] };
    // Only show root tasks and orphaned subtasks at top level;
    // subtasks with existing parents are rendered inline inside parent cards
    const rootIds = new Set(tasks.value.filter(t => !t.parentId).map(t => t.id));
    for (const t of allFilteredTasks.value) {
      if (!t.parentId || !rootIds.has(t.parentId)) {
        grouped[t.status].push(t);
      }
    }
    for (const status of Object.keys(grouped) as TaskStatus[]) {
      grouped[status].sort((a, b) => a.sortOrder - b.sortOrder);
    }
    return grouped;
  });

  function getSubtasks(parentId: string): Task[] {
    return tasks.value.filter(t => t.parentId === parentId).sort((a, b) => a.sortOrder - b.sortOrder);
  }

  function getTask(id: string): Task | undefined {
    return tasks.value.find(t => t.id === id);
  }

  function hasSubtasks(taskId: string): boolean {
    return tasks.value.some(t => t.parentId === taskId);
  }

  function getParentTitle(task: Task): string | null {
    if (!task.parentId) return null;
    const parent = tasks.value.find(t => t.id === task.parentId);
    return parent?.title ?? null;
  }

  function getDependencyTitles(task: Task): string[] {
    return task.dependencyIds
      .map(id => tasks.value.find(t => t.id === id)?.title)
      .filter(Boolean) as string[];
  }

  function isBlockedByDependency(task: Task): boolean {
    return task.dependencyIds.some(depId => {
      const dep = tasks.value.find(t => t.id === depId);
      return dep && dep.status !== 'done';
    });
  }

  // Stats based on leaf tasks (actual work items, not parents)
  const stats = computed(() => {
    const parentIds = new Set(tasks.value.filter(t => t.parentId).map(t => t.parentId!));
    const leaves = tasks.value.filter(t => !parentIds.has(t.id));
    return {
      total: leaves.length,
      todo: leaves.filter(t => t.status === 'todo').length,
      inProgress: leaves.filter(t => t.status === 'in_progress').length,
      done: leaves.filter(t => t.status === 'done').length,
      progress: leaves.length > 0 ? Math.round((leaves.filter(t => t.status === 'done').length / leaves.length) * 100) : 0,
    };
  });

  async function fetchTasks(projectPath: string) {
    loading.value = true;
    try {
      const res = await apiFetch(`/api/tasks?project=${encodeURIComponent(projectPath)}`);
      if (!res.ok) throw new Error('Failed to fetch tasks');
      const data = await res.json();
      tasks.value = data.tasks;
    } finally {
      loading.value = false;
    }
  }

  async function createTask(projectPath: string, task: { title: string; description?: string; details?: string; priority?: TaskPriority; parentId?: string }) {
    const res = await apiFetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...task, project: projectPath }),
    });
    if (!res.ok) throw new Error('Failed to create task');
    const newTask: Task = await res.json();
    tasks.value.push(newTask);
    return newTask;
  }

  async function updateTask(id: string, updates: Partial<Pick<Task, 'title' | 'description' | 'details' | 'status' | 'priority' | 'parentId' | 'dependencyIds' | 'sortOrder'>>) {
    const res = await apiFetch(`/api/tasks/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    if (!res.ok) throw new Error('Failed to update task');
    const data = await res.json();

    // Update the task itself
    const updated: Task = data.task;
    const idx = tasks.value.findIndex(t => t.id === id);
    if (idx !== -1) tasks.value[idx] = updated;

    // If parent was auto-synced, update it too
    if (data.parentUpdate) {
      const parentIdx = tasks.value.findIndex(t => t.id === data.parentUpdate.id);
      if (parentIdx !== -1) tasks.value[parentIdx] = data.parentUpdate;
    }

    return updated;
  }

  async function deleteTask(id: string) {
    const res = await apiFetch(`/api/tasks/${id}`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error('Failed to delete task');
    tasks.value = tasks.value.filter(t => t.id !== id && t.parentId !== id);
  }

  async function parsePrd(projectPath: string, prdText: string, onDelta?: (text: string) => void): Promise<Task[]> {
    prdParsing.value = true;
    const providerStore = useProviderStore();

    try {
      const res = await apiFetch('/api/tasks/parse-prd', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prd: prdText, project: projectPath, providerId: providerStore.activeProviderId }),
      });

      if (!res.ok) throw new Error('Failed to parse PRD');
      if (!res.body) throw new Error('No response body');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let newTasks: Task[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('event: delta')) continue;
          if (line.startsWith('event: done')) continue;
          if (line.startsWith('event: error')) continue;
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.error) throw new Error(data.error);
              if (data.text && onDelta) onDelta(data.text);
              if (data.tasks) {
                newTasks = data.tasks;
                tasks.value.push(...newTasks);
              }
            } catch (err) {
              if (err instanceof Error && err.message !== line.slice(6)) throw err;
              // skip unparseable SSE lines
            }
          }
        }
      }

      return newTasks;
    } finally {
      prdParsing.value = false;
    }
  }

  async function expandTask(taskId: string, onDelta?: (text: string) => void): Promise<Task[]> {
    const providerStore = useProviderStore();
    const res = await apiFetch(`/api/tasks/${taskId}/expand`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerId: providerStore.activeProviderId }),
    });

    if (!res.ok) throw new Error('Failed to expand task');
    if (!res.body) throw new Error('No response body');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let subtasks: Task[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            if (data.error) throw new Error(data.error);
            if (data.text && onDelta) onDelta(data.text);
            if (data.subtasks) {
              subtasks = data.subtasks;
              tasks.value = tasks.value.filter(t => t.parentId !== taskId);
              tasks.value.push(...subtasks);
            }
          } catch (err) {
            if (err instanceof Error && err.message !== line.slice(6)) throw err;
          }
        }
      }
    }

    return subtasks;
  }

  async function sendPrdMessage(
    project: string,
    message: string,
    prd: string | undefined,
    sessionId: string | undefined,
    onDelta?: (text: string) => void,
  ): Promise<string | undefined> {
    prdChatting.value = true;
    const providerStore = useProviderStore();
    try {
      const res = await apiFetch('/api/tasks/prd-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, project, sessionId, prd, providerId: providerStore.activeProviderId }),
      });
      if (!res.ok) throw new Error('Failed to start PRD chat');
      if (!res.body) throw new Error('No response body');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let returnedSessionId: string | undefined;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.error) throw new Error(data.error);
              if (data.text && onDelta) onDelta(data.text);
              if (data.sessionId) returnedSessionId = data.sessionId;
            } catch (err) {
              if (err instanceof Error && err.message !== line.slice(6)) throw err;
            }
          }
        }
      }
      return returnedSessionId;
    } finally {
      prdChatting.value = false;
    }
  }

  async function finalizePrd(
    project: string,
    sessionId: string,
    prd: string,
    onDelta?: (text: string) => void,
  ): Promise<Task[]> {
    prdFinalizing.value = true;
    const providerStore = useProviderStore();
    try {
      const res = await apiFetch('/api/tasks/prd-finalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project, sessionId, prd, providerId: providerStore.activeProviderId }),
      });
      if (!res.ok) throw new Error('Failed to finalize PRD');
      if (!res.body) throw new Error('No response body');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let newTasks: Task[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.error) throw new Error(data.error);
              if (data.text && onDelta) onDelta(data.text);
              if (data.tasks) {
                newTasks = data.tasks;
                tasks.value.push(...newTasks);
              }
            } catch (err) {
              if (err instanceof Error && err.message !== line.slice(6)) throw err;
            }
          }
        }
      }
      return newTasks;
    } finally {
      prdFinalizing.value = false;
    }
  }

  async function reorderTasks(taskIds: string[]) {
    await apiFetch('/api/tasks/reorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskIds }),
    });
    taskIds.forEach((id, index) => {
      const task = tasks.value.find(t => t.id === id);
      if (task) task.sortOrder = index;
    });
  }

  return {
    tasks,
    loading,
    filterStatus,
    filterPriority,
    prdParsing,
    prdChatting,
    prdFinalizing,
    rootTasks,
    tasksByStatus,
    stats,
    getSubtasks,
    getTask,
    hasSubtasks,
    getParentTitle,
    getDependencyTitles,
    isBlockedByDependency,
    fetchTasks,
    createTask,
    updateTask,
    deleteTask,
    parsePrd,
    sendPrdMessage,
    finalizePrd,
    expandTask,
    reorderTasks,
  };
});
