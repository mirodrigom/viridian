import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { ref } from 'vue'
import { useClaudeStream } from './useClaudeStream'
import { useChatStore } from '@/stores/chat'
import { useSettingsStore } from '@/stores/settings'
import { useAuthStore } from '@/stores/auth'
import { useProviderStore } from '@/stores/provider'
import { useSessionRegistry } from './useSessionRegistry'
import { setupTestPinia, createMockMessage, nextTick } from '@/test/utils'

// Mock vue-router (needed because apiFetch imports router which calls createRouter)
vi.mock('vue-router', () => ({
  createRouter: vi.fn(() => ({
    currentRoute: { value: { params: {} } },
    replace: vi.fn(),
    push: vi.fn(),
    install: vi.fn(),
    beforeEach: vi.fn(),
    afterEach: vi.fn(),
    onError: vi.fn(),
    isReady: vi.fn(() => Promise.resolve()),
  })),
  createWebHistory: vi.fn(),
  useRouter: () => ({
    currentRoute: { value: { params: {} } },
    replace: vi.fn(),
    push: vi.fn(),
  }),
  useRoute: () => ({ params: {} }),
}))

// Mock the stores
vi.mock('@/stores/settings', () => ({
  useSettingsStore: vi.fn(),
}))

vi.mock('@/stores/auth', () => ({
  useAuthStore: vi.fn(),
}))

vi.mock('@/stores/provider', () => ({
  useProviderStore: vi.fn(),
}))

