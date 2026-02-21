import { describe, it, expect, beforeEach } from 'vitest'
import { setupTestPinia } from '@/test/utils'
import { useChatStore } from './chat'

describe('useChatStore — plan review', () => {
  let store: ReturnType<typeof useChatStore>

  beforeEach(() => {
    setupTestPinia()
    store = useChatStore()
  })

  describe('activatePlanReview', () => {
    it('sets plan text and activates review', () => {
      store.activatePlanReview('# My Plan\n\n1. Step one\n2. Step two')

      expect(store.planReviewText).toBe('# My Plan\n\n1. Step one\n2. Step two')
      expect(store.isPlanReviewActive).toBe(true)
    })

    it('stores requestId when provided', () => {
      store.activatePlanReview('plan text', 'req-exit-plan')

      expect(store.planReviewRequestId).toBe('req-exit-plan')
      expect(store.isPlanReviewActive).toBe(true)
    })

    it('sets requestId to null when not provided', () => {
      store.activatePlanReview('plan text')

      expect(store.planReviewRequestId).toBeNull()
    })
  })

  describe('dismissPlanReview', () => {
    it('clears plan text, requestId, and deactivates review', () => {
      store.activatePlanReview('some plan', 'req-123')
      store.dismissPlanReview()

      expect(store.planReviewText).toBeNull()
      expect(store.isPlanReviewActive).toBe(false)
      expect(store.planReviewRequestId).toBeNull()
    })
  })

  describe('clearMessages resets plan state', () => {
    it('clears plan review on clearMessages', () => {
      store.activatePlanReview('plan text', 'req-123')
      store.inPlanMode = true

      store.clearMessages()

      expect(store.planReviewText).toBeNull()
      expect(store.isPlanReviewActive).toBe(false)
      expect(store.planReviewRequestId).toBeNull()
      expect(store.inPlanMode).toBe(false)
    })
  })
})

describe('useChatStore — rate limiting', () => {
  let store: ReturnType<typeof useChatStore>

  beforeEach(() => {
    setupTestPinia()
    store = useChatStore()
  })

  describe('setRateLimitedUntil', () => {
    it('sets rate limit timestamp', () => {
      const future = Date.now() + 60_000
      store.setRateLimitedUntil(future)

      expect(store.rateLimitedUntil).toBe(future)
      expect(store.isRateLimited).toBe(true)
    })

    it('isRateLimited is false when timestamp is in the past', () => {
      store.setRateLimitedUntil(Date.now() - 1000)
      expect(store.isRateLimited).toBe(false)
    })
  })

  describe('clearRateLimit', () => {
    it('clears rate limit', () => {
      store.setRateLimitedUntil(Date.now() + 60_000)
      store.clearRateLimit()

      expect(store.rateLimitedUntil).toBeNull()
      expect(store.isRateLimited).toBe(false)
    })
  })

  describe('rateLimitRemainingMs', () => {
    it('returns positive value when rate limited', () => {
      store.setRateLimitedUntil(Date.now() + 60_000)
      expect(store.rateLimitRemainingMs).toBeGreaterThan(0)
    })

    it('returns 0 when not rate limited', () => {
      expect(store.rateLimitRemainingMs).toBe(0)
    })
  })
})

describe('useChatStore — streaming lifecycle', () => {
  let store: ReturnType<typeof useChatStore>

  beforeEach(() => {
    setupTestPinia()
    store = useChatStore()
  })

  describe('startStreaming', () => {
    it('sets isStreaming to true', () => {
      store.startStreaming()
      expect(store.isStreaming).toBe(true)
    })

    it('sets sessionStartedAt on first stream', () => {
      expect(store.sessionStartedAt).toBeNull()
      store.startStreaming()
      expect(store.sessionStartedAt).toBeGreaterThan(0)
    })
  })

  describe('finishStreaming', () => {
    it('sets isStreaming to false', () => {
      store.startStreaming()
      store.finishStreaming()
      expect(store.isStreaming).toBe(false)
    })

    it('clears isStreaming flag on all assistant messages', () => {
      store.addMessage({ id: '1', role: 'assistant', content: 'text', timestamp: Date.now(), isStreaming: true })
      store.addMessage({ id: '2', role: 'assistant', content: 'more', timestamp: Date.now(), isStreaming: true })
      store.finishStreaming()

      expect(store.messages.every(m => !m.isStreaming)).toBe(true)
    })

    it('removes trailing empty assistant messages', () => {
      store.addMessage({ id: '1', role: 'user', content: 'hi', timestamp: Date.now() })
      store.addMessage({ id: '2', role: 'assistant', content: 'response', timestamp: Date.now() })
      store.addMessage({ id: '3', role: 'assistant', content: '', timestamp: Date.now() })
      store.addMessage({ id: '4', role: 'assistant', content: '  ', timestamp: Date.now() })

      store.finishStreaming()

      expect(store.messages).toHaveLength(2)
    })
  })

  describe('thinking mode', () => {
    it('startThinking sets thinking state on last assistant msg', () => {
      store.addMessage({ id: '1', role: 'assistant', content: '', timestamp: Date.now() })
      store.startThinking()

      const msg = store.messages[0]
      expect(msg.isThinking).toBe(true)
      expect(msg.thinking).toBe('')
    })

    it('updateThinking appends thinking text', () => {
      store.addMessage({ id: '1', role: 'assistant', content: '', timestamp: Date.now() })
      store.startThinking()
      store.updateThinking('Let me think...')
      store.updateThinking(' about this.')

      expect(store.messages[0].thinking).toBe('Let me think... about this.')
    })

    it('finishThinking clears isThinking flag', () => {
      store.addMessage({ id: '1', role: 'assistant', content: '', timestamp: Date.now() })
      store.startThinking()
      store.finishThinking()

      expect(store.messages[0].isThinking).toBe(false)
    })
  })

  describe('tool input streaming', () => {
    it('appendToolInputDelta parses accumulated JSON', () => {
      store.addMessage({
        id: '1', role: 'system', content: 'Tool', timestamp: Date.now(),
        toolUse: { tool: 'Write', input: {}, requestId: 'r1', status: 'pending' },
      })

      store.appendToolInputDelta('r1', '{"file_path": "/test.ts"}')

      expect(store.messages[0].toolUse!.input).toEqual({ file_path: '/test.ts' })
      expect(store.messages[0].toolUse!.isInputStreaming).toBe(true)
    })

    it('appendToolInputDelta handles partial JSON gracefully', () => {
      store.addMessage({
        id: '1', role: 'system', content: 'Tool', timestamp: Date.now(),
        toolUse: { tool: 'Write', input: {}, requestId: 'r1', status: 'pending' },
      })

      store.appendToolInputDelta('r1', '{"file_path": "/tes')
      expect(store.messages[0].toolUse!.isInputStreaming).toBe(true)
    })

    it('updateToolInput finalizes input and clears streaming flag', () => {
      store.addMessage({
        id: '1', role: 'system', content: 'Tool', timestamp: Date.now(),
        toolUse: { tool: 'Write', input: {}, requestId: 'r1', status: 'pending', isInputStreaming: true },
      })

      store.updateToolInput('r1', { file_path: '/test.ts', content: 'hello' })

      expect(store.messages[0].toolUse!.input).toEqual({ file_path: '/test.ts', content: 'hello' })
      expect(store.messages[0].toolUse!.isInputStreaming).toBe(false)
    })
  })
})

describe('useChatStore — computed properties', () => {
  let store: ReturnType<typeof useChatStore>

  beforeEach(() => {
    setupTestPinia()
    store = useChatStore()
  })

  it('totalTokens sums input and output', () => {
    store.updateUsage({ inputTokens: 100, outputTokens: 50 })
    expect(store.totalTokens).toBe(150)
  })

  it('contextPercent calculates usage percentage', () => {
    store.updateUsage({ inputTokens: 100000 })
    expect(store.contextPercent).toBe(50)
  })

  it('contextPercent caps at 100', () => {
    store.updateUsage({ inputTokens: 300000 })
    expect(store.contextPercent).toBe(100)
  })

  it('lastMessage returns last message', () => {
    store.addMessage({ id: '1', role: 'user', content: 'first', timestamp: 1 })
    store.addMessage({ id: '2', role: 'assistant', content: 'second', timestamp: 2 })
    expect(store.lastMessage?.content).toBe('second')
  })

  it('latestTodos extracts todos from last TodoWrite', () => {
    store.addMessage({
      id: '1', role: 'system', content: 'Tool', timestamp: Date.now(),
      toolUse: {
        tool: 'TodoWrite', requestId: 'td-1', status: 'approved',
        input: {
          todos: [
            { content: 'Task 1', status: 'completed', activeForm: 'Doing task 1' },
            { content: 'Task 2', status: 'in_progress', activeForm: 'Doing task 2' },
          ],
        },
      },
    })

    expect(store.latestTodos).toHaveLength(2)
    expect(store.latestTodos[0].content).toBe('Task 1')
  })
})
