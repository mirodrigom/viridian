import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { useAuthStore } from './auth';

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

  const rootTasks = computed(() =>
    tasks.value
      .filter(t => !t.parentId)
      .filter(t => !filterStatus.value || t.status === filterStatus.value)
      .filter(t => !filterPriority.value || t.priority === filterPriority.value),
  );

  const tasksByStatus = computed(() => {
    const grouped: Record<TaskStatus, Task[]> = { todo: [], in_progress: [], done: [] };
    for (const t of rootTasks.value) {
      grouped[t.status].push(t);
    }
    return grouped;
  });

  function getSubtasks(parentId: string): Task[] {
    return tasks.value.filter(t => t.parentId === parentId).sort((a, b) => a.sortOrder - b.sortOrder);
  }

  function getTask(id: string): Task | undefined {
    return tasks.value.find(t => t.id === id);
  }

  const stats = computed(() => {
    const root = tasks.value.filter(t => !t.parentId);
    return {
      total: root.length,
      todo: root.filter(t => t.status === 'todo').length,
      inProgress: root.filter(t => t.status === 'in_progress').length,
      done: root.filter(t => t.status === 'done').length,
      progress: root.length > 0 ? Math.round((root.filter(t => t.status === 'done').length / root.length) * 100) : 0,
    };
  });

  async function fetchTasks(projectPath: string) {
    const auth = useAuthStore();
    loading.value = true;
    try {
      const res = await fetch(`/api/tasks?project=${encodeURIComponent(projectPath)}`, {
        headers: { Authorization: `Bearer ${auth.token}` },
      });
      if (!res.ok) throw new Error('Failed to fetch tasks');
      const data = await res.json();
      tasks.value = data.tasks;
    } finally {
      loading.value = false;
    }
  }

  async function createTask(projectPath: string, task: { title: string; description?: string; details?: string; priority?: TaskPriority; parentId?: string }) {
    const auth = useAuthStore();
    const res = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` },
      body: JSON.stringify({ ...task, project: projectPath }),
    });
    if (!res.ok) throw new Error('Failed to create task');
    const newTask: Task = await res.json();
    tasks.value.push(newTask);
    return newTask;
  }

  async function updateTask(id: string, updates: Partial<Pick<Task, 'title' | 'description' | 'details' | 'status' | 'priority' | 'parentId' | 'dependencyIds' | 'sortOrder'>>) {
    const auth = useAuthStore();
    const res = await fetch(`/api/tasks/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` },
      body: JSON.stringify(updates),
    });
    if (!res.ok) throw new Error('Failed to update task');
    const updated: Task = await res.json();
    const idx = tasks.value.findIndex(t => t.id === id);
    if (idx !== -1) tasks.value[idx] = updated;
    return updated;
  }

  async function deleteTask(id: string) {
    const auth = useAuthStore();
    const res = await fetch(`/api/tasks/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${auth.token}` },
    });
    if (!res.ok) throw new Error('Failed to delete task');
    tasks.value = tasks.value.filter(t => t.id !== id && t.parentId !== id);
  }

  async function parsePrd(projectPath: string, prdText: string, onDelta?: (text: string) => void): Promise<Task[]> {
    const auth = useAuthStore();
    prdParsing.value = true;

    try {
      const res = await fetch('/api/tasks/parse-prd', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` },
        body: JSON.stringify({ prd: prdText, project: projectPath }),
      });

      if (!res.ok) throw new Error('Failed to parse PRD');

      const reader = res.body!.getReader();
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
              if (data.text && onDelta) onDelta(data.text);
              if (data.tasks) {
                newTasks = data.tasks;
                tasks.value.push(...newTasks);
              }
              if (data.error) throw new Error(data.error);
            } catch { /* skip */ }
          }
        }
      }

      return newTasks;
    } finally {
      prdParsing.value = false;
    }
  }

  async function expandTask(taskId: string, onDelta?: (text: string) => void): Promise<Task[]> {
    const auth = useAuthStore();

    const res = await fetch(`/api/tasks/${taskId}/expand`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` },
    });

    if (!res.ok) throw new Error('Failed to expand task');

    const reader = res.body!.getReader();
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
            if (data.text && onDelta) onDelta(data.text);
            if (data.subtasks) {
              subtasks = data.subtasks;
              // Remove old subtasks, add new ones
              tasks.value = tasks.value.filter(t => t.parentId !== taskId);
              tasks.value.push(...subtasks);
            }
          } catch { /* skip */ }
        }
      }
    }

    return subtasks;
  }

  return {
    tasks,
    loading,
    filterStatus,
    filterPriority,
    prdParsing,
    rootTasks,
    tasksByStatus,
    stats,
    getSubtasks,
    getTask,
    fetchTasks,
    createTask,
    updateTask,
    deleteTask,
    parsePrd,
    expandTask,
  };
});
