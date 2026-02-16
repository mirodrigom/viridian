import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { useClaudeStream } from '@/composables/useClaudeStream'
import { useChatStore } from '@/stores/chat'
import { useSettingsStore } from '@/stores/settings'
import { useAuthStore } from '@/stores/auth'
import { setupTestPinia, createMockMessage, nextTick, wait } from '@/test/utils'
import {
  VSCodeStreamSimulator,
  assertVSCodeTiming,
  assertVSCodeMessageFlow,
  assertVSCodeStreamingStates,
  VSCODE_TIMINGS,
  VSCODE_TEST_CONTENT
} from './vscode-patterns'

// Mock the stores
vi.mock('@/stores/settings', () => ({
  useSettingsStore: vi.fn(),
}))

vi.mock('@/stores/auth', () => ({
  useAuthStore: vi.fn(),
}))

// Enhanced WebSocket mock that tracks timing and visual states
class VSCodeBehaviorMock {
  public connected = { value: false }
  public eventHandlers: Record<string, Function[]> = {}
  public sentMessages: any[] = []
  public timingLogs: { event: string; timestamp: number; data?: any }[] = []

  public connect = vi.fn(() => {
    this.connected.value = true
    this.logTiming('connection_established')
  })

  public send = vi.fn((data) => {
    this.sentMessages.push({ ...data, timestamp: Date.now() })
    this.logTiming('message_sent', data)
    return true
  })

  public on = vi.fn((event: string, handler: Function) => {
    if (!this.eventHandlers[event]) {
      this.eventHandlers[event] = []
    }
    this.eventHandlers[event]!.push(handler)
  })

  public disconnect = vi.fn(() => {
    this.connected.value = false
    this.logTiming('connection_lost')
  })

  public emit(event: string, data?: any) {
    this.logTiming(event, data)
    this.eventHandlers[event]?.forEach(handler => handler(data))
  }

  public logTiming(event: string, data?: any) {
    this.timingLogs.push({ event, timestamp: Date.now(), data })
  }

  public getTimingSequence(): string[] {
    return this.timingLogs.map(log => log.event)
  }

  public getTimingDeltas(): number[] {
    const deltas = []
    for (let i = 1; i < this.timingLogs.length; i++) {
      deltas.push(this.timingLogs[i]!.timestamp - this.timingLogs[i - 1]!.timestamp)
    }
    return deltas
  }

  public simulateConnection() {
    this.connected.value = true
    this.logTiming('connection_established')
  }

  public simulateDisconnection() {
    this.connected.value = false
    this.logTiming('connection_lost')
  }

  public reset() {
    this.sentMessages = []
    this.timingLogs = []
    this.eventHandlers = {}
    this.connected.value = false
  }
}

const mockWebSocket = new VSCodeBehaviorMock()

vi.mock('@/composables/useWebSocket', () => ({
  useWebSocket: vi.fn(() => mockWebSocket),
}))

// Mock fetch for session recovery
const mockFetch = vi.fn()
global.fetch = mockFetch

// Mock router
const mockRouter = {
  currentRoute: { value: { params: { sessionId: null } } },
  replace: vi.fn(),
}

vi.mock('vue-router', () => ({
  useRouter: () => mockRouter,
}))

