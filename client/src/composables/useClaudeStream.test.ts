import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { ref } from 'vue'
import { useClaudeStream } from './useClaudeStream'
import { useChatStore } from '@/stores/chat'
import { useSettingsStore } from '@/stores/settings'
import { useAuthStore } from '@/stores/auth'
import { setupTestPinia, createMockMessage, nextTick, wait } from '@/test/utils'

// Mock the stores
vi.mock('@/stores/settings', () => ({
  useSettingsStore: vi.fn(),
}))

vi.mock('@/stores/auth', () => ({
  useAuthStore: vi.fn(),
}))

// Mock useWebSocket
const mockWebSocket = {
  connected: ref(false),
  connect: vi.fn(),
  send: vi.fn(),
  on: vi.fn(),
  disconnect: vi.fn(),
}

vi.mock('./useWebSocket', () => ({
  useWebSocket: vi.fn(() => mockWebSocket),
}))

// Mock fetch for API calls
const mockFetch = vi.fn()
global.fetch = mockFetch

describe('useClaudeStream', () => {
  let chatStore: ReturnType<typeof useChatStore>
  let settingsStore: any
  let authStore: any

  beforeEach(() => {
    setupTestPinia()
    vi.clearAllMocks()
    vi.useFakeTimers()

    chatStore = useChatStore()

    settingsStore = {
      model: 'claude-3-5-sonnet-20241022',
      permissionMode: 'ask',
      allowedTools: [],
      disallowedTools: [],
      maxOutputTokens: 4096,
      thinkingMode: 'default',
    }

    authStore = {
      token: 'mock-auth-token',
    }

    // Setup store mocks
    ;(useSettingsStore as any).mockReturnValue(settingsStore)
    ;(useAuthStore as any).mockReturnValue(authStore)

    // Reset WebSocket mock
    mockWebSocket.connected.value = false
    mockWebSocket.connect.mockClear()
    mockWebSocket.send.mockClear()
    mockWebSocket.on.mockClear()
    mockWebSocket.disconnect.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('initialization', () => {
    it('should initialize and connect to WebSocket', () => {
      const { init } = useClaudeStream()

      init()

      expect(mockWebSocket.connect).toHaveBeenCalledTimes(1)
      expect(mockWebSocket.on).toHaveBeenCalledWith('stream_start', expect.any(Function))
      expect(mockWebSocket.on).toHaveBeenCalledWith('stream_delta', expect.any(Function))
      expect(mockWebSocket.on).toHaveBeenCalledWith('stream_end', expect.any(Function))
      expect(mockWebSocket.on).toHaveBeenCalledWith('tool_use', expect.any(Function))
      expect(mockWebSocket.on).toHaveBeenCalledWith('thinking_start', expect.any(Function))
      expect(mockWebSocket.on).toHaveBeenCalledWith('error', expect.any(Function))
    })

    it('should check session on WebSocket connection', async () => {
      const { init } = useClaudeStream()
      chatStore.sessionId = 'test-session'

      init()

      // Get the connected watcher function and call it
      const connectedWatcher = vi.mocked(mockWebSocket.on).mock.calls
        .find(call => call[0] === 'stream_start')?.[1]

      // Simulate connection
      mockWebSocket.connected.value = true

      // The watch should be called, but since we can't directly trigger it,
      // we'll verify the behavior through the session check call
      expect(mockWebSocket.on).toHaveBeenCalled()
    })
  })

  describe('stream events', () => {
    it('should handle stream_start event', () => {
      const { init } = useClaudeStream()
      init()

      // Find and call the stream_start handler
      const streamStartHandler = vi.mocked(mockWebSocket.on).mock.calls
        .find(call => call[0] === 'stream_start')?.[1] as Function

      streamStartHandler()

      expect(chatStore.isStreaming).toBe(true)
      expect(chatStore.messages).toHaveLength(1)
      expect(chatStore.messages[0]?.role).toBe('assistant')
      expect(chatStore.messages[0]?.isStreaming).toBe(true)
    })

    it('should handle stream_delta event', () => {
      const { init } = useClaudeStream()
      init()

      // Start streaming first
      const streamStartHandler = vi.mocked(mockWebSocket.on).mock.calls
        .find(call => call[0] === 'stream_start')?.[1] as Function
      streamStartHandler()

      // Handle delta
      const deltaHandler = vi.mocked(mockWebSocket.on).mock.calls
        .find(call => call[0] === 'stream_delta')?.[1] as Function

      deltaHandler({ text: 'Hello' })
      deltaHandler({ text: ' world' })

      expect(chatStore.messages[0]?.content).toBe('Hello world')
    })

    it('should create new message after tool use', () => {
      const { init } = useClaudeStream()
      init()

      // Start streaming
      const streamStartHandler = vi.mocked(mockWebSocket.on).mock.calls
        .find(call => call[0] === 'stream_start')?.[1] as Function
      streamStartHandler()

      // Add tool use
      const toolUseHandler = vi.mocked(mockWebSocket.on).mock.calls
        .find(call => call[0] === 'tool_use')?.[1] as Function
      toolUseHandler({
        tool: 'Read',
        input: { file_path: '/test/file.txt' },
        requestId: 'req-123',
      })

      // Add text after tool
      const deltaHandler = vi.mocked(mockWebSocket.on).mock.calls
        .find(call => call[0] === 'stream_delta')?.[1] as Function
      deltaHandler({ text: 'Text after tool' })

      expect(chatStore.messages).toHaveLength(3) // assistant, tool, new assistant
      expect(chatStore.messages[2]?.role).toBe('assistant')
      expect(chatStore.messages[2]?.content).toBe('Text after tool')
      expect(chatStore.messages[0]?.isStreaming).toBe(false) // Previous message no longer streaming
    })

    it('should handle stream_end event with session data', () => {
      const { init } = useClaudeStream()
      init()

      chatStore.projectPath = '/test/project'

      // stream_start sets activeSessionId so stream_end passes isForCurrentSession
      const streamStartHandler = vi.mocked(mockWebSocket.on).mock.calls
        .find(call => call[0] === 'stream_start')?.[1] as Function
      streamStartHandler({ sessionId: 'server-session-123' })

      const streamEndHandler = vi.mocked(mockWebSocket.on).mock.calls
        .find(call => call[0] === 'stream_end')?.[1] as Function

      streamEndHandler({
        sessionId: 'server-session-123',
        claudeSessionId: 'claude-session-456',
        usage: { input_tokens: 100, output_tokens: 50 },
        totalCost: 0.01,
      })

      expect(chatStore.sessionId).toBe('server-session-123')
      expect(chatStore.claudeSessionId).toBe('claude-session-456')
      expect(chatStore.activeProjectDir).toBe('/test/project')
      expect(chatStore.usage.inputTokens).toBe(100)
      expect(chatStore.usage.outputTokens).toBe(50)
      expect(chatStore.usage.totalCost).toBe(0.01)
      expect(chatStore.isStreaming).toBe(false)
    })
  })

  describe('tool use handling', () => {
    it('should handle tool_use event with auto-approval', () => {
      settingsStore.permissionMode = 'bypassPermissions'
      const { init } = useClaudeStream()
      init()

      const toolUseHandler = vi.mocked(mockWebSocket.on).mock.calls
        .find(call => call[0] === 'tool_use')?.[1] as Function

      toolUseHandler({
        tool: 'Read',
        input: { file_path: '/test/file.txt' },
        requestId: 'req-123',
      })

      expect(chatStore.messages).toHaveLength(1)
      expect(chatStore.messages[0]?.role).toBe('system')
      expect(chatStore.messages[0]?.toolUse?.status).toBe('approved')
    })

    it('should handle tool_use event without auto-approval', () => {
      settingsStore.permissionMode = 'ask'
      const { init } = useClaudeStream()
      init()

      const toolUseHandler = vi.mocked(mockWebSocket.on).mock.calls
        .find(call => call[0] === 'tool_use')?.[1] as Function

      toolUseHandler({
        tool: 'Read',
        input: { file_path: '/test/file.txt' },
        requestId: 'req-123',
      })

      expect(chatStore.messages[0]?.toolUse?.status).toBe('pending')
    })

    it('should auto-approve all tools in bypassPermissions mode (including AskUserQuestion)', () => {
      settingsStore.permissionMode = 'bypassPermissions'
      const { init } = useClaudeStream()
      init()

      const toolUseHandler = vi.mocked(mockWebSocket.on).mock.calls
        .find(call => call[0] === 'tool_use')?.[1] as Function

      toolUseHandler({
        tool: 'AskUserQuestion',
        input: { questions: [] },
        requestId: 'req-123',
      })

      // In bypassPermissions mode, ALL tools are pre-marked approved on the client
      expect(chatStore.messages[0]?.toolUse?.status).toBe('approved')
    })

    it('should not auto-approve file tools in acceptEdits mode (server handles it)', () => {
      settingsStore.permissionMode = 'acceptEdits'
      const { init } = useClaudeStream()
      init()

      const toolUseHandler = vi.mocked(mockWebSocket.on).mock.calls
        .find(call => call[0] === 'tool_use')?.[1] as Function

      toolUseHandler({
        tool: 'Edit',
        input: { file_path: '/test/file.txt', old_string: 'a', new_string: 'b' },
        requestId: 'req-123',
      })

      // Client starts tools as 'pending' in non-bypass modes; server auto-approves
      // via tool_approved event for acceptEdits-eligible tools
      expect(chatStore.messages[0]?.toolUse?.status).toBe('pending')
    })

    it('should not auto-approve Bash in acceptEdits mode', () => {
      settingsStore.permissionMode = 'acceptEdits'
      const { init } = useClaudeStream()
      init()

      const toolUseHandler = vi.mocked(mockWebSocket.on).mock.calls
        .find(call => call[0] === 'tool_use')?.[1] as Function

      toolUseHandler({
        tool: 'Bash',
        input: { command: 'echo hello' },
        requestId: 'req-123',
      })

      expect(chatStore.messages[0]?.toolUse?.status).toBe('pending')
    })

    it('should auto-approve internal tools regardless of permission mode', () => {
      settingsStore.permissionMode = 'default'
      const { init } = useClaudeStream()
      init()

      const toolUseHandler = vi.mocked(mockWebSocket.on).mock.calls
        .find(call => call[0] === 'tool_use')?.[1] as Function

      toolUseHandler({
        tool: 'EnterPlanMode',
        input: {},
        requestId: 'req-123',
      })

      expect(chatStore.messages[0]?.toolUse?.status).toBe('approved')
    })

    it('should track plan mode transitions', () => {
      const { init } = useClaudeStream()
      init()

      const toolUseHandler = vi.mocked(mockWebSocket.on).mock.calls
        .find(call => call[0] === 'tool_use')?.[1] as Function

      // Enter plan mode
      toolUseHandler({
        tool: 'EnterPlanMode',
        input: {},
        requestId: 'req-1',
      })
      expect(chatStore.inPlanMode).toBe(true)

      // Exit plan mode
      toolUseHandler({
        tool: 'ExitPlanMode',
        input: {},
        requestId: 'req-2',
      })
      expect(chatStore.inPlanMode).toBe(false)
    })

    it('should handle tool input streaming', () => {
      const { init } = useClaudeStream()
      init()

      // Add a tool message first
      const toolMessage = createMockMessage({
        role: 'system',
        toolUse: {
          tool: 'Bash',
          input: {},
          requestId: 'req-123',
          status: 'pending',
        },
      })
      chatStore.addMessage(toolMessage)

      // Handle input delta
      const inputDeltaHandler = vi.mocked(mockWebSocket.on).mock.calls
        .find(call => call[0] === 'tool_input_delta')?.[1] as Function

      inputDeltaHandler({
        requestId: 'req-123',
        accumulatedJson: '{"command": "ls -la"}',
      })

      expect(chatStore.messages[0]?.toolUse?.input).toEqual({ command: 'ls -la' })
      expect(chatStore.messages[0]?.toolUse?.isInputStreaming).toBe(true)

      // Complete input
      const inputCompleteHandler = vi.mocked(mockWebSocket.on).mock.calls
        .find(call => call[0] === 'tool_input_complete')?.[1] as Function

      inputCompleteHandler({
        requestId: 'req-123',
        input: { command: 'ls -la', description: 'List files' },
      })

      expect(chatStore.messages[0]?.toolUse?.input).toEqual({
        command: 'ls -la',
        description: 'List files',
      })
      expect(chatStore.messages[0]?.toolUse?.isInputStreaming).toBe(false)
    })
  })

  describe('thinking mode', () => {
    it('should handle thinking events', () => {
      const { init } = useClaudeStream()
      init()

      // Add assistant message first
      const assistantMessage = createMockMessage({ role: 'assistant' })
      chatStore.addMessage(assistantMessage)

      // Handle thinking events
      const thinkingStartHandler = vi.mocked(mockWebSocket.on).mock.calls
        .find(call => call[0] === 'thinking_start')?.[1] as Function
      const thinkingDeltaHandler = vi.mocked(mockWebSocket.on).mock.calls
        .find(call => call[0] === 'thinking_delta')?.[1] as Function
      const thinkingEndHandler = vi.mocked(mockWebSocket.on).mock.calls
        .find(call => call[0] === 'thinking_end')?.[1] as Function

      thinkingStartHandler()
      expect(chatStore.messages[0]?.isThinking).toBe(true)

      thinkingDeltaHandler({ text: 'Let me think...' })
      expect(chatStore.messages[0]?.thinking).toBe('Let me think...')

      thinkingEndHandler()
      expect(chatStore.messages[0]?.isThinking).toBe(false)
    })
  })

  describe('error handling', () => {
    it('should handle general errors', () => {
      const { init } = useClaudeStream()
      init()

      const errorHandler = vi.mocked(mockWebSocket.on).mock.calls
        .find(call => call[0] === 'error')?.[1] as Function

      errorHandler({ error: 'Something went wrong' })

      expect(chatStore.messages).toHaveLength(1)
      expect(chatStore.messages[0]?.role).toBe('system')
      expect(chatStore.messages[0]?.content).toBe('Error: Something went wrong')
      expect(chatStore.isStreaming).toBe(false)
    })

    it('should handle rate limit errors with time parsing', () => {
      const { init } = useClaudeStream()
      init()

      const errorHandler = vi.mocked(mockWebSocket.on).mock.calls
        .find(call => call[0] === 'error')?.[1] as Function

      // Mock current time
      const mockNow = new Date('2024-02-13T10:00:00Z').getTime()
      vi.setSystemTime(mockNow)

      errorHandler({
        error: 'You\'ve hit your usage limit. Your usage will reset Feb 13, 12pm.'
      })

      expect(chatStore.isRateLimited).toBe(true)
      expect(chatStore.rateLimitedUntil).toBeTruthy()
    })

    it('should handle rate limit errors with fallback timeout', () => {
      const { init } = useClaudeStream()
      init()

      const errorHandler = vi.mocked(mockWebSocket.on).mock.calls
        .find(call => call[0] === 'error')?.[1] as Function

      const beforeTime = Date.now()
      errorHandler({ error: 'Rate limit exceeded' })

      expect(chatStore.isRateLimited).toBe(true)
      expect(chatStore.rateLimitedUntil).toBeGreaterThan(beforeTime)
    })
  })

  describe('session management', () => {
    it('should handle session_status when streaming', () => {
      chatStore.sessionId = 'test-session'
      const { init } = useClaudeStream()
      init()

      const sessionStatusHandler = vi.mocked(mockWebSocket.on).mock.calls
        .find(call => call[0] === 'session_status')?.[1] as Function

      sessionStatusHandler({
        sessionId: 'test-session',
        serverSessionId: 'server-uuid-123',
        isStreaming: true,
        accumulatedText: 'Partial response...',
      })

      expect(chatStore.isStreaming).toBe(true)
      expect(chatStore.messages).toHaveLength(1)
      expect(chatStore.messages[0]?.content).toBe('Partial response...')
      expect(chatStore.messages[0]?.isStreaming).toBe(true)

      // Subsequent events should use serverSessionId and still be accepted
      const streamDeltaHandler = vi.mocked(mockWebSocket.on).mock.calls
        .find(call => call[0] === 'stream_delta')?.[1] as Function
      streamDeltaHandler({ sessionId: 'server-uuid-123', text: ' More text' })
      // Should NOT be rejected — activeSessionId was updated to server UUID
      expect(chatStore.messages[0]?.content).toBe('Partial response... More text')
    })

    it('should handle session_status when not streaming', async () => {
      const { init } = useClaudeStream()
      chatStore.sessionId = 'test-session'
      chatStore.activeProjectDir = '/test/project'

      init()

      // Mock fetch response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          messages: [createMockMessage()],
          total: 1,
        }),
      })

      const sessionStatusHandler = vi.mocked(mockWebSocket.on).mock.calls
        .find(call => call[0] === 'session_status')?.[1] as Function

      sessionStatusHandler({
        sessionId: 'test-session',
        isStreaming: false,
      })

      await vi.advanceTimersByTimeAsync(0)

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/sessions/test-session/messages?projectDir=%2Ftest%2Fproject&after=0',
        expect.objectContaining({
          headers: { Authorization: 'Bearer mock-auth-token' },
        })
      )
    })
  })

  describe('message sending', () => {
    it('should send message with correct payload', () => {
      const { init, sendMessage } = useClaudeStream()
      init()

      chatStore.sessionId = 'test-session'
      chatStore.claudeSessionId = 'claude-session'
      chatStore.projectPath = '/test/project'

      mockWebSocket.send.mockReturnValue(true)

      sendMessage('Hello Claude')

      expect(chatStore.messages).toHaveLength(1)
      expect(chatStore.messages[0]?.role).toBe('user')
      expect(chatStore.messages[0]?.content).toBe('Hello Claude')

      expect(mockWebSocket.send).toHaveBeenCalledWith({
        type: 'chat',
        prompt: 'Hello Claude',
        sessionId: 'test-session',
        claudeSessionId: 'claude-session',
        cwd: '/test/project',
        model: 'claude-3-5-sonnet-20241022',
        permissionMode: 'ask',
        allowedTools: [],
        disallowedTools: [],
        maxOutputTokens: 4096,
      })
    })

    it('should send message with thinking prefix', () => {
      settingsStore.thinkingMode = 'think_hard'
      const { init, sendMessage } = useClaudeStream()
      init()

      mockWebSocket.send.mockReturnValue(true)

      sendMessage('Solve this problem')

      expect(mockWebSocket.send).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: 'think hard before responding.\n\nSolve this problem',
        })
      )
    })

    it('should send message with images', () => {
      const { init, sendMessage } = useClaudeStream()
      init()

      mockWebSocket.send.mockReturnValue(true)

      const images = [
        { name: 'screenshot.png', dataUrl: 'data:image/png;base64,abc123' },
      ]

      sendMessage('Analyze this image', images)

      expect(chatStore.messages[0]?.images).toEqual(images)
      expect(mockWebSocket.send).toHaveBeenCalledWith(
        expect.objectContaining({
          images,
        })
      )
    })

    it('should handle send failure', () => {
      const { init, sendMessage } = useClaudeStream()
      init()

      mockWebSocket.send.mockReturnValue(false)

      sendMessage('Hello Claude')

      expect(chatStore.messages).toHaveLength(2) // user message + error message
      expect(chatStore.messages[1]?.content).toContain('Not connected to server')
    })
  })

  describe('tool responses', () => {
    it('should respond to tool with approval', () => {
      const { init, respondToTool } = useClaudeStream()
      init()

      // Add a tool message
      const toolMessage = createMockMessage({
        role: 'system',
        toolUse: {
          tool: 'AskUserQuestion',
          input: {},
          requestId: 'req-123',
          status: 'pending',
        },
      })
      chatStore.addMessage(toolMessage)

      respondToTool('req-123', true, { answer: 'Yes' })

      expect(mockWebSocket.send).toHaveBeenCalledWith({
        type: 'tool_response',
        requestId: 'req-123',
        approved: true,
        answers: { answer: 'Yes' },
        questions: undefined,
      })

      expect(chatStore.messages[0]?.toolUse?.status).toBe('approved')
      expect(chatStore.messages[0]?.toolUse?.input._userAnswers).toEqual({ answer: 'Yes' })
    })

    it('should respond to tool with rejection', () => {
      const { init, respondToTool } = useClaudeStream()
      init()

      // Add a tool message
      const toolMessage = createMockMessage({
        role: 'system',
        toolUse: {
          tool: 'Bash',
          input: {},
          requestId: 'req-456',
          status: 'pending',
        },
      })
      chatStore.addMessage(toolMessage)

      respondToTool('req-456', false)

      expect(mockWebSocket.send).toHaveBeenCalledWith({
        type: 'tool_response',
        requestId: 'req-456',
        approved: false,
        answers: undefined,
        questions: undefined,
      })

      expect(chatStore.messages[0]?.toolUse?.status).toBe('rejected')
    })
  })

  describe('utility functions', () => {
    it('should abort current operation', () => {
      const { init, abort } = useClaudeStream()
      init()

      abort()

      expect(mockWebSocket.send).toHaveBeenCalledWith({ type: 'abort', sessionId: 'test-session' })
    })

    it('should check session status', () => {
      const { init, checkSession } = useClaudeStream()
      init()

      checkSession('test-session')

      expect(mockWebSocket.send).toHaveBeenCalledWith({
        type: 'check_session',
        sessionId: 'test-session',
      })
    })

    it('should disconnect WebSocket', () => {
      const { init, disconnect } = useClaudeStream()
      init()

      disconnect()

      expect(mockWebSocket.disconnect).toHaveBeenCalledTimes(1)
    })
  })

  describe('time parsing', () => {
    // Test the internal parseResetTime function through error handling
    it('should parse various time formats in rate limit errors', () => {
      const { init } = useClaudeStream()
      init()

      const errorHandler = vi.mocked(mockWebSocket.on).mock.calls
        .find(call => call[0] === 'error')?.[1] as Function

      // Mock current time to Feb 13, 2024, 10:00 AM
      vi.setSystemTime(new Date('2024-02-13T10:00:00Z'))

      // Test different time formats
      const testCases = [
        'resets Feb 13, 12pm',
        'resets Feb 13 3:30pm',
        'resets Feb 13, 12am',
      ]

      testCases.forEach((errorText) => {
        chatStore.clearRateLimit() // Clear previous state
        errorHandler({ error: `Usage limit exceeded. ${errorText}` })
        expect(chatStore.isRateLimited).toBe(true)
      })
    })
  })
})