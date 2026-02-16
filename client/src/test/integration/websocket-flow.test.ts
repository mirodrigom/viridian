import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { ref } from 'vue'
import { useClaudeStream } from '@/composables/useClaudeStream'
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

// Create a more sophisticated WebSocket mock that can simulate real message flows
class WebSocketMock {
  public connected = ref(false)
  public eventHandlers: Record<string, Function[]> = {}

  public connect = vi.fn(() => {
    this.connected.value = true
  })

  public send = vi.fn(() => true)

  public on = vi.fn((event: string, handler: Function) => {
    if (!this.eventHandlers[event]) {
      this.eventHandlers[event] = []
    }
    this.eventHandlers[event]!.push(handler)
  })

  public disconnect = vi.fn(() => {
    this.connected.value = false
  })

  // Helper methods for testing
  public emit(event: string, data?: any) {
    this.eventHandlers[event]?.forEach(handler => handler(data))
  }

  public simulateConnection() {
    this.connected.value = true
  }

  public simulateDisconnection() {
    this.connected.value = false
  }
}

const mockWebSocket = new WebSocketMock()

vi.mock('@/composables/useWebSocket', () => ({
  useWebSocket: vi.fn(() => mockWebSocket),
}))

// Mock fetch
const mockFetch = vi.fn()
global.fetch = mockFetch

