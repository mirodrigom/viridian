import { describe, it, expect } from 'vitest';

/**
 * Tests for pure functions from tasks.ts.
 * Re-implemented to avoid Pinia store dependencies.
 */

// ─── Types ──────────────────────────────────────────────────────────────

interface Task {
  id: string;
  title: string;
  status: 'todo' | 'in_progress' | 'done';
  priority: 'low' | 'medium' | 'high';
  parentId: string | null;
  dependencyIds: string[];
  sortOrder: number;
}

type TaskStatus = Task['status'];
type TaskPriority = Task['priority'];

// ─── Re-implemented pure functions ──────────────────────────────────────

function filterTasks(
  tasks: Task[],
  filterStatus: TaskStatus | '',
  filterPriority: TaskPriority | '',
): Task[] {
  return tasks
    .filter(t => !filterStatus || t.status === filterStatus)
    .filter(t => !filterPriority || t.priority === filterPriority);
}

function tasksByStatus(
  tasks: Task[],
  allFiltered: Task[],
): Record<TaskStatus, Task[]> {
  const grouped: Record<TaskStatus, Task[]> = { todo: [], in_progress: [], done: [] };
  const rootIds = new Set(tasks.filter(t => !t.parentId).map(t => t.id));
  for (const t of allFiltered) {
    if (!t.parentId || !rootIds.has(t.parentId)) {
      grouped[t.status].push(t);
    }
  }
  for (const status of Object.keys(grouped) as TaskStatus[]) {
    grouped[status].sort((a, b) => a.sortOrder - b.sortOrder);
  }
  return grouped;
}

function getSubtasks(tasks: Task[], parentId: string): Task[] {
  return tasks.filter(t => t.parentId === parentId).sort((a, b) => a.sortOrder - b.sortOrder);
}

function isBlockedByDependency(tasks: Task[], task: Task): boolean {
  return task.dependencyIds.some(depId => {
    const dep = tasks.find(t => t.id === depId);
    return dep && dep.status !== 'done';
  });
}

function computeStats(tasks: Task[]) {
  const parentIds = new Set(tasks.filter(t => t.parentId).map(t => t.parentId!));
  const leaves = tasks.filter(t => !parentIds.has(t.id));
  return {
    total: leaves.length,
    todo: leaves.filter(t => t.status === 'todo').length,
    inProgress: leaves.filter(t => t.status === 'in_progress').length,
    done: leaves.filter(t => t.status === 'done').length,
    progress: leaves.length > 0
      ? Math.round((leaves.filter(t => t.status === 'done').length / leaves.length) * 100)
      : 0,
  };
}

function getDependencyTitles(tasks: Task[], task: Task): string[] {
  return task.dependencyIds
    .map(id => tasks.find(t => t.id === id)?.title)
    .filter(Boolean) as string[];
}

// ─── Test data factory ──────────────────────────────────────────────────

function makeTask(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    title: `Task ${id}`,
    status: 'todo',
    priority: 'medium',
    parentId: null,
    dependencyIds: [],
    sortOrder: 0,
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────

describe('filterTasks', () => {
  const tasks = [
    makeTask('1', { status: 'todo', priority: 'high' }),
    makeTask('2', { status: 'in_progress', priority: 'medium' }),
    makeTask('3', { status: 'done', priority: 'low' }),
    makeTask('4', { status: 'todo', priority: 'low' }),
  ];

  it('returns all tasks when no filters', () => {
    expect(filterTasks(tasks, '', '')).toHaveLength(4);
  });

  it('filters by status', () => {
    expect(filterTasks(tasks, 'todo', '')).toHaveLength(2);
    expect(filterTasks(tasks, 'in_progress', '')).toHaveLength(1);
    expect(filterTasks(tasks, 'done', '')).toHaveLength(1);
  });

  it('filters by priority', () => {
    expect(filterTasks(tasks, '', 'high')).toHaveLength(1);
    expect(filterTasks(tasks, '', 'low')).toHaveLength(2);
  });

  it('combines status + priority filters', () => {
    expect(filterTasks(tasks, 'todo', 'low')).toHaveLength(1);
    expect(filterTasks(tasks, 'todo', 'high')).toHaveLength(1);
    expect(filterTasks(tasks, 'done', 'high')).toHaveLength(0);
  });
});

describe('tasksByStatus', () => {
  it('groups tasks by status', () => {
    const tasks = [
      makeTask('1', { status: 'todo', sortOrder: 1 }),
      makeTask('2', { status: 'in_progress', sortOrder: 1 }),
      makeTask('3', { status: 'done', sortOrder: 1 }),
    ];
    const result = tasksByStatus(tasks, tasks);
    expect(result.todo).toHaveLength(1);
    expect(result.in_progress).toHaveLength(1);
    expect(result.done).toHaveLength(1);
  });

  it('hides subtasks whose parent exists as a root task', () => {
    const tasks = [
      makeTask('parent', { status: 'todo', sortOrder: 1 }),
      makeTask('child', { status: 'todo', sortOrder: 2, parentId: 'parent' }),
    ];
    const result = tasksByStatus(tasks, tasks);
    // Child should not appear at top level since parent exists
    expect(result.todo).toHaveLength(1);
    expect(result.todo[0]!.id).toBe('parent');
  });

  it('shows orphaned subtasks (parent no longer exists)', () => {
    const tasks = [
      makeTask('child', { status: 'todo', sortOrder: 1, parentId: 'deleted-parent' }),
    ];
    const result = tasksByStatus(tasks, tasks);
    // No parent with id 'deleted-parent' in roots → child shows at top level
    expect(result.todo).toHaveLength(1);
    expect(result.todo[0]!.id).toBe('child');
  });

  it('sorts within each status group by sortOrder', () => {
    const tasks = [
      makeTask('b', { status: 'todo', sortOrder: 5 }),
      makeTask('a', { status: 'todo', sortOrder: 1 }),
      makeTask('c', { status: 'todo', sortOrder: 3 }),
    ];
    const result = tasksByStatus(tasks, tasks);
    expect(result.todo.map(t => t.id)).toEqual(['a', 'c', 'b']);
  });
});

describe('getSubtasks', () => {
  it('returns subtasks for a parent, sorted by sortOrder', () => {
    const tasks = [
      makeTask('parent', { status: 'todo' }),
      makeTask('child-b', { parentId: 'parent', sortOrder: 2 }),
      makeTask('child-a', { parentId: 'parent', sortOrder: 1 }),
      makeTask('other', { parentId: 'other-parent', sortOrder: 1 }),
    ];
    const subs = getSubtasks(tasks, 'parent');
    expect(subs).toHaveLength(2);
    expect(subs[0]!.id).toBe('child-a');
    expect(subs[1]!.id).toBe('child-b');
  });

  it('returns empty for parent with no children', () => {
    const tasks = [makeTask('parent')];
    expect(getSubtasks(tasks, 'parent')).toEqual([]);
  });
});

describe('isBlockedByDependency', () => {
  it('returns true when any dependency is not done', () => {
    const tasks = [
      makeTask('dep-1', { status: 'todo' }),
      makeTask('dep-2', { status: 'done' }),
      makeTask('task', { dependencyIds: ['dep-1', 'dep-2'] }),
    ];
    expect(isBlockedByDependency(tasks, tasks[2]!)).toBe(true);
  });

  it('returns false when all dependencies are done', () => {
    const tasks = [
      makeTask('dep-1', { status: 'done' }),
      makeTask('dep-2', { status: 'done' }),
      makeTask('task', { dependencyIds: ['dep-1', 'dep-2'] }),
    ];
    expect(isBlockedByDependency(tasks, tasks[2]!)).toBe(false);
  });

  it('returns false when task has no dependencies', () => {
    const tasks = [makeTask('task', { dependencyIds: [] })];
    expect(isBlockedByDependency(tasks, tasks[0]!)).toBe(false);
  });

  it('returns false when dependency does not exist (deleted)', () => {
    const tasks = [
      makeTask('task', { dependencyIds: ['nonexistent'] }),
    ];
    expect(isBlockedByDependency(tasks, tasks[0]!)).toBe(false);
  });

  it('in_progress dependency blocks', () => {
    const tasks = [
      makeTask('dep', { status: 'in_progress' }),
      makeTask('task', { dependencyIds: ['dep'] }),
    ];
    expect(isBlockedByDependency(tasks, tasks[1]!)).toBe(true);
  });
});

describe('computeStats', () => {
  it('counts leaf tasks (non-parent)', () => {
    const tasks = [
      makeTask('parent', { status: 'todo' }),
      makeTask('child-1', { status: 'done', parentId: 'parent' }),
      makeTask('child-2', { status: 'todo', parentId: 'parent' }),
      makeTask('standalone', { status: 'done' }),
    ];
    // parent is a parent (children reference it), so leaves = child-1, child-2, standalone
    const stats = computeStats(tasks);
    expect(stats.total).toBe(3);
    expect(stats.done).toBe(2);
    expect(stats.todo).toBe(1);
  });

  it('calculates progress percentage', () => {
    const tasks = [
      makeTask('1', { status: 'done' }),
      makeTask('2', { status: 'done' }),
      makeTask('3', { status: 'todo' }),
      makeTask('4', { status: 'todo' }),
    ];
    const stats = computeStats(tasks);
    expect(stats.progress).toBe(50);
  });

  it('returns 0% progress when no tasks', () => {
    expect(computeStats([]).progress).toBe(0);
  });

  it('returns 100% when all done', () => {
    const tasks = [
      makeTask('1', { status: 'done' }),
      makeTask('2', { status: 'done' }),
    ];
    expect(computeStats(tasks).progress).toBe(100);
  });

  it('counts in_progress separately', () => {
    const tasks = [
      makeTask('1', { status: 'in_progress' }),
      makeTask('2', { status: 'todo' }),
    ];
    const stats = computeStats(tasks);
    expect(stats.inProgress).toBe(1);
    expect(stats.todo).toBe(1);
    expect(stats.done).toBe(0);
  });
});

describe('getDependencyTitles', () => {
  it('returns titles of existing dependencies', () => {
    const tasks = [
      makeTask('dep-1', { title: 'Setup DB' }),
      makeTask('dep-2', { title: 'Create API' }),
      makeTask('task', { dependencyIds: ['dep-1', 'dep-2'] }),
    ];
    expect(getDependencyTitles(tasks, tasks[2]!)).toEqual(['Setup DB', 'Create API']);
  });

  it('filters out deleted dependencies', () => {
    const tasks = [
      makeTask('dep-1', { title: 'Exists' }),
      makeTask('task', { dependencyIds: ['dep-1', 'deleted'] }),
    ];
    expect(getDependencyTitles(tasks, tasks[1]!)).toEqual(['Exists']);
  });

  it('returns empty for no dependencies', () => {
    const tasks = [makeTask('task')];
    expect(getDependencyTitles(tasks, tasks[0]!)).toEqual([]);
  });
});