// Mock vue-sonner
vi.mock('vue-sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

// Mock useWebSocket
const mockWebSocket = {
  connected: ref(false),
  connect: vi.fn(),
  send: vi.fn().mockReturnValue(true),
  on: vi.fn(),
  disconnect: vi.fn(),
}

vi.mock('./useWebSocket', () => ({
  useWebSocket: vi.fn(() => mockWebSocket),
}))

// Mock fetch
const mockFetch = vi.fn()
global.fetch = mockFetch

describe('Multi-Chat: Concurrent Sessions', () => {
  let chatStore: ReturnType<typeof useChatStore>
  let settingsStore: any
  let providerStoreInstance: any

  function getHandler(name: string): Function {
    return vi.mocked(mockWebSocket.on).mock.calls
      .find(call => call[0] === name)?.[1] as Function
  }

  beforeEach(() => {
    setupTestPinia()
    vi.clearAllMocks()
    vi.useFakeTimers()

    chatStore = useChatStore()

    // Clear singleton registry between tests
    const registry = useSessionRegistry()
    for (const id of [...registry.sessions.keys()]) {
      registry.removeSession(id)
    }

    settingsStore = {
      model: 'claude-sonnet-4-20250514',
      permissionMode: 'bypassPermissions',
      allowedTools: [],
      disallowedTools: [],
      maxOutputTokens: 4096,
      thinkingMode: 'default',
      saveSessionPreferences: vi.fn(),
    }

    providerStoreInstance = {
      activeProviderId: 'claude',
      activeProvider: { id: 'claude', name: 'Claude', icon: 'claude' },
      providers: [{ id: 'claude', name: 'Claude', icon: 'claude' }],
    }

    ;(useSettingsStore as any).mockReturnValue(settingsStore)
    ;(useAuthStore as any).mockReturnValue({ token: 'mock-token' })
    ;(useProviderStore as any).mockReturnValue(providerStoreInstance)

    mockWebSocket.connected.value = false
    mockWebSocket.connect.mockClear()
    mockWebSocket.send.mockClear().mockReturnValue(true)
    mockWebSocket.on.mockClear()
    mockWebSocket.disconnect.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('Session Registry: save and restore', () => {
    it('should save current session state to registry', () => {
      const registry = useSessionRegistry()

      // Set up a session with messages
      chatStore.sessionId = 'session-A'
      chatStore.claudeSessionId = 'session-A'
      chatStore.activeProjectDir = 'test-project'
      chatStore.addMessage(createMockMessage({ role: 'user', content: 'Hello from A' }))
      chatStore.addMessage(createMockMessage({ role: 'assistant', content: 'Response in A' }))
      chatStore.updateUsage({ inputTokens: 500, outputTokens: 200, totalCost: 0.05 })

      // Save to registry
      chatStore.saveToRegistry()

      // Verify saved state
      const saved = registry.sessions.get('session-A')
      expect(saved).toBeTruthy()
      expect(saved!.messages).toHaveLength(2)
      expect(saved!.messages[0]?.content).toBe('Hello from A')
      expect(saved!.messages[1]?.content).toBe('Response in A')
      expect(saved!.usage.inputTokens).toBe(500)
      expect(saved!.usage.outputTokens).toBe(200)
      expect(saved!.sessionId).toBe('session-A')
    })

    it('should restore session state from registry', () => {
      const registry = useSessionRegistry()

      // Manually populate registry with session B
      const sessionB = registry.getOrCreateSession('session-B')
      sessionB.sessionId = 'session-B'
      sessionB.claudeSessionId = 'session-B'
      sessionB.activeProjectDir = 'test-project'
      sessionB.messages = [
        createMockMessage({ role: 'user', content: 'Hello from B' }),
        createMockMessage({ role: 'assistant', content: 'Response in B' }),
      ]
      sessionB.usage = { inputTokens: 300, outputTokens: 100, totalCost: 0.02 }

      // Restore from registry
      const restored = chatStore.restoreFromRegistry('session-B')

      expect(restored).toBe(true)
      expect(chatStore.messages).toHaveLength(2)
      expect(chatStore.messages[0]?.content).toBe('Hello from B')
      expect(chatStore.messages[1]?.content).toBe('Response in B')
      expect(chatStore.sessionId).toBe('session-B')
      expect(chatStore.usage.inputTokens).toBe(300)
    })

    it('should return false when restoring non-existent session', () => {
      const restored = chatStore.restoreFromRegistry('non-existent')
      expect(restored).toBe(false)
    })
  })

  describe('switchSession: full flow', () => {
    it('should save current state and restore target from registry', () => {
      const registry = useSessionRegistry()

      // Set up session A
      chatStore.sessionId = 'session-A'
      chatStore.claudeSessionId = 'session-A'
      chatStore.addMessage(createMockMessage({ role: 'user', content: 'Message in A' }))
      chatStore.addMessage(createMockMessage({ role: 'assistant', content: 'Reply in A' }))

      // Pre-populate session B in registry
      const sessionB = registry.getOrCreateSession('session-B')
      sessionB.sessionId = 'session-B'
      sessionB.claudeSessionId = 'session-B'
      sessionB.messages = [
        createMockMessage({ role: 'user', content: 'Message in B' }),
        createMockMessage({ role: 'assistant', content: 'Reply in B' }),
      ]

      // Switch from A to B
      const result = chatStore.switchSession('session-B')

      expect(result).toBe(true)
      // Store should now show session B's state
      expect(chatStore.messages).toHaveLength(2)
      expect(chatStore.messages[0]?.content).toBe('Message in B')
      expect(chatStore.messages[1]?.content).toBe('Reply in B')
      expect(chatStore.sessionId).toBe('session-B')

      // Session A should be saved in registry
      const savedA = registry.sessions.get('session-A')
      expect(savedA).toBeTruthy()
      expect(savedA!.messages).toHaveLength(2)
      expect(savedA!.messages[0]?.content).toBe('Message in A')
    })

    it('should return false when target session is not in registry (needs API load)', () => {
      chatStore.sessionId = 'session-A'
      chatStore.claudeSessionId = 'session-A'
      chatStore.addMessage(createMockMessage({ role: 'user', content: 'In A' }))

      const result = chatStore.switchSession('session-C')

      expect(result).toBe(false)
      // Session A should still be saved
      const registry = useSessionRegistry()
      expect(registry.sessions.has('session-A')).toBe(true)
    })

    it('should handle switching to same session (no-op)', () => {
      chatStore.sessionId = 'session-A'
      chatStore.claudeSessionId = 'session-A'
      chatStore.addMessage(createMockMessage({ role: 'user', content: 'In A' }))

      const result = chatStore.switchSession('session-A')
      expect(result).toBe(true)
      // Messages should be unchanged
      expect(chatStore.messages).toHaveLength(1)
    })
  })

  describe('Multi-chat streaming: Chat A streams while user is in Chat B', () => {
    it('should not send clear_session when switching with suppressClearSession', () => {
      const { init } = useClaudeStream()
      init()

      chatStore.sessionId = 'session-A'
      chatStore.claudeSessionId = 'session-A'

      // Simulate what SessionSidebar.startNewSession does:
      // saveToRegistry + suppressClearSession + clearMessages
      chatStore.saveToRegistry()
      chatStore.suppressClearSession = true
      chatStore.clearMessages()

      // Verify clear_session was NOT sent
      const clearCalls = mockWebSocket.send.mock.calls.filter(
        c => c[0]?.type === 'clear_session'
      )
      expect(clearCalls).toHaveLength(0)
    })

    it('should send clear_session when explicitly clearing without suppress', async () => {
      const { init } = useClaudeStream()
      init()

      chatStore.sessionId = 'session-A'
      chatStore.claudeSessionId = 'session-A'
      await vi.advanceTimersByTimeAsync(0) // let watcher settle

      mockWebSocket.send.mockClear()

      // Clear without suppress (e.g., user deletes a session)
      chatStore.clearMessages()
      await vi.advanceTimersByTimeAsync(0) // let watcher fire

      // Verify clear_session WAS sent
      const clearCalls = mockWebSocket.send.mock.calls.filter(
        c => c[0]?.type === 'clear_session'
      )
      expect(clearCalls).toHaveLength(1)
      expect(clearCalls[0][0].sessionId).toBe('session-A')
    })

    it('full scenario: Chat A streaming → switch to Chat B → switch back to Chat A', () => {
      const { init } = useClaudeStream()
      init()

      const registry = useSessionRegistry()

      // === Start Chat A ===
      const streamStartHandler = getHandler('stream_start')
      const streamDeltaHandler = getHandler('stream_delta')
      const streamEndHandler = getHandler('stream_end')

      streamStartHandler({ sessionId: 'session-A', provider: 'claude' })
      expect(chatStore.isStreaming).toBe(true)
      expect(chatStore.messages).toHaveLength(1) // assistant bubble

      streamDeltaHandler({ sessionId: 'session-A', text: 'Hello from Chat A, ' })
      streamDeltaHandler({ sessionId: 'session-A', text: 'I am responding...' })
      expect(chatStore.messages[0]?.content).toBe('Hello from Chat A, I am responding...')

      // === Switch to Chat B (while A is still streaming) ===
      chatStore.saveToRegistry()
      chatStore.suppressClearSession = true
      chatStore.clearMessages()

      // Verify A was saved with streaming state
      const savedA = registry.sessions.get('session-A')
      expect(savedA).toBeTruthy()
      expect(savedA!.isStreaming).toBe(true)
      expect(savedA!.messages).toHaveLength(1)
      expect(savedA!.messages[0]?.content).toBe('Hello from Chat A, I am responding...')

      // Store is now empty (ready for Chat B)
      expect(chatStore.messages).toHaveLength(0)
      expect(chatStore.sessionId).toBeNull()

      // === Chat A finishes in background (server persists, events dropped on client) ===
      // stream_end for session-A arrives but activeSessionId is null — it gets dropped
      // This is fine because the server persists the complete response to disk

      // === Start Chat B ===
      chatStore.sessionId = null // new session
      streamStartHandler({ sessionId: 'session-B', provider: 'claude' })
      streamDeltaHandler({ sessionId: 'session-B', text: 'Hello from Chat B!' })

      expect(chatStore.messages).toHaveLength(1)
      expect(chatStore.messages[0]?.content).toBe('Hello from Chat B!')
      expect(chatStore.isStreaming).toBe(true)

      // === Chat B finishes ===
      chatStore.projectPath = '/test/project'
      streamEndHandler({
        sessionId: 'session-B',
        claudeSessionId: 'session-B',
        usage: { input_tokens: 200, output_tokens: 100 },
        totalCost: 0.02,
      })
      expect(chatStore.isStreaming).toBe(false)
      expect(chatStore.sessionId).toBe('session-B')

      // === Switch back to Chat A ===
      // Save current B state first
      chatStore.saveToRegistry()
      // Restore A from registry
      const restoredA = chatStore.restoreFromRegistry('session-A')
      expect(restoredA).toBe(true)

      // Chat A's state is restored (as it was when we left — streaming)
      // In practice, the sidebar would then call check_session or load from API
      // to get the completed response
      expect(chatStore.messages).toHaveLength(1)
      expect(chatStore.messages[0]?.content).toBe('Hello from Chat A, I am responding...')

      // Session B should be saved in registry
      const savedB = registry.sessions.get('session-B')
      expect(savedB).toBeTruthy()
      expect(savedB!.messages[0]?.content).toBe('Hello from Chat B!')

      // === Verify Chat B is still intact when we switch back ===
      chatStore.saveToRegistry()
      chatStore.restoreFromRegistry('session-B')
      expect(chatStore.messages).toHaveLength(1)
      expect(chatStore.messages[0]?.content).toBe('Hello from Chat B!')
      expect(chatStore.isStreaming).toBe(false)
    })

    it('stream_end for background session should not affect active session', () => {
      const { init } = useClaudeStream()
      init()

      // Start streaming in session A
      const streamStartHandler = getHandler('stream_start')
      const streamDeltaHandler = getHandler('stream_delta')
      const streamEndHandler = getHandler('stream_end')

      streamStartHandler({ sessionId: 'session-A', provider: 'claude' })
      streamDeltaHandler({ sessionId: 'session-A', text: 'Response A' })

      // Save and switch away
      chatStore.saveToRegistry()
      chatStore.suppressClearSession = true
      chatStore.clearMessages()

      // Start session B
      streamStartHandler({ sessionId: 'session-B', provider: 'claude' })
      streamDeltaHandler({ sessionId: 'session-B', text: 'Response B' })

      // Session A finishes in background — stream_end arrives with session-A's ID
      streamEndHandler({
        sessionId: 'session-A',
        claudeSessionId: 'session-A-claude',
        usage: { input_tokens: 100, output_tokens: 50 },
      })

      // Active session (B) should NOT be affected
      expect(chatStore.isStreaming).toBe(true) // Still streaming B
      expect(chatStore.messages).toHaveLength(1)
      expect(chatStore.messages[0]?.content).toBe('Response B')
      // session-A's data should NOT overwrite session-B's IDs
      expect(chatStore.sessionId).toBe('session-B')
    })

    it('switching preserves pagination state', () => {
      const registry = useSessionRegistry()

      // Set up session A with pagination
      chatStore.sessionId = 'session-A'
      chatStore.claudeSessionId = 'session-A'
      chatStore.totalMessages = 100
      chatStore.hasMoreMessages = true
      chatStore.oldestLoadedIndex = 50

      chatStore.saveToRegistry()

      // Verify pagination was saved
      const savedA = registry.sessions.get('session-A')
      expect(savedA!.totalMessages).toBe(100)
      expect(savedA!.hasMoreMessages).toBe(true)
      expect(savedA!.oldestLoadedIndex).toBe(50)

      // Clear and restore
      chatStore.clearMessages()
      chatStore.restoreFromRegistry('session-A')

      expect(chatStore.totalMessages).toBe(100)
      expect(chatStore.hasMoreMessages).toBe(true)
      expect(chatStore.oldestLoadedIndex).toBe(50)
    })

    it('switching preserves UI state (plan mode, auto-scroll)', () => {
      const registry = useSessionRegistry()

      chatStore.sessionId = 'session-A'
      chatStore.claudeSessionId = 'session-A'
      chatStore.inPlanMode = true
      chatStore.autoScroll = false

      chatStore.saveToRegistry()

      const savedA = registry.sessions.get('session-A')
      expect(savedA!.inPlanMode).toBe(true)
      expect(savedA!.autoScroll).toBe(false)

      chatStore.clearMessages()
      chatStore.restoreFromRegistry('session-A')

      expect(chatStore.inPlanMode).toBe(true)
      expect(chatStore.autoScroll).toBe(false)
    })
  })

  describe('Edge cases', () => {
    it('should handle save with no active session gracefully', () => {
      chatStore.sessionId = null
      chatStore.claudeSessionId = null

      // Should not throw
      expect(() => chatStore.saveToRegistry()).not.toThrow()

      const registry = useSessionRegistry()
      expect(registry.sessions.size).toBe(0)
    })

    it('should handle rapid switching between sessions', () => {
      const registry = useSessionRegistry()

      // Create 3 sessions in registry
      for (const id of ['A', 'B', 'C']) {
        const s = registry.getOrCreateSession(`session-${id}`)
        s.sessionId = `session-${id}`
        s.claudeSessionId = `session-${id}`
        s.messages = [createMockMessage({ content: `Message from ${id}` })]
      }

      // Set current session to A (with extra message)
      chatStore.sessionId = 'session-A'
      chatStore.claudeSessionId = 'session-A'
      chatStore.addMessage(createMockMessage({ content: 'Current A message' }))

      // Rapid switch: A → B → C → B
      chatStore.switchSession('session-B')
      expect(chatStore.messages[0]?.content).toBe('Message from B')

      chatStore.switchSession('session-C')
      expect(chatStore.messages[0]?.content).toBe('Message from C')

      chatStore.switchSession('session-B')
      expect(chatStore.messages[0]?.content).toBe('Message from B')
    })

    it('suppressClearSession auto-resets after watcher fires', async () => {
      const { init } = useClaudeStream()
      init()

      chatStore.sessionId = 'session-A'
      await vi.advanceTimersByTimeAsync(0)

      chatStore.suppressClearSession = true
      mockWebSocket.send.mockClear()

      // Trigger the watcher by changing sessionId
      chatStore.sessionId = null
      await vi.advanceTimersByTimeAsync(0)

      // suppressClearSession should be auto-reset
      expect(chatStore.suppressClearSession).toBe(false)

      // clear_session should NOT have been sent (was suppressed)
      const clearCalls = mockWebSocket.send.mock.calls.filter(
        c => c[0]?.type === 'clear_session'
      )
      expect(clearCalls).toHaveLength(0)
    })
  })
})