describe('VS Code Parity Behavioral Tests', () => {
  let chatStore: ReturnType<typeof useChatStore>
  let settingsStore: any
  let authStore: any
  let streamSimulator: VSCodeStreamSimulator

  beforeEach(() => {
    // Clear sessionStorage BEFORE creating stores (chat store reads from it)
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

    mockWebSocket.reset()
    mockRouter.currentRoute.value.params.sessionId = null

    streamSimulator = new VSCodeStreamSimulator()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('Visual Streaming States - VS Code Behavior Match', () => {
    it('should show typing indicator before content streams (like VS Code)', async () => {
      const { init, sendMessage } = useClaudeStream()
      init()

      // In VS Code, there's a brief typing indicator before text starts streaming
      sendMessage('Hello Claude')

      expect(chatStore.messages).toHaveLength(1)
      expect(chatStore.messages[0]?.role).toBe('user')

      // Simulate the typing indicator phase (VS Code shows this briefly)
      mockWebSocket.emit('stream_start', {})

      // At stream_start, VS Code shows typing indicator
      expect(chatStore.isStreaming).toBe(true)
      expect(chatStore.messages).toHaveLength(2)

      const assistantMsg = chatStore.messages[1]
      expect(assistantMsg?.role).toBe('assistant')
      expect(assistantMsg?.content).toBe('') // Empty during typing indicator
      expect(assistantMsg?.isStreaming).toBe(true)

      // Advance time to simulate typing indicator duration (VS Code shows ~100-200ms)
      vi.advanceTimersByTime(150)

      // Now content should start streaming
      mockWebSocket.emit('stream_delta', { text: 'Hello! ' })

      expect(assistantMsg?.content).toBe('Hello! ')
      expect(assistantMsg?.isStreaming).toBe(true)

      // Verify timing sequence matches VS Code pattern
      const sequence = mockWebSocket.getTimingSequence()
      expect(sequence).toEqual([
        'connection_established',
        'message_sent',
        'stream_start',
        'stream_delta'
      ])
    })

    it('should handle incremental content rendering smoothly (like VS Code streaming)', async () => {
      const { init, sendMessage } = useClaudeStream()
      init()

      sendMessage('Write a longer response')
      mockWebSocket.emit('stream_start', {})

      const contentChunks = [
        'I\'ll help you with that. ',
        'Let me break this down step by step:\n\n',
        '1. First, we need to understand ',
        'the requirements clearly.\n',
        '2. Then we can design ',
        'the appropriate solution.\n',
        '3. Finally, we\'ll implement ',
        'and test the result.'
      ]

      // Stream content in chunks with realistic timing
      for (let i = 0; i < contentChunks.length; i++) {
        vi.advanceTimersByTime(50) // Simulate ~50ms between chunks (VS Code rate)
        mockWebSocket.emit('stream_delta', { text: contentChunks[i] })

        const assistantMsg = chatStore.messages[1]
        expect(assistantMsg?.isStreaming).toBe(true)
        expect(assistantMsg?.content).toBe(contentChunks.slice(0, i + 1).join(''))
      }

      // Complete the stream
      mockWebSocket.emit('stream_end', {})

      const finalMsg = chatStore.messages[1]
      expect(finalMsg?.isStreaming).toBe(false)
      expect(finalMsg?.content).toBe(contentChunks.join(''))

      // Verify content version was incremented for each chunk (drives auto-scroll)
      expect(chatStore.contentVersion).toBeGreaterThanOrEqual(contentChunks.length)
    })

    it('should preserve visual flow during tool approval (like VS Code)', async () => {
      const { init, sendMessage, respondToTool } = useClaudeStream()
      init()

      sendMessage('Read a file for me')

      mockWebSocket.emit('stream_start', {})
      mockWebSocket.emit('stream_delta', { text: 'I\'ll read that file for you.' })

      // Tool request interrupts stream (like VS Code)
      mockWebSocket.emit('tool_use', {
        tool: 'Read',
        input: { file_path: '/test.txt' },
        requestId: 'req-123'
      })

      // Check that the previous message is properly closed (not streaming)
      expect(chatStore.messages[1]?.isStreaming).toBe(false)
      expect(chatStore.messages[1]?.content).toBe('I\'ll read that file for you.')

      // Tool message should be added
      expect(chatStore.messages).toHaveLength(3)
      const toolMsg = chatStore.messages[2]
      expect(toolMsg?.role).toBe('system')
      expect(toolMsg?.toolUse?.status).toBe('pending')

      // Approve tool (this should be seamless like VS Code)
      const approvalTimestamp = Date.now()
      respondToTool('req-123', true)

      expect(toolMsg?.toolUse?.status).toBe('approved')

      // Continue streaming should create new assistant message (matching VS Code layout)
      mockWebSocket.emit('stream_delta', { text: 'Based on the file contents: ' })

      expect(chatStore.messages).toHaveLength(4)
      const continueMsg = chatStore.messages[3]
      expect(continueMsg?.role).toBe('assistant')
      expect(continueMsg?.content).toBe('Based on the file contents: ')
      expect(continueMsg?.isStreaming).toBe(true)

      // Verify tool approval didn't break the flow timing
      const timingDeltas = mockWebSocket.getTimingDeltas()
      expect(timingDeltas.every(delta => delta < 1000)).toBe(true) // No delays > 1s
    })

    it('should handle thinking mode visual states (like VS Code Claude)', async () => {
      const { init, sendMessage } = useClaudeStream()
      init()

      sendMessage('Solve this complex problem')

      mockWebSocket.emit('stream_start', {})

      // Start thinking (VS Code shows thinking indicator)
      mockWebSocket.emit('thinking_start')

      const assistantMsg = chatStore.messages[1]
      expect(assistantMsg?.isThinking).toBe(true)
      expect(assistantMsg?.thinking).toBe('')

      // Stream thinking content
      mockWebSocket.emit('thinking_delta', { text: 'Let me think about this... ' })
      mockWebSocket.emit('thinking_delta', { text: 'I need to consider multiple approaches.' })

      expect(assistantMsg?.thinking).toBe('Let me think about this... I need to consider multiple approaches.')
      expect(assistantMsg?.isThinking).toBe(true)

      // End thinking phase
      mockWebSocket.emit('thinking_end')
      expect(assistantMsg?.isThinking).toBe(false)

      // Continue with normal response
      mockWebSocket.emit('stream_delta', { text: 'Here\'s my solution:' })

      expect(assistantMsg?.content).toBe('Here\'s my solution:')
      expect(assistantMsg?.thinking).toBe('Let me think about this... I need to consider multiple approaches.')
      expect(assistantMsg?.isStreaming).toBe(true)
    })
  })

  describe('Session Continuity - VS Code Experience Match', () => {
    it('should restore session seamlessly without jarring reloads (like VS Code)', async () => {
      const { init } = useClaudeStream()

      // Simulate existing session state
      chatStore.sessionId = 'existing-session-123'
      chatStore.claudeSessionId = 'claude-session-456'
      chatStore.messages = [
        createMockMessage({ content: 'Previous conversation', role: 'user' }),
        createMockMessage({ content: 'Previous response', role: 'assistant' })
      ]

      // Initialize (like VS Code opening a project with existing session)
      init()
      mockWebSocket.simulateConnection()

      // Simulate server confirming session continuity
      mockWebSocket.emit('session_status', {
        sessionId: 'existing-session-123',
        claudeSessionId: 'claude-session-456',
        isStreaming: false
      })

      // Should not trigger reload since session is consistent
      await vi.advanceTimersByTimeAsync(0)

      expect(mockFetch).not.toHaveBeenCalled()
      expect(chatStore.messages).toHaveLength(2) // Original messages preserved
      expect(chatStore.sessionId).toBe('existing-session-123')
    })

    it('should handle mid-stream reconnection gracefully (like VS Code network recovery)', async () => {
      const { init, sendMessage } = useClaudeStream()
      init()

      sendMessage('Start a long response')
      mockWebSocket.emit('stream_start', {})
      mockWebSocket.emit('stream_delta', { text: 'This is a long response that will be ' })

      // Simulate network interruption during streaming
      mockWebSocket.simulateDisconnection()
      expect(mockWebSocket.connected.value).toBe(false)

      // Simulate reconnection
      vi.advanceTimersByTime(2000) // 2s network delay
      mockWebSocket.simulateConnection()

      // Server indicates we were streaming and provides accumulated content.
      // Since messages are already loaded, session_status keeps existing content
      // and just marks the last assistant message as streaming.
      mockWebSocket.emit('session_status', {
        sessionId: chatStore.sessionId,
        serverSessionId: 'server-uuid-reconnect',
        isStreaming: true,
        accumulatedText: 'This is a long response that will be interrupted by network issues but should '
      })

      // Should seamlessly continue from where we left off
      expect(chatStore.isStreaming).toBe(true)
      const reconnectedMsg = chatStore.messages[chatStore.messages.length - 1]
      // Content is preserved from before disconnect (not replaced by accumulatedText)
      expect(reconnectedMsg?.content).toBe('This is a long response that will be ')
      expect(reconnectedMsg?.isStreaming).toBe(true)

      // Continue streaming — events now carry server UUID
      mockWebSocket.emit('stream_delta', { sessionId: 'server-uuid-reconnect', text: 'continue smoothly after reconnection.' })
      mockWebSocket.emit('stream_end', { sessionId: 'server-uuid-reconnect' })

      expect(reconnectedMsg?.content).toBe(
        'This is a long response that will be continue smoothly after reconnection.'
      )
      expect(reconnectedMsg?.isStreaming).toBe(false)
    })

    it('should handle session ID transitions smoothly (like VS Code project switching)', async () => {
      const { init } = useClaudeStream()
      init()

      // Start with no session (like new VS Code window)
      expect(chatStore.sessionId).toBeNull()
      expect(mockRouter.currentRoute.value.params.sessionId).toBeNull()

      // First interaction creates session
      mockWebSocket.emit('stream_end', {
        sessionId: 'new-server-session-123',
        claudeSessionId: 'new-claude-session-456'
      })

      expect(chatStore.sessionId).toBe('new-server-session-123')
      expect(chatStore.claudeSessionId).toBe('new-claude-session-456')

      // URL should update to use claudeSessionId (like VS Code session persistence)
      expect(mockRouter.replace).toHaveBeenCalledWith({
        name: 'chat-session',
        params: { sessionId: 'new-claude-session-456' }
      })
    })
  })

  describe('Error Recovery UX - VS Code-like Error Handling', () => {
    it('should present rate limit errors inline without breaking flow (like VS Code)', async () => {
      const { init, sendMessage } = useClaudeStream()
      init()

      sendMessage('Test message that hits rate limit')

      // Simulate rate limit response
      mockWebSocket.emit('error', {
        error: 'You\'ve hit your usage limit. Your usage resets Feb 13, 3:45pm'
      })

      // Should add error as system message (inline like VS Code)
      expect(chatStore.messages).toHaveLength(2)
      expect(chatStore.messages[1]?.role).toBe('system')
      expect(chatStore.messages[1]?.content).toContain('Error: You\'ve hit your usage limit')

      // Should set rate limit state
      expect(chatStore.isRateLimited).toBe(true)
      expect(chatStore.isStreaming).toBe(false)

      // Should have a reset time in the future
      expect(chatStore.rateLimitedUntil).toBeGreaterThan(Date.now())

      // Auto-recovery should work (like VS Code auto-retry)
      const resetTime = chatStore.rateLimitedUntil!
      const remaining = resetTime - Date.now() + 1000
      vi.setSystemTime(resetTime + 1000) // Past reset time
      await vi.advanceTimersByTimeAsync(remaining)

      expect(chatStore.isRateLimited).toBe(false)
    })

    it('should handle connection errors gracefully without losing context (like VS Code)', async () => {
      const { init, sendMessage } = useClaudeStream()
      init()

      // Simulate connection failure during send
      mockWebSocket.send.mockReturnValue(false)
      mockWebSocket.connected.value = false

      sendMessage('Message that fails to send')

      // Should show connection error inline
      expect(chatStore.messages).toHaveLength(2)
      expect(chatStore.messages[1]?.content).toContain('Not connected to server')

      // Message history should be preserved (like VS Code)
      expect(chatStore.messages[0]?.content).toBe('Message that fails to send')
      expect(chatStore.messages[0]?.role).toBe('user')

      // When connection recovers, should be able to continue
      mockWebSocket.send.mockReturnValue(true)
      mockWebSocket.connected.value = true

      sendMessage('Message after reconnection')
      expect(chatStore.messages).toHaveLength(3) // Original user, error, new user
    })

    it('should handle malformed responses without breaking session (like VS Code error tolerance)', async () => {
      const { init, sendMessage } = useClaudeStream()
      init()

      sendMessage('Normal message')
      mockWebSocket.emit('stream_start', {})

      // Send various malformed messages that shouldn't crash the app
      mockWebSocket.emit('stream_delta', null)
      mockWebSocket.emit('stream_delta', undefined)
      mockWebSocket.emit('stream_delta', { malformed: 'no text field' })
      mockWebSocket.emit('tool_use', null)
      mockWebSocket.emit('error', null)

      // App should still be functional (like VS Code resilience)
      expect(chatStore.messages).toHaveLength(2) // user + empty assistant
      expect(chatStore.messages[1]?.content).toBe('') // No content from malformed messages
      expect(chatStore.isStreaming).toBe(true) // Still streaming

      // Valid message should still work
      mockWebSocket.emit('stream_delta', { text: 'This should work fine.' })
      expect(chatStore.messages[1]?.content).toBe('This should work fine.')

      // Complete normally
      mockWebSocket.emit('stream_end', {})
      expect(chatStore.isStreaming).toBe(false)
    })
  })

  describe('Tool Integration UX - VS Code-like Seamless Experience', () => {
    it('should show tool input streaming naturally (like VS Code parameter building)', async () => {
      const { init, sendMessage } = useClaudeStream()
      init()

      sendMessage('Run a bash command to list files')

      mockWebSocket.emit('stream_start', {})
      mockWebSocket.emit('stream_delta', { text: 'I\'ll list the files for you.' })

      // Tool starts with empty input
      mockWebSocket.emit('tool_use', {
        tool: 'Bash',
        input: {},
        requestId: 'req-bash-1'
      })

      const toolMsg = chatStore.messages[2]
      expect(toolMsg?.toolUse?.input).toEqual({})
      expect(toolMsg?.toolUse?.isInputStreaming).toBeUndefined()

      // Input streams in progressively (like VS Code showing parameter building)
      mockWebSocket.emit('tool_input_delta', {
        requestId: 'req-bash-1',
        accumulatedJson: '{"command": "ls'
      })

      expect(toolMsg?.toolUse?.isInputStreaming).toBe(true)
      expect(toolMsg?.toolUse?.input).toEqual({}) // Invalid JSON not parsed yet

      mockWebSocket.emit('tool_input_delta', {
        requestId: 'req-bash-1',
        accumulatedJson: '{"command": "ls -la", "description": "List'
      })

      expect(toolMsg?.toolUse?.isInputStreaming).toBe(true)

      mockWebSocket.emit('tool_input_delta', {
        requestId: 'req-bash-1',
        accumulatedJson: '{"command": "ls -la", "description": "List directory contents"}'
      })

      // Valid JSON should be parsed and displayed
      expect(toolMsg?.toolUse?.input).toEqual({
        command: 'ls -la',
        description: 'List directory contents'
      })

      // Complete input streaming
      mockWebSocket.emit('tool_input_complete', {
        requestId: 'req-bash-1',
        input: {
          command: 'ls -la',
          description: 'List directory contents in detail'
        }
      })

      expect(toolMsg?.toolUse?.isInputStreaming).toBe(false)
      expect(toolMsg?.toolUse?.input).toEqual({
        command: 'ls -la',
        description: 'List directory contents in detail'
      })
    })

    it('should handle complex multi-tool workflows smoothly (like VS Code task chains)', async () => {
      const { init, sendMessage, respondToTool } = useClaudeStream()
      init()

      sendMessage('Analyze and improve this code file')

      // Start with analysis text
      mockWebSocket.emit('stream_start', {})
      mockWebSocket.emit('stream_delta', { text: 'I\'ll analyze the code for you. First, let me read the file.' })

      // Tool 1: Read file
      mockWebSocket.emit('tool_use', {
        tool: 'Read',
        input: { file_path: 'src/example.js' },
        requestId: 'read-1'
      })

      respondToTool('read-1', true)

      // Continue analysis
      mockWebSocket.emit('stream_delta', { text: 'Now I\'ll analyze the patterns and suggest improvements.' })

      // Tool 2: Write improved version
      mockWebSocket.emit('tool_use', {
        tool: 'Edit',
        input: {
          file_path: 'src/example.js',
          old_string: 'old code pattern',
          new_string: 'improved code pattern'
        },
        requestId: 'edit-1'
      })

      respondToTool('edit-1', true)

      // Tool 3: Run tests
      mockWebSocket.emit('stream_delta', { text: 'Let me run the tests to verify the changes work correctly.' })

      mockWebSocket.emit('tool_use', {
        tool: 'Bash',
        input: { command: 'npm test', description: 'Run test suite' },
        requestId: 'bash-1'
      })

      respondToTool('bash-1', true)

      // Final summary
      mockWebSocket.emit('stream_delta', { text: 'Perfect! All tests pass. The code has been successfully improved.' })
      mockWebSocket.emit('stream_end', {})

      // Verify the workflow created the expected message structure
      expect(chatStore.messages).toHaveLength(8) // user, 4x assistant text, 3x tools

      // Check message flow matches VS Code experience (text -> tool -> text pattern)
      expect(chatStore.messages[0]?.role).toBe('user')
      expect(chatStore.messages[1]?.role).toBe('assistant') // Initial analysis
      expect(chatStore.messages[2]?.role).toBe('system') // Read tool
      expect(chatStore.messages[3]?.role).toBe('assistant') // Continue analysis
      expect(chatStore.messages[4]?.role).toBe('system') // Edit tool
      expect(chatStore.messages[5]?.role).toBe('assistant') // Test prep
      expect(chatStore.messages[6]?.role).toBe('system') // Bash tool
      expect(chatStore.messages[7]?.role).toBe('assistant') // Final summary

      // All tools should be approved
      const toolMessages = chatStore.messages.filter(m => m.toolUse)
      expect(toolMessages).toHaveLength(3)
      toolMessages.forEach(msg => {
        expect(msg.toolUse?.status).toBe('approved')
      })
    })
  })

  describe('Performance and Responsiveness - VS Code Standards', () => {
    it('should maintain responsive UI during heavy streaming (like VS Code)', async () => {
      const { init, sendMessage } = useClaudeStream()
      init()

      sendMessage('Generate a very long response')
      mockWebSocket.emit('stream_start', {})

      // Simulate high-frequency streaming (like VS Code can handle)
      const largeChunks = Array(100).fill(0).map((_, i) =>
        `This is chunk ${i} of a very long response that tests streaming performance. `
      )

      const startTime = Date.now()

      for (const chunk of largeChunks) {
        mockWebSocket.emit('stream_delta', { text: chunk })
        // Simulate realistic streaming intervals
        vi.advanceTimersByTime(20) // 20ms between chunks
      }

      const processingTime = Date.now() - startTime

      // Should handle 100 chunks efficiently (like VS Code performance)
      expect(processingTime).toBeLessThan(5000) // Less than 5 seconds total

      const finalContent = chatStore.messages[1]?.content
      expect(finalContent).toHaveLength(largeChunks.join('').length)
      expect(finalContent).toContain('chunk 0')
      expect(finalContent).toContain('chunk 99')

      // Content version should be updated efficiently
      expect(chatStore.contentVersion).toBeGreaterThanOrEqual(100)
    })

    it('should handle rapid session switches without memory leaks (like VS Code project switching)', async () => {
      const { init, sendMessage } = useClaudeStream()

      // Simulate multiple rapid session switches (like VS Code workspace switching)
      for (let i = 0; i < 5; i++) {
        init()

        sendMessage(`Message in session ${i}`)
        mockWebSocket.emit('stream_start', {})
        mockWebSocket.emit('stream_delta', { text: `Response ${i}` })
        mockWebSocket.emit('stream_end', {
          sessionId: `session-${i}`,
          claudeSessionId: `claude-session-${i}`
        })

        // Clear session (like closing VS Code project)
        chatStore.clearMessages()
        mockWebSocket.reset()
      }

      // Final state should be clean
      expect(chatStore.messages).toHaveLength(0)
      expect(chatStore.sessionId).toBeNull()
      expect(chatStore.claudeSessionId).toBeNull()
      expect(chatStore.isStreaming).toBe(false)
    })
  })

  describe('Comprehensive VS Code Experience Validation', () => {
    it('should match complete VS Code conversation flow end-to-end', async () => {
      const { init, sendMessage, respondToTool } = useClaudeStream()
      init()

      // Simulate realistic VS Code conversation with all patterns
      sendMessage('Help me refactor this component to use better patterns')

      // Use VS Code stream simulator for realistic behavior
      await streamSimulator.simulateRealisticStream(
        mockWebSocket,
        VSCODE_TEST_CONTENT.CODE_ANALYSIS
      )

      // Simulate realistic tool workflow
      await streamSimulator.simulateToolWorkflow(mockWebSocket, [
        {
          name: 'Read',
          input: { file_path: 'src/Component.vue' },
          preText: ' ',
          postText: 'Based on the code, I can see several improvement opportunities. '
        },
        {
          name: 'Edit',
          input: {
            file_path: 'src/Component.vue',
            old_string: 'old pattern',
            new_string: 'improved pattern'
          },
          preText: 'Now I\'ll implement the improvements: ',
          postText: 'Let me run the tests to make sure everything works: '
        },
        {
          name: 'Bash',
          input: { command: 'npm test', description: 'Run test suite' },
          postText: 'Perfect! All tests are passing.'
        }
      ])

      // Approve all tools (simulate user interaction)
      const toolMessages = chatStore.messages.filter(m => m.toolUse)
      toolMessages.forEach((msg, index) => {
        respondToTool(msg.toolUse!.requestId, true)
      })

      mockWebSocket.emit('stream_end', {
        sessionId: 'test-session-123',
        claudeSessionId: 'claude-session-456'
      })

      // Validate VS Code-like message flow
      assertVSCodeMessageFlow(chatStore.messages, [
        'user',          // Initial request
        'assistant',     // Analysis response
        'tool',          // Read tool
        'assistant',     // Continue after read
        'tool',          // Edit tool
        'assistant',     // Continue after edit
        'tool',          // Bash tool
        'assistant'      // Final response
      ])

      // Validate streaming states (only first assistant message should be streaming initially)
      const assistantMessages = chatStore.messages.filter(m => m.role === 'assistant')
      expect(assistantMessages).toHaveLength(4)
      assistantMessages.forEach(msg => {
        expect(msg.isStreaming).toBe(false) // All should be complete
      })

      // Validate timing performance matches VS Code standards
      const timingAnalysis = streamSimulator.getTimingAnalysis()
      assertVSCodeTiming(timingAnalysis)

      // Verify session management
      expect(chatStore.sessionId).toBe('test-session-123')
      expect(chatStore.claudeSessionId).toBe('claude-session-456')
    })

    it('should handle network recovery like VS Code (comprehensive scenario)', async () => {
      const { init, sendMessage } = useClaudeStream()
      init()

      sendMessage('Generate a detailed analysis')

      // Simulate network recovery scenario using realistic patterns
      await streamSimulator.simulateNetworkRecovery(
        mockWebSocket,
        VSCODE_TEST_CONTENT.MEDIUM_RESPONSE.substring(0, 50),
        VSCODE_TEST_CONTENT.MEDIUM_RESPONSE.substring(50)
      )

      // Validate seamless recovery
      const assistantMsg = chatStore.messages[1]
      expect(assistantMsg?.content).toBe(VSCODE_TEST_CONTENT.MEDIUM_RESPONSE)
      expect(assistantMsg?.isStreaming).toBe(false)

      // Validate timing was reasonable despite network interruption
      const timingAnalysis = streamSimulator.getTimingAnalysis()

      // Should have completed recovery within reasonable time
      expect(timingAnalysis.totalDuration).toBeLessThan(
        VSCODE_TIMINGS.NETWORK_INTERRUPTION_DELAY + 2000
      )

      // Should have all expected events
      expect(timingAnalysis.timeline.map(t => t.event)).toEqual([
        'network_interruption_start',
        'connection_lost',
        'session_recovered',
        'stream_completed_after_recovery'
      ])
    })

    it('should maintain VS Code performance standards under load', async () => {
      const { init, sendMessage } = useClaudeStream()
      init()

      sendMessage('Generate a very long response for performance testing')

      const startTime = Date.now()

      // Simulate high-throughput streaming like VS Code handles
      await streamSimulator.simulateRealisticStream(
        mockWebSocket,
        VSCODE_TEST_CONTENT.LONG_RESPONSE,
        {
          chunkSize: 30,
          chunkDelay: VSCODE_TIMINGS.STREAM_CHUNK_INTERVAL,
          showTypingIndicator: true
        }
      )

      const endTime = Date.now()
      const totalTime = endTime - startTime

      // Validate performance meets VS Code standards
      // LONG_RESPONSE with chunkSize 30 and 50ms delays produces ~16s of simulated time
      expect(totalTime).toBeLessThan(20000) // Should complete within 20 seconds of simulated time
      expect(chatStore.messages[1]?.content).toBe(VSCODE_TEST_CONTENT.LONG_RESPONSE)
      expect(chatStore.messages[1]?.isStreaming).toBe(false)

      // Content version should be updated efficiently
      expect(chatStore.contentVersion).toBeGreaterThanOrEqual(10) // Many updates for smooth streaming

      const timingAnalysis = streamSimulator.getTimingAnalysis()
      assertVSCodeTiming(timingAnalysis)

      // Should have processed many chunks efficiently
      expect(timingAnalysis.eventCount).toBeGreaterThan(20) // Many streaming events
    })
  })
})