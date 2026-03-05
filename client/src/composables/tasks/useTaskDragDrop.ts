import { ref } from 'vue';
import type { Task, TaskStatus } from '@/stores/tasks';

interface DragDropDeps {
  tasksStore: {
    getTask: (id: string) => Task | undefined;
    tasksByStatus: Record<TaskStatus, Task[]>;
    updateTask: (id: string, data: Partial<Task>) => Promise<void>;
    reorderTasks: (ids: string[]) => Promise<void>;
  };
}

export function useTaskDragDrop(deps: DragDropDeps) {
  const draggingTaskId = ref<string | null>(null);
  const dragOverColumn = ref<TaskStatus | null>(null);

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

    const task = deps.tasksStore.getTask(taskId);
    if (!task) return;

    if (task.status !== targetStatus) {
      await deps.tasksStore.updateTask(taskId, { status: targetStatus });
    }

    const columnTasks = deps.tasksStore.tasksByStatus[targetStatus].map(t => t.id);
    if (!columnTasks.includes(taskId)) columnTasks.push(taskId);
    await deps.tasksStore.reorderTasks(columnTasks);

    draggingTaskId.value = null;
  }

  return {
    draggingTaskId,
    dragOverColumn,
    onDragStart,
    onDragEnd,
    onColumnDragOver,
    onColumnDragLeave,
    onColumnDrop,
  };
}
