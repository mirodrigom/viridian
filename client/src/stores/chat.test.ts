import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { useChatStore, type ChatMessage, type ToolUseInfo } from './chat'
import { setupTestPinia, createMockMessage, createMockStreamingMessage, createMockToolMessage, createMockUsage, clearSessionStorage, nextTick, wait } from '@/test/utils'

describe('useChatStore', () => {
  beforeEach(() => {
    setupTestPinia()
    clearSessionStorage()
    vi.clearAllTimers()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.restoreAllTimers()
  })

  describe('initialization', () => {
    it('should initialize with empty state', () => {
      const store = useChatStore()

      expect(store.messages).toHaveLength(0)
      expect(store.isStreaming).toBe(false)
      expect(store.sessionId).toBeNull()
      expect(store.claudeSessionId).toBeNull()
      expect(store.projectPath).toBeNull()
      expect(store.activeProjectDir).toBeNull()
      expect(store.usage).toEqual({ inputTokens: 0, outputTokens: 0, totalCost: 0 })
      expect(store.inPlanMode).toBe(false)
      expect(store.autoScroll).toBe(true)
    })

    it('should restore state from sessionStorage', () => {
      window.sessionStorage.setItem('chat-sessionId', 'test-session')
      window.sessionStorage.setItem('chat-claudeSessionId', 'test-claude-session')
      window.sessionStorage.setItem('chat-projectPath', '/test/path')
      window.sessionStorage.setItem('chat-activeProjectDir', '/test/active')

      const store = useChatStore()

      expect(store.sessionId).toBe('test-session')
      expect(store.claudeSessionId).toBe('test-claude-session')
      expect(store.projectPath).toBe('/test/path')
      expect(store.activeProjectDir).toBe('/test/active')
    })
  })

  describe('message management', () => {
    it('should add messages correctly', () => {
      const store = useChatStore()
      const message = createMockMessage({ content: 'Hello world' })

      store.addMessage(message)

      expect(store.messages).toHaveLength(1)
      expect(store.messages[0]).toEqual(message)
      expect(store.lastMessage).toEqual(message)
    })

    it('should update last assistant content during streaming', () => {
      const store = useChatStore()
      const assistantMessage = createMockStreamingMessage()

      store.addMessage(assistantMessage)
      store.updateLastAssistantContent(' world!')

      expect(store.messages[0]?.content).toBe(' world!')
      expect(store.contentVersion).toBe(1)
    })

    it('should not update content if no assistant message exists', () => {
      const store = useChatStore()
      const userMessage = createMockMessage({ role: 'user' })

      store.addMessage(userMessage)
      store.updateLastAssistantContent('Should not append')

      expect(store.messages[0]?.content).toBe('Test message content')
      expect(store.contentVersion).toBe(0)
    })

    it('should clear all messages and state', () => {
      const store = useChatStore()
      const message = createMockMessage()

      store.addMessage(message)
      store.sessionId = 'test-session'
      store.claudeSessionId = 'test-claude'
      store.activeProjectDir = '/test'
      store.usage = createMockUsage()
      store.inPlanMode = true

      store.clearMessages()

      expect(store.messages).toHaveLength(0)
      expect(store.sessionId).toBeNull()
      expect(store.claudeSessionId).toBeNull()
      expect(store.activeProjectDir).toBeNull()
      expect(store.usage).toEqual({ inputTokens: 0, outputTokens: 0, totalCost: 0 })
      expect(store.inPlanMode).toBe(false)
    })
  })

  describe('streaming state', () => {
    it('should start streaming correctly', () => {
      const store = useChatStore()
      const startTime = Date.now()
      vi.setSystemTime(startTime)

      store.startStreaming()

      expect(store.isStreaming).toBe(true)
      expect(store.streamStartTime).toBe(startTime)
      expect(store.sessionStartedAt).toBe(startTime)
    })

    it('should not update sessionStartedAt if already set', () => {
      const store = useChatStore()
      const initialTime = Date.now()
      const laterTime = initialTime + 5000

      vi.setSystemTime(initialTime)
      store.startStreaming()

      vi.setSystemTime(laterTime)
      store.startStreaming()

      expect(store.sessionStartedAt).toBe(initialTime)
    })

    it('should finish streaming and calculate response time', () => {
      const store = useChatStore()
      const startTime = Date.now()
      const endTime = startTime + 1500

      vi.setSystemTime(startTime)
      store.startStreaming()

      // Add streaming assistant messages
      store.addMessage(createMockStreamingMessage({ id: 'msg1' }))
      store.addMessage(createMockStreamingMessage({ id: 'msg2' }))

      vi.setSystemTime(endTime)
      store.finishStreaming()

      expect(store.isStreaming).toBe(false)
      expect(store.lastResponseMs).toBe(1500)
      expect(store.streamStartTime).toBeNull()

      // All assistant messages should have isStreaming = false
      store.messages.forEach(msg => {
        if (msg.role === 'assistant') {
          expect(msg.isStreaming).toBe(false)
        }
      })
    })
  })

  describe('usage tracking', () => {
    it('should update usage statistics', () => {
      const store = useChatStore()

      store.updateUsage({ inputTokens: 150 })
      expect(store.usage.inputTokens).toBe(150)
      expect(store.usage.outputTokens).toBe(0)

      store.updateUsage({ outputTokens: 75, totalCost: 0.05 })
      expect(store.usage.inputTokens).toBe(150)
      expect(store.usage.outputTokens).toBe(75)
      expect(store.usage.totalCost).toBe(0.05)
    })

    it('should calculate total tokens correctly', () => {
      const store = useChatStore()
      store.updateUsage({ inputTokens: 100, outputTokens: 50 })

      expect(store.totalTokens).toBe(150)
    })

    it('should calculate context percentage correctly', () => {
      const store = useChatStore()
      store.updateUsage({ inputTokens: 20000 })

      expect(store.contextPercent).toBe(10) // 20000 / 200000 * 100 = 10%
    })

    it('should cap context percentage at 100%', () => {
      const store = useChatStore()
      store.updateUsage({ inputTokens: 300000 })

      expect(store.contextPercent).toBe(100)
    })

    it('should calculate session metrics correctly', () => {
      const store = useChatStore()
      const startTime = Date.now()

      vi.setSystemTime(startTime)
      store.startStreaming()
      store.updateUsage({ inputTokens: 1200, outputTokens: 800 })

      // Simulate 2 minutes passing
      vi.setSystemTime(startTime + 120000)

      expect(store.sessionDurationMin).toBe(2)
      expect(store.tokensPerMin).toBe(1000) // 2000 tokens / 2 minutes
    })
  })

  describe('rate limiting', () => {
    it('should set rate limit with auto-clear timer', async () => {
      const store = useChatStore()
      const limitUntil = Date.now() + 5000

      store.setRateLimitedUntil(limitUntil)

      expect(store.isRateLimited).toBe(true)
      expect(store.rateLimitedUntil).toBe(limitUntil)
      expect(store.rateLimitRemainingMs).toBe(5000)

      // Fast-forward time to after the limit
      vi.advanceTimersByTime(5000)
      await nextTick()

      expect(store.isRateLimited).toBe(false)
      expect(store.rateLimitedUntil).toBeNull()
    })

    it('should clear rate limit manually', () => {
      const store = useChatStore()
      store.setRateLimitedUntil(Date.now() + 10000)

      expect(store.isRateLimited).toBe(true)

      store.clearRateLimit()

      expect(store.isRateLimited).toBe(false)
      expect(store.rateLimitedUntil).toBeNull()
    })

    it('should handle past rate limit time gracefully', () => {
      const store = useChatStore()
      const pastTime = Date.now() - 1000

      store.setRateLimitedUntil(pastTime)

      expect(store.isRateLimited).toBe(false)
      expect(store.rateLimitRemainingMs).toBe(0)
    })
  })

  describe('thinking mode', () => {
    it('should start thinking on last assistant message', () => {
      const store = useChatStore()
      const assistantMessage = createMockMessage({ role: 'assistant' })

      store.addMessage(assistantMessage)
      store.startThinking()

      expect(store.messages[0]?.isThinking).toBe(true)
      expect(store.messages[0]?.thinking).toBe('')
    })

    it('should update thinking content', () => {
      const store = useChatStore()
      const assistantMessage = createMockMessage({ role: 'assistant' })

      store.addMessage(assistantMessage)
      store.startThinking()
      store.updateThinking('I think therefore I am...')

      expect(store.messages[0]?.thinking).toBe('I think therefore I am...')
    })

    it('should append to thinking content', () => {
      const store = useChatStore()
      const assistantMessage = createMockMessage({ role: 'assistant' })

      store.addMessage(assistantMessage)
      store.startThinking()
      store.updateThinking('Hello')
      store.updateThinking(' world')

      expect(store.messages[0]?.thinking).toBe('Hello world')
    })

    it('should finish thinking', () => {
      const store = useChatStore()
      const assistantMessage = createMockMessage({ role: 'assistant' })

      store.addMessage(assistantMessage)
      store.startThinking()
      store.finishThinking()

      expect(store.messages[0]?.isThinking).toBe(false)
    })
  })

  describe('tool use', () => {
    it('should append tool input delta during streaming', () => {
      const store = useChatStore()
      const toolMessage = createMockToolMessage('TestTool', {})
      const requestId = toolMessage.toolUse!.requestId

      store.addMessage(toolMessage)
      store.appendToolInputDelta(requestId, '{"param": "partial')

      expect(store.messages[0]?.toolUse?.isInputStreaming).toBe(true)
      // Should not parse invalid JSON yet
      expect(store.messages[0]?.toolUse?.input).toEqual({})
    })

    it('should parse complete tool input delta', () => {
      const store = useChatStore()
      const toolMessage = createMockToolMessage('TestTool', {})
      const requestId = toolMessage.toolUse!.requestId

      store.addMessage(toolMessage)
      store.appendToolInputDelta(requestId, '{"param": "value", "num": 42}')

      expect(store.messages[0]?.toolUse?.input).toEqual({ param: 'value', num: 42 })
    })

    it('should update tool input when complete', () => {
      const store = useChatStore()
      const toolMessage = createMockToolMessage('TestTool', {})
      const requestId = toolMessage.toolUse!.requestId
      const newInput = { command: 'echo hello', description: 'Test command' }

      store.addMessage(toolMessage)
      store.updateToolInput(requestId, newInput)

      expect(store.messages[0]?.toolUse?.input).toEqual(newInput)
      expect(store.messages[0]?.toolUse?.isInputStreaming).toBe(false)
    })

    it('should ignore tool updates for non-existent requests', () => {
      const store = useChatStore()

      store.updateToolInput('non-existent-id', { test: 'data' })
      store.appendToolInputDelta('non-existent-id', '{"test": "data"}')

      // Should not throw or cause issues
      expect(store.messages).toHaveLength(0)
    })
  })

  describe('todo extraction', () => {
    it('should extract todos from latest TodoWrite tool', () => {
      const store = useChatStore()
      const todos = [
        { content: 'Task 1', status: 'completed' as const, activeForm: 'Completing Task 1' },
        { content: 'Task 2', status: 'in_progress' as const, activeForm: 'Working on Task 2' },
        { content: 'Task 3', status: 'pending' as const, activeForm: 'Planning Task 3' },
      ]

      const todoMessage = createMockToolMessage('TodoWrite', { todos })
      store.addMessage(todoMessage)

      expect(store.latestTodos).toEqual(todos)
    })

    it('should return latest todos when multiple TodoWrite tools exist', () => {
      const store = useChatStore()

      const oldTodos = [{ content: 'Old task', status: 'completed' as const }]
      const newTodos = [{ content: 'New task', status: 'pending' as const }]

      store.addMessage(createMockToolMessage('TodoWrite', { todos: oldTodos }))
      store.addMessage(createMockToolMessage('TodoWrite', { todos: newTodos }))

      expect(store.latestTodos).toEqual(newTodos)
    })

    it('should return empty array when no TodoWrite tools exist', () => {
      const store = useChatStore()

      store.addMessage(createMockToolMessage('SomeOtherTool', {}))

      expect(store.latestTodos).toEqual([])
    })

    it('should handle invalid todos input gracefully', () => {
      const store = useChatStore()

      const invalidMessage = createMockToolMessage('TodoWrite', { todos: 'not an array' })
      store.addMessage(invalidMessage)

      expect(store.latestTodos).toEqual([])
    })
  })

  describe('pagination state', () => {
    it('should track pagination state correctly', () => {
      const store = useChatStore()

      expect(store.totalMessages).toBe(0)
      expect(store.hasMoreMessages).toBe(false)
      expect(store.oldestLoadedIndex).toBe(0)
      expect(store.isLoadingMore).toBe(false)
    })

    it('should load messages with metadata', () => {
      const store = useChatStore()
      const messages = [createMockMessage(), createMockMessage()]
      const meta = { total: 10, hasMore: true, oldestIndex: 5 }

      store.loadMessages(messages, meta)

      expect(store.messages).toEqual(messages)
      expect(store.totalMessages).toBe(10)
      expect(store.hasMoreMessages).toBe(true)
      expect(store.oldestLoadedIndex).toBe(5)
      expect(store.scrollToBottomRequest).toBe(1)
    })

    it('should prepend messages for pagination', () => {
      const store = useChatStore()
      const existingMessages = [createMockMessage({ content: 'existing' })]
      const newMessages = [createMockMessage({ content: 'new' })]

      store.messages = existingMessages
      store.prependMessages(newMessages, { hasMore: false, oldestIndex: 0 })

      expect(store.messages).toHaveLength(2)
      expect(store.messages[0]?.content).toBe('new')
      expect(store.messages[1]?.content).toBe('existing')
      expect(store.hasMoreMessages).toBe(false)
      expect(store.oldestLoadedIndex).toBe(0)
    })

    it('should append messages', () => {
      const store = useChatStore()
      const existingMessages = [createMockMessage({ content: 'existing' })]
      const newMessages = [createMockMessage({ content: 'new' })]

      store.messages = existingMessages
      store.appendMessages(newMessages, { total: 15 })

      expect(store.messages).toHaveLength(2)
      expect(store.messages[0]?.content).toBe('existing')
      expect(store.messages[1]?.content).toBe('new')
      expect(store.totalMessages).toBe(15)
    })
  })

  describe('session persistence', () => {
    it('should persist sessionId to sessionStorage', async () => {
      const store = useChatStore()

      store.sessionId = 'test-session-123'
      await nextTick()

      expect(window.sessionStorage.getItem('chat-sessionId')).toBe('test-session-123')
    })

    it('should persist claudeSessionId to sessionStorage', async () => {
      const store = useChatStore()

      store.claudeSessionId = 'claude-session-456'
      await nextTick()

      expect(window.sessionStorage.getItem('chat-claudeSessionId')).toBe('claude-session-456')
    })

    it('should persist projectPath to sessionStorage', async () => {
      const store = useChatStore()

      store.setProjectPath('/path/to/project')
      await nextTick()

      expect(window.sessionStorage.getItem('chat-projectPath')).toBe('/path/to/project')
    })

    it('should persist activeProjectDir to sessionStorage', async () => {
      const store = useChatStore()

      store.activeProjectDir = '/active/project'
      await nextTick()

      expect(window.sessionStorage.getItem('chat-activeProjectDir')).toBe('/active/project')
    })

    it('should remove from sessionStorage when set to null', async () => {
      const store = useChatStore()

      // Set initial values
      store.sessionId = 'test'
      await nextTick()
      expect(window.sessionStorage.getItem('chat-sessionId')).toBe('test')

      // Clear values
      store.sessionId = null
      await nextTick()
      expect(window.sessionStorage.getItem('chat-sessionId')).toBeNull()
    })
  })
})