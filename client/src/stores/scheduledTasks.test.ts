import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { setupTestPinia } from '@/test/utils'
import { useScheduledTasksStore, SCHEDULE_PRESETS, type ScheduledTask, type TaskExecution } from './scheduledTasks'

// Mock apiFetch
vi.mock('@/lib/apiFetch', () => ({
  apiFetch: vi.fn(),
}))

import { apiFetch } from '@/lib/apiFetch'

const mockApiFetch = apiFetch as ReturnType<typeof vi.fn>

function createMockTask(overrides: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    id: `task-${Date.now()}-${Math.random()}`,
    name: 'Test Task',
    description: 'A test task',
    prompt: 'Run tests',
    schedule: '0 * * * *',
    projectDir: '/test/project',
    enabled: true,
    lastRunAt: null,
    nextRunAt: '2026-03-12T00:00:00Z',
    status: 'idle',
    createdAt: '2026-03-11T00:00:00Z',
    ...overrides,
  }
}

function createMockExecution(overrides: Partial<TaskExecution> = {}): TaskExecution {
  return {
    id: `exec-${Date.now()}`,
    taskId: 'task-1',
    status: 'completed',
    output: 'Task completed successfully',
    error: null,
    startedAt: '2026-03-11T10:00:00Z',
    completedAt: '2026-03-11T10:01:00Z',
    durationMs: 60000,
    ...overrides,
  }
}

describe('useScheduledTasksStore', () => {
  beforeEach(() => {
    setupTestPinia()
    vi.clearAllMocks()
  })

  describe('initial state', () => {
    it('should have empty tasks and correct defaults', () => {
      const store = useScheduledTasksStore()

      expect(store.tasks).toHaveLength(0)
      expect(store.loading).toBe(false)
      expect(store.executionLoading).toBe(false)
      expect(store.taskCount).toBe(0)
      expect(store.enabledCount).toBe(0)
      expect(store.runningCount).toBe(0)
    })
  })

  describe('fetchTasks()', () => {
    it('should populate tasks from API', async () => {
      const tasks = [createMockTask({ id: 'task-1' }), createMockTask({ id: 'task-2' })]
      mockApiFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ tasks }),
      })

      const store = useScheduledTasksStore()
      await store.fetchTasks()

      expect(store.tasks).toHaveLength(2)
      expect(store.tasks[0].id).toBe('task-1')
      expect(store.tasks[1].id).toBe('task-2')
      expect(store.loading).toBe(false)
    })

    it('should set loading state during fetch', async () => {
      let resolvePromise: (value: unknown) => void
      mockApiFetch.mockReturnValueOnce(
        new Promise(resolve => { resolvePromise = resolve }),
      )

      const store = useScheduledTasksStore()
      const fetchPromise = store.fetchTasks()

      expect(store.loading).toBe(true)

      resolvePromise!({
        ok: true,
        json: () => Promise.resolve({ tasks: [] }),
      })
      await fetchPromise

      expect(store.loading).toBe(false)
    })

    it('should throw and reset loading on API failure', async () => {
      mockApiFetch.mockResolvedValueOnce({
        ok: false,
      })

      const store = useScheduledTasksStore()
      await expect(store.fetchTasks()).rejects.toThrow('Failed to fetch scheduled tasks')
      expect(store.loading).toBe(false)
    })
  })

  describe('createTask()', () => {
    it('should add a new task and call API', async () => {
      const newTask = createMockTask({ id: 'new-task-1', name: 'New Task' })
      mockApiFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(newTask),
      })

      const store = useScheduledTasksStore()
      const result = await store.createTask({
        name: 'New Task',
        prompt: 'Do something',
        schedule: '0 * * * *',
        projectDir: '/test',
      })

      expect(result.id).toBe('new-task-1')
      expect(store.tasks).toHaveLength(1)
      expect(store.tasks[0].name).toBe('New Task')
      expect(mockApiFetch).toHaveBeenCalledWith('/api/scheduled-tasks', expect.objectContaining({
        method: 'POST',
      }))
    })

    it('should prepend the new task to the list', async () => {
      const store = useScheduledTasksStore()
      store.tasks = [createMockTask({ id: 'existing' })]

      const newTask = createMockTask({ id: 'new-task' })
      mockApiFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(newTask),
      })

      await store.createTask({
        name: 'New',
        prompt: 'test',
        schedule: '0 * * * *',
        projectDir: '/test',
      })

      expect(store.tasks[0].id).toBe('new-task')
      expect(store.tasks[1].id).toBe('existing')
    })

    it('should throw on API failure', async () => {
      mockApiFetch.mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ error: 'Invalid schedule' }),
      })

      const store = useScheduledTasksStore()
      await expect(
        store.createTask({ name: 'Bad', prompt: 'x', schedule: 'invalid', projectDir: '/' }),
      ).rejects.toThrow('Invalid schedule')
    })
  })

  describe('updateTask()', () => {
    it('should modify an existing task', async () => {
      const store = useScheduledTasksStore()
      store.tasks = [createMockTask({ id: 'task-1', name: 'Original' })]

      const updated = createMockTask({ id: 'task-1', name: 'Updated' })
      mockApiFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(updated),
      })

      const result = await store.updateTask('task-1', { name: 'Updated' })

      expect(result.name).toBe('Updated')
      expect(store.tasks[0].name).toBe('Updated')
      expect(mockApiFetch).toHaveBeenCalledWith('/api/scheduled-tasks/task-1', expect.objectContaining({
        method: 'PATCH',
      }))
    })

    it('should throw on API failure', async () => {
      mockApiFetch.mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ error: 'Not found' }),
      })

      const store = useScheduledTasksStore()
      await expect(store.updateTask('bad-id', { name: 'x' })).rejects.toThrow('Not found')
    })
  })

  describe('deleteTask()', () => {
    it('should remove the task from the list', async () => {
      const store = useScheduledTasksStore()
      store.tasks = [
        createMockTask({ id: 'task-1' }),
        createMockTask({ id: 'task-2' }),
      ]

      mockApiFetch.mockResolvedValueOnce({ ok: true })

      await store.deleteTask('task-1')

      expect(store.tasks).toHaveLength(1)
      expect(store.tasks[0].id).toBe('task-2')
      expect(mockApiFetch).toHaveBeenCalledWith('/api/scheduled-tasks/task-1', expect.objectContaining({
        method: 'DELETE',
      }))
    })

    it('should also clear execution history for the deleted task', async () => {
      const store = useScheduledTasksStore()
      store.tasks = [createMockTask({ id: 'task-1' })]
      store.executionHistory.set('task-1', [createMockExecution()])

      mockApiFetch.mockResolvedValueOnce({ ok: true })

      await store.deleteTask('task-1')

      expect(store.getHistory('task-1')).toHaveLength(0)
    })

    it('should throw on API failure', async () => {
      mockApiFetch.mockResolvedValueOnce({ ok: false })

      const store = useScheduledTasksStore()
      await expect(store.deleteTask('bad-id')).rejects.toThrow('Failed to delete scheduled task')
    })
  })

  describe('toggleTask()', () => {
    it('should enable a disabled task', async () => {
      const store = useScheduledTasksStore()
      store.tasks = [createMockTask({ id: 'task-1', enabled: false })]

      const updated = createMockTask({ id: 'task-1', enabled: true })
      mockApiFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(updated),
      })

      await store.toggleTask('task-1', true)

      expect(store.tasks[0].enabled).toBe(true)
    })

    it('should disable an enabled task', async () => {
      const store = useScheduledTasksStore()
      store.tasks = [createMockTask({ id: 'task-1', enabled: true })]

      const updated = createMockTask({ id: 'task-1', enabled: false })
      mockApiFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(updated),
      })

      await store.toggleTask('task-1', false)

      expect(store.tasks[0].enabled).toBe(false)
    })
  })

  describe('runTaskNow()', () => {
    it('should trigger manual execution and set status to running', async () => {
      const store = useScheduledTasksStore()
      store.tasks = [createMockTask({ id: 'task-1', status: 'idle' })]

      mockApiFetch.mockResolvedValueOnce({ ok: true })

      await store.runTaskNow('task-1')

      expect(store.tasks[0].status).toBe('running')
      expect(mockApiFetch).toHaveBeenCalledWith('/api/scheduled-tasks/task-1/run', expect.objectContaining({
        method: 'POST',
      }))
    })

    it('should throw on API failure', async () => {
      mockApiFetch.mockResolvedValueOnce({ ok: false })

      const store = useScheduledTasksStore()
      store.tasks = [createMockTask({ id: 'task-1' })]

      await expect(store.runTaskNow('task-1')).rejects.toThrow('Failed to trigger task')
    })
  })

  describe('fetchHistory()', () => {
    it('should load execution history for a task', async () => {
      const executions = [
        createMockExecution({ id: 'exec-1', taskId: 'task-1' }),
        createMockExecution({ id: 'exec-2', taskId: 'task-1' }),
      ]
      mockApiFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ executions }),
      })

      const store = useScheduledTasksStore()
      const result = await store.fetchHistory('task-1')

      expect(result).toHaveLength(2)
      expect(store.getHistory('task-1')).toHaveLength(2)
      expect(store.executionLoading).toBe(false)
    })

    it('should pass limit parameter to API', async () => {
      mockApiFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ executions: [] }),
      })

      const store = useScheduledTasksStore()
      await store.fetchHistory('task-1', 50)

      expect(mockApiFetch).toHaveBeenCalledWith('/api/scheduled-tasks/task-1/history?limit=50')
    })

    it('should throw on API failure', async () => {
      mockApiFetch.mockResolvedValueOnce({ ok: false })

      const store = useScheduledTasksStore()
      await expect(store.fetchHistory('task-1')).rejects.toThrow('Failed to fetch execution history')
      expect(store.executionLoading).toBe(false)
    })
  })

  describe('computed properties', () => {
    it('should count enabled tasks', () => {
      const store = useScheduledTasksStore()
      store.tasks = [
        createMockTask({ id: '1', enabled: true }),
        createMockTask({ id: '2', enabled: false }),
        createMockTask({ id: '3', enabled: true }),
      ]

      expect(store.enabledCount).toBe(2)
    })

    it('should count running tasks', () => {
      const store = useScheduledTasksStore()
      store.tasks = [
        createMockTask({ id: '1', status: 'running' }),
        createMockTask({ id: '2', status: 'idle' }),
        createMockTask({ id: '3', status: 'running' }),
      ]

      expect(store.runningCount).toBe(2)
    })

    it('should count total tasks', () => {
      const store = useScheduledTasksStore()
      store.tasks = [createMockTask(), createMockTask(), createMockTask()]

      expect(store.taskCount).toBe(3)
    })
  })

  describe('schedule presets', () => {
    it('should have the correct number of presets', () => {
      expect(SCHEDULE_PRESETS).toHaveLength(10)
    })

    it.each([
      ['Every 15 minutes', '*/15 * * * *'],
      ['Every 30 minutes', '*/30 * * * *'],
      ['Every hour', '0 * * * *'],
      ['Every 6 hours', '0 */6 * * *'],
      ['Daily at midnight', '0 0 * * *'],
      ['Daily at 9 AM', '0 9 * * *'],
      ['Daily at 6 PM', '0 18 * * *'],
      ['Weekly on Monday', '0 9 * * 1'],
      ['Weekly on Friday', '0 9 * * 5'],
      ['Monthly (1st)', '0 0 1 * *'],
    ] as const)('preset "%s" should have cron "%s"', (label, value) => {
      const preset = SCHEDULE_PRESETS.find(p => p.label === label)
      expect(preset).toBeDefined()
      expect(preset!.value).toBe(value)
    })
  })

  describe('getHistory()', () => {
    it('should return empty array for unknown task', () => {
      const store = useScheduledTasksStore()
      expect(store.getHistory('unknown-id')).toEqual([])
    })
  })
})