describe('WebSocket Integration Tests', () => {
  let chatStore: ReturnType<typeof useChatStore>
  let settingsStore: any
  let authStore: any

  beforeEach(() => {
    if (typeof sessionStorage !== 'undefined') sessionStorage.clear()
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

    ;(useSettingsStore as any).mockReturnValue(settingsStore)
    ;(useAuthStore as any).mockReturnValue(authStore)

    // Reset WebSocket mock
    mockWebSocket.eventHandlers = {}
    mockWebSocket.connected.value = false
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('Complete chat flow', () => {
    it('should handle complete streaming conversation flow', async () => {
      const { init, sendMessage } = useClaudeStream()
      init()

      // Send user message
      sendMessage('Hello Claude, can you help me?')

      expect(chatStore.messages).toHaveLength(1)
      expect(chatStore.messages[0]?.role).toBe('user')
      expect(chatStore.messages[0]?.content).toBe('Hello Claude, can you help me?')

      // Simulate streaming response
      mockWebSocket.emit('stream_start', {})

      expect(chatStore.isStreaming).toBe(true)
      expect(chatStore.messages).toHaveLength(2)
      expect(chatStore.messages[1]?.role).toBe('assistant')
      expect(chatStore.messages[1]?.isStreaming).toBe(true)

      // Stream text chunks
      mockWebSocket.emit('stream_delta', { text: 'Of course! ' })
      mockWebSocket.emit('stream_delta', { text: 'I\'d be happy ' })
      mockWebSocket.emit('stream_delta', { text: 'to help you.' })

      expect(chatStore.messages[1]?.content).toBe('Of course! I\'d be happy to help you.')

      // End stream
      mockWebSocket.emit('stream_end', {
        sessionId: 'server-session-123',
        claudeSessionId: 'claude-session-456',
        usage: { input_tokens: 15, output_tokens: 12 },
        totalCost: 0.001,
      })

      expect(chatStore.isStreaming).toBe(false)
      expect(chatStore.sessionId).toBe('server-session-123')
      expect(chatStore.claudeSessionId).toBe('claude-session-456')
      expect(chatStore.usage.inputTokens).toBe(15)
      expect(chatStore.usage.outputTokens).toBe(12)
    })

    it('should handle conversation with tool use and text splitting', async () => {
      const { init, sendMessage, respondToTool } = useClaudeStream()
      init()

      // Send request that triggers tool use
      sendMessage('Read the README file')

      // Start streaming
      mockWebSocket.emit('stream_start', {})
      mockWebSocket.emit('stream_delta', { text: 'I\'ll read the README file for you.' })

      // Tool use interrupts the stream
      mockWebSocket.emit('tool_use', {
        tool: 'Read',
        input: { file_path: '/README.md' },
        requestId: 'req-123',
      })

      expect(chatStore.messages).toHaveLength(3) // user, assistant, tool
      expect(chatStore.messages[1]?.content).toBe('I\'ll read the README file for you.')
      expect(chatStore.messages[1]?.isStreaming).toBe(false) // Should be false after tool
      expect(chatStore.messages[2]?.role).toBe('system')
      expect(chatStore.messages[2]?.toolUse?.tool).toBe('Read')
      expect(chatStore.messages[2]?.toolUse?.status).toBe('pending')

      // Approve tool
      respondToTool('req-123', true)
      expect(chatStore.messages[2]?.toolUse?.status).toBe('approved')

      // Continue streaming after tool (should create new assistant message)
      mockWebSocket.emit('stream_delta', { text: 'Based on the README:' })

      expect(chatStore.messages).toHaveLength(4) // user, assistant, tool, new assistant
      expect(chatStore.messages[3]?.role).toBe('assistant')
      expect(chatStore.messages[3]?.content).toBe('Based on the README:')
      expect(chatStore.messages[3]?.isStreaming).toBe(true)

      // Complete the response
      mockWebSocket.emit('stream_delta', { text: ' The project is...' })
      mockWebSocket.emit('stream_end', {})

      expect(chatStore.messages[3]?.content).toBe('Based on the README: The project is...')
      expect(chatStore.messages[3]?.isStreaming).toBe(false)
    })

    it('should handle tool input streaming', async () => {
      const { init, sendMessage } = useClaudeStream()
      init()

      sendMessage('Run a bash command')

      // Start with tool use (stream_start creates assistant at [1], tool_use creates tool at [2])
      mockWebSocket.emit('stream_start', {})
      mockWebSocket.emit('tool_use', {
        tool: 'Bash',
        input: {},
        requestId: 'req-bash-123',
      })

      // Stream tool input
      mockWebSocket.emit('tool_input_delta', {
        requestId: 'req-bash-123',
        accumulatedJson: '{"command":'
      })

      // Should not parse incomplete JSON (tool message is at index 2)
      expect(chatStore.messages[2]?.toolUse?.input).toEqual({})
      expect(chatStore.messages[2]?.toolUse?.isInputStreaming).toBe(true)

      mockWebSocket.emit('tool_input_delta', {
        requestId: 'req-bash-123',
        accumulatedJson: '{"command": "ls -la", "description":'
      })

      mockWebSocket.emit('tool_input_delta', {
        requestId: 'req-bash-123',
        accumulatedJson: '{"command": "ls -la", "description": "List directory contents"}'
      })

      // Should parse complete JSON
      expect(chatStore.messages[2]?.toolUse?.input).toEqual({
        command: 'ls -la',
        description: 'List directory contents'
      })

      // Complete input
      mockWebSocket.emit('tool_input_complete', {
        requestId: 'req-bash-123',
        input: {
          command: 'ls -la',
          description: 'List directory contents in detail'
        }
      })

      expect(chatStore.messages[2]?.toolUse?.input).toEqual({
        command: 'ls -la',
        description: 'List directory contents in detail'
      })
      expect(chatStore.messages[2]?.toolUse?.isInputStreaming).toBe(false)
    })

    it('should handle thinking mode flow', async () => {
      const { init, sendMessage } = useClaudeStream()
      init()

      sendMessage('Solve this complex problem')

      // Start streaming
      mockWebSocket.emit('stream_start', {})

      // Start thinking
      mockWebSocket.emit('thinking_start')
      expect(chatStore.messages[1]?.isThinking).toBe(true)

      // Stream thinking content
      mockWebSocket.emit('thinking_delta', { text: 'Let me break this down...' })
      mockWebSocket.emit('thinking_delta', { text: ' First, I need to...' })

      expect(chatStore.messages[1]?.thinking).toBe('Let me break this down... First, I need to...')

      // End thinking
      mockWebSocket.emit('thinking_end')
      expect(chatStore.messages[1]?.isThinking).toBe(false)

      // Continue with regular response
      mockWebSocket.emit('stream_delta', { text: 'Here\'s my solution:' })
      mockWebSocket.emit('stream_end', {})

      expect(chatStore.messages[1]?.content).toBe('Here\'s my solution:')
      expect(chatStore.messages[1]?.thinking).toBe('Let me break this down... First, I need to...')
    })
  })

  describe('Session recovery scenarios', () => {
    it('should handle reconnection during active streaming', async () => {
      const { init } = useClaudeStream()
      chatStore.sessionId = 'active-session'
      chatStore.activeProjectDir = '/test/project'

      init()

      // Simulate disconnection and reconnection
      mockWebSocket.simulateConnection()

      // Simulate server indicating active streaming session
      // serverSessionId is the internal UUID that wireEmitter uses for subsequent events
      mockWebSocket.emit('session_status', {
        sessionId: 'active-session',
        serverSessionId: 'server-uuid-456',
        isStreaming: true,
        accumulatedText: 'Partial response in progress...'
      })

      expect(chatStore.isStreaming).toBe(true)
      expect(chatStore.messages).toHaveLength(1)
      expect(chatStore.messages[0]?.content).toBe('Partial response in progress...')
      expect(chatStore.messages[0]?.isStreaming).toBe(true)

      // Continue streaming — events now carry the server's internal UUID
      mockWebSocket.emit('stream_delta', { sessionId: 'server-uuid-456', text: ' continuing after reconnect.' })

      expect(chatStore.messages[0]?.content).toBe('Partial response in progress... continuing after reconnect.')

      // End stream with reload trigger
      mockWebSocket.emit('stream_end', {
        sessionId: 'server-uuid-456',
        claudeSessionId: 'claude-session-789'
      })

      // Should trigger full reload since we reconnected mid-stream.
      // Uses claudeSessionId (JSONL filename) for the REST API, not the server UUID.
      await vi.advanceTimersByTimeAsync(0)

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/sessions/claude-session-789/messages'),
        expect.any(Object)
      )
    })

    it('should fetch missed messages when reconnecting to finished session', async () => {
      const { init } = useClaudeStream()
      chatStore.sessionId = 'finished-session'
      chatStore.activeProjectDir = '/test/project'
      chatStore.messages = [createMockMessage()] // Existing message
      chatStore.oldestLoadedIndex = 0

      init()

      // Mock API response for missed messages
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          messages: [
            createMockMessage({ content: 'New message 1' }),
            createMockMessage({ content: 'New message 2' })
          ],
          total: 3,
          usage: { inputTokens: 50, outputTokens: 25 }
        })
      })

      // Simulate reconnection to finished session
      mockWebSocket.emit('session_status', {
        sessionId: 'finished-session',
        isStreaming: false
      })

      await vi.advanceTimersByTimeAsync(0)

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/sessions/finished-session/messages?projectDir=%2Ftest%2Fproject&after=1',
        expect.objectContaining({
          headers: { Authorization: 'Bearer mock-auth-token' }
        })
      )

      expect(chatStore.messages).toHaveLength(3) // Original + 2 new
      expect(chatStore.usage.inputTokens).toBe(50)
      expect(chatStore.usage.outputTokens).toBe(25)
    })

    it('should handle session check on connection', async () => {
      const { init } = useClaudeStream()
      chatStore.sessionId = 'existing-session'

      init()

      // Simulate connection event triggering session check
      mockWebSocket.simulateConnection()

      // Note: The actual session check is triggered by a watcher,
      // but we can verify the handler is set up correctly
      expect(mockWebSocket.on).toHaveBeenCalledWith('session_status', expect.any(Function))
    })
  })

  describe('Error recovery', () => {
    it('should handle rate limit with auto-recovery', async () => {
      const { init, sendMessage } = useClaudeStream()
      init()

      // Send message that triggers rate limit
      sendMessage('Test message')

      // Simulate rate limit error (use generic rate limit text so fallback 5-min timer is used)
      mockWebSocket.emit('error', {
        error: 'You\'ve hit your usage limit. Please try again later.'
      })

      expect(chatStore.isRateLimited).toBe(true)
      expect(chatStore.isStreaming).toBe(false)
      expect(chatStore.messages[1]?.content).toContain('Error:')

      // Fast forward past the fallback reset time (5 minutes)
      const resetTime = chatStore.rateLimitedUntil!
      const remaining = resetTime - Date.now() + 1000
      vi.setSystemTime(resetTime + 1000)
      await vi.advanceTimersByTimeAsync(remaining)

      expect(chatStore.isRateLimited).toBe(false)
    })

    it('should handle connection errors gracefully', async () => {
      const { init, sendMessage } = useClaudeStream()
      init()

      // Simulate send failure due to disconnection
      mockWebSocket.send.mockReturnValue(false)

      sendMessage('Test message')

      expect(chatStore.messages).toHaveLength(2)
      expect(chatStore.messages[1]?.content).toContain('Not connected to server')
    })

    it('should handle malformed WebSocket messages', async () => {
      const { init } = useClaudeStream()
      init()

      // These should not crash the application
      mockWebSocket.emit('stream_delta', null)
      mockWebSocket.emit('stream_delta', undefined)
      mockWebSocket.emit('tool_use', null)

      // Application should still be functional (no crash)
      expect(chatStore.isStreaming).toBe(false)
    })
  })

  describe('Multiple tool workflow', () => {
    it('should handle complex multi-tool workflow correctly', async () => {
      const { init, sendMessage, respondToTool } = useClaudeStream()
      init()

      sendMessage('Analyze and fix the code in src/main.js')

      // Start response
      mockWebSocket.emit('stream_start', {})
      mockWebSocket.emit('stream_delta', { text: 'I\'ll analyze and fix the code. First, let me read the file.' })

      // First tool: Read file
      mockWebSocket.emit('tool_use', {
        tool: 'Read',
        input: { file_path: 'src/main.js' },
        requestId: 'req-read-1'
      })

      // Messages: user[0], assistant[1], tool[2]
      const toolMessages0 = chatStore.messages.filter(m => m.toolUse)
      expect(toolMessages0).toHaveLength(1)
      expect(toolMessages0[0]?.toolUse?.tool).toBe('Read')

      // Approve read
      respondToTool('req-read-1', true)

      // Continue with analysis (creates new assistant after tool)
      mockWebSocket.emit('stream_delta', { text: 'I found several issues. Let me fix them:' })

      // Second tool: Edit file
      mockWebSocket.emit('tool_use', {
        tool: 'Edit',
        input: {
          file_path: 'src/main.js',
          old_string: 'const buggyCode = true;',
          new_string: 'const fixedCode = true;'
        },
        requestId: 'req-edit-1'
      })

      const toolMessages1 = chatStore.messages.filter(m => m.toolUse)
      expect(toolMessages1).toHaveLength(2)

      // Approve edit
      respondToTool('req-edit-1', true)

      // Third tool: Run tests (creates new assistant after tool)
      mockWebSocket.emit('stream_delta', { text: 'Now let me run the tests to verify:' })

      mockWebSocket.emit('tool_use', {
        tool: 'Bash',
        input: { command: 'npm test' },
        requestId: 'req-bash-1'
      })

      const toolMessages2 = chatStore.messages.filter(m => m.toolUse)
      expect(toolMessages2).toHaveLength(3)

      // Approve test run
      respondToTool('req-bash-1', true)

      // Final response (creates new assistant after tool)
      mockWebSocket.emit('stream_delta', { text: 'Perfect! All tests are passing. The issues have been fixed.' })

      mockWebSocket.emit('stream_end', {
        usage: { input_tokens: 200, output_tokens: 150 }
      })

      // Verify final state
      expect(chatStore.isStreaming).toBe(false)

      // Check all tool statuses
      const toolMessages = chatStore.messages.filter(m => m.toolUse)
      expect(toolMessages).toHaveLength(3)
      toolMessages.forEach(msg => {
        expect(msg.toolUse?.status).toBe('approved')
      })

      // Verify message structure: alternating assistant/tool pattern
      const roles = chatStore.messages.map(m => m.role)
      expect(roles[0]).toBe('user')
      // Rest should alternate between assistant and system (tool)
      const assistantMsgs = chatStore.messages.filter(m => m.role === 'assistant')
      expect(assistantMsgs.length).toBeGreaterThanOrEqual(4) // initial + after each tool
    })
  })
})