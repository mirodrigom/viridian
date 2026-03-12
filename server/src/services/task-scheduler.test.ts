import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Mocks ──────────────────────────────────────────────────────────────

const mockStop = vi.fn();
const mockSchedule = vi.fn(() => ({ stop: mockStop }));
const mockValidate = vi.fn((expr: string) => {
  // Simple validation: must have 5 space-separated fields
  return expr.trim().split(/\s+/).length >= 5;
});

vi.mock('node-cron', () => ({
  default: {
    schedule: (...args: unknown[]) => mockSchedule(...args),
    validate: (expr: string) => mockValidate(expr),
  },
  schedule: (...args: unknown[]) => mockSchedule(...args),
  validate: (expr: string) => mockValidate(expr),
}));

const mockDbRun = vi.fn();
const mockDbGet = vi.fn();
const mockDbAll = vi.fn(() => []);
const mockDbPrepare = vi.fn((_sql: string) => ({
  run: (...args: unknown[]) => mockDbRun(...args),
  get: (...args: unknown[]) => mockDbGet(...args),
  all: (...args: unknown[]) => mockDbAll(...args),
}));

vi.mock('../db/database.js', () => ({
  getDb: () => ({
    prepare: mockDbPrepare,
  }),
}));

// Mock provider for executeTask
const mockProviderQuery = vi.fn();
vi.mock('../providers/registry.js', () => ({
  getDefaultProvider: () => ({
    query: mockProviderQuery,
  }),
}));

vi.mock('../logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Must import after mocks
import {
  scheduleTask,
  unscheduleTask,
  startTaskScheduler,
  stopTaskScheduler,
  refreshTask,
  executeTask,
  type ScheduledTask,
} from './task-scheduler.js';

// ─── Helpers ────────────────────────────────────────────────────────────

function makeTask(overrides: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    id: 'task-1',
    name: 'Test Task',
    description: 'A test task',
    prompt: 'Do something useful',
    schedule: '*/5 * * * *',
    projectDir: '/tmp/test-project',
    enabled: 1,
    lastRunAt: null,
    nextRunAt: null,
    status: 'idle',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────

function resetMocks() {
  mockStop.mockReset();
  mockSchedule.mockReset().mockReturnValue({ stop: mockStop });
  mockValidate.mockReset().mockImplementation((expr: string) => {
    return expr.trim().split(/\s+/).length >= 5;
  });
  mockDbRun.mockReset();
  mockDbGet.mockReset();
  mockDbAll.mockReset().mockReturnValue([]);
  mockDbPrepare.mockReset().mockImplementation((_sql: string) => ({
    run: (...args: unknown[]) => mockDbRun(...args),
    get: (...args: unknown[]) => mockDbGet(...args),
    all: (...args: unknown[]) => mockDbAll(...args),
  }));
  mockProviderQuery.mockReset();
}

beforeEach(() => {
  resetMocks();
  // Reset module state: stop any active cron jobs from previous tests
  stopTaskScheduler();
  resetMocks(); // Reset again after stopTaskScheduler calls
});

describe('scheduleTask', () => {
  it('creates a cron job for a valid, enabled task', () => {
    const task = makeTask();

    scheduleTask(task);

    expect(mockSchedule).toHaveBeenCalledWith(task.schedule, expect.any(Function));
    expect(mockDbPrepare).toHaveBeenCalledWith(
      'UPDATE scheduled_tasks SET next_run_at = ? WHERE id = ?',
    );
  });

  it('does not schedule a disabled task', () => {
    const task = makeTask({ enabled: 0 });

    scheduleTask(task);

    expect(mockSchedule).not.toHaveBeenCalled();
  });

  it('does not schedule a task with an invalid cron expression', () => {
    mockValidate.mockReturnValueOnce(false);
    const task = makeTask({ schedule: 'bad' });

    scheduleTask(task);

    expect(mockSchedule).not.toHaveBeenCalled();
  });

  it('unschedules existing job before rescheduling', () => {
    const task = makeTask();

    // Schedule twice
    scheduleTask(task);
    const firstStop = mockStop;
    mockSchedule.mockReturnValueOnce({ stop: vi.fn() });
    scheduleTask(task);

    // The first job's stop should have been called
    expect(firstStop).toHaveBeenCalled();
  });
});

describe('unscheduleTask', () => {
  it('stops and removes an existing cron job', () => {
    const task = makeTask();
    scheduleTask(task);
    vi.clearAllMocks();

    unscheduleTask(task.id);

    expect(mockStop).toHaveBeenCalled();
  });

  it('does nothing if no job exists for the task', () => {
    unscheduleTask('nonexistent-id');

    expect(mockStop).not.toHaveBeenCalled();
  });
});

describe('startTaskScheduler', () => {
  it('loads all enabled tasks from the database and schedules them', () => {
    const tasks = [
      makeTask({ id: 'task-a', name: 'Task A' }),
      makeTask({ id: 'task-b', name: 'Task B' }),
    ];
    mockDbAll.mockReturnValueOnce(tasks);

    startTaskScheduler();

    // Should have queried for enabled tasks
    expect(mockDbPrepare).toHaveBeenCalledWith(
      'SELECT * FROM scheduled_tasks WHERE enabled = 1',
    );
    // Should schedule each task
    expect(mockSchedule).toHaveBeenCalledTimes(2);
  });

  it('handles no tasks gracefully', () => {
    mockDbAll.mockReturnValueOnce([]);

    startTaskScheduler();

    expect(mockSchedule).not.toHaveBeenCalled();
  });
});

describe('stopTaskScheduler', () => {
  it('stops all active cron jobs and clears the map', () => {
    const task1 = makeTask({ id: 'task-x' });
    const task2 = makeTask({ id: 'task-y' });

    const stop1 = vi.fn();
    const stop2 = vi.fn();
    mockSchedule.mockReturnValueOnce({ stop: stop1 });
    mockSchedule.mockReturnValueOnce({ stop: stop2 });

    scheduleTask(task1);
    scheduleTask(task2);

    stopTaskScheduler();

    expect(stop1).toHaveBeenCalled();
    expect(stop2).toHaveBeenCalled();
  });

  it('is safe to call when no jobs are active', () => {
    expect(() => stopTaskScheduler()).not.toThrow();
  });
});

describe('refreshTask', () => {
  it('reschedules a task that exists and is enabled', () => {
    const task = makeTask();
    mockDbGet.mockReturnValueOnce(task);

    refreshTask('task-1');

    expect(mockDbPrepare).toHaveBeenCalledWith(
      'SELECT * FROM scheduled_tasks WHERE id = ?',
    );
    expect(mockSchedule).toHaveBeenCalledWith(task.schedule, expect.any(Function));
  });

  it('unschedules a task that exists but is disabled', () => {
    const task = makeTask({ enabled: 0 });
    mockDbGet.mockReturnValueOnce(task);

    // First schedule the task so there is something to unschedule
    scheduleTask(makeTask());
    vi.clearAllMocks();

    mockDbGet.mockReturnValueOnce(task);
    refreshTask('task-1');

    // Should not reschedule (disabled)
    expect(mockSchedule).not.toHaveBeenCalled();
  });

  it('unschedules a task that no longer exists in the database', () => {
    mockDbGet.mockReturnValueOnce(undefined);

    // Pre-schedule so there is a job to remove
    scheduleTask(makeTask());
    vi.clearAllMocks();

    mockDbGet.mockReturnValueOnce(undefined);
    refreshTask('task-1');

    expect(mockSchedule).not.toHaveBeenCalled();
    expect(mockStop).toHaveBeenCalled();
  });
});

describe('executeTask', () => {
  it('runs a task and records a successful execution', async () => {
    const task = makeTask();
    mockDbGet.mockReturnValue(task);

    // Simulate provider returning text_delta messages
    async function* fakeQuery() {
      yield { type: 'text_delta', text: 'Hello ' };
      yield { type: 'text_delta', text: 'World' };
    }
    mockProviderQuery.mockReturnValueOnce(fakeQuery());

    const result = await executeTask('task-1');

    expect(result.taskId).toBe('task-1');
    expect(result.status).toBe('success');
    expect(result.output).toBe('Hello World');
    expect(result.error).toBeNull();
    expect(result.completedAt).toBeTruthy();
    expect(result.durationMs).toBeGreaterThanOrEqual(0);

    // Should insert execution record
    expect(mockDbPrepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO scheduled_task_executions'));
    // Should update execution record on completion
    expect(mockDbPrepare).toHaveBeenCalledWith(expect.stringContaining('UPDATE scheduled_task_executions'));
    // Should update task status
    expect(mockDbPrepare).toHaveBeenCalledWith(
      'UPDATE scheduled_tasks SET status = ?, next_run_at = ? WHERE id = ?',
    );

  });

  it('records failure when the provider yields an error message', async () => {
    const task = makeTask();
    mockDbGet.mockReturnValue(task);

    async function* fakeQuery() {
      yield { type: 'text_delta', text: 'partial ' };
      yield { type: 'error', error: 'Rate limit exceeded' };
    }
    mockProviderQuery.mockReturnValueOnce(fakeQuery());

    const result = await executeTask('task-1');

    expect(result.status).toBe('failure');
    expect(result.error).toBe('Rate limit exceeded');
    expect(result.output).toBe('partial ');

  });

  it('records failure when the provider throws an exception', async () => {
    const task = makeTask();
    mockDbGet.mockReturnValue(task);

    // Return an async iterable that throws during iteration
    mockProviderQuery.mockReturnValueOnce({
      [Symbol.asyncIterator]() {
        return {
          next() {
            return Promise.reject(new Error('Connection refused'));
          },
        };
      },
    });

    const result = await executeTask('task-1');

    expect(result.status).toBe('failure');
    expect(result.error).toBe('Connection refused');
    expect(result.output).toBe('');

  });

  it('throws when the task does not exist', async () => {
    mockDbGet.mockReturnValue(undefined);

    await expect(executeTask('nonexistent')).rejects.toThrow('Scheduled task not found: nonexistent');

  });

  it('records execution start and updates task status to running', async () => {
    const task = makeTask();
    mockDbGet.mockReturnValue(task);

    async function* fakeQuery() {
      yield { type: 'text_delta', text: 'done' };
    }
    mockProviderQuery.mockReturnValueOnce(fakeQuery());

    await executeTask('task-1');

    // Should update task status to 'running'
    expect(mockDbPrepare).toHaveBeenCalledWith(
      'UPDATE scheduled_tasks SET status = ?, last_run_at = ? WHERE id = ?',
    );

  });
});

describe('invalid cron expressions', () => {
  it('scheduleTask gracefully skips an invalid schedule', () => {
    mockValidate.mockReturnValueOnce(false);
    const task = makeTask({ schedule: 'not-a-cron' });

    // Should not throw
    expect(() => scheduleTask(task)).not.toThrow();
    expect(mockSchedule).not.toHaveBeenCalled();
  });
});
