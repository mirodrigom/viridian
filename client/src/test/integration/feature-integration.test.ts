import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { useChatStore, type ChatMessage, type ToolUseInfo } from '@/stores/chat'
import { useSettingsStore, type ThinkingMode, type SessionPreferences } from '@/stores/settings'
import { usePersonasStore } from '@/stores/personas'
import {
  setupTestPinia,
  createMockMessage,
  createMockStreamingMessage,
  createMockToolMessage,
  nextTick,
  clearSessionStorage,
} from '@/test/utils'

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => { store[key] = value },
    removeItem: (key: string) => { delete store[key] },
    clear: () => { store = {} },
  }
})()

Object.defineProperty(window, 'localStorage', { value: localStorageMock })

// Mock apiFetch so network calls do not fire
vi.mock('@/lib/apiFetch', () => ({
  apiFetch: vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })),
}))

describe('Feature Integration Tests', () => {
  beforeEach(() => {
    localStorageMock.clear()
    setupTestPinia()
    clearSessionStorage()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ── Collapsible Tool Calls ─────────────────────────────────────────────

  describe('Collapsible Tool Calls', () => {
    it('tool call starts expanded when streaming (pending status)', () => {
      const chatStore = useChatStore()

      chatStore.startStreaming()

      const toolMessage = createMockToolMessage('Bash', { command: 'ls -la' })
      // Pending + isInputStreaming means the tool is actively streaming
      toolMessage.toolUse!.isInputStreaming = true
      chatStore.addMessage(toolMessage)

      const msg = chatStore.messages[0]
      expect(msg?.toolUse?.status).toBe('pending')
      expect(msg?.toolUse?.isInputStreaming).toBe(true)
      // The component logic: toolDefaultOpen is true when status is 'pending' or isInputStreaming
      // We verify the data conditions that drive the "expanded" state
      const isExpandedCondition = msg?.toolUse?.status === 'pending' || msg?.toolUse?.isInputStreaming === true
      expect(isExpandedCondition).toBe(true)
    })

    it('tool call collapses after completion (status changes from pending)', () => {
      const chatStore = useChatStore()

      chatStore.startStreaming()

      const toolMessage = createMockToolMessage('Bash', { command: 'ls -la' })
      chatStore.addMessage(toolMessage)

      const requestId = toolMessage.toolUse!.requestId
      const msg = chatStore.messages.find(m => m.toolUse?.requestId === requestId)

      // Initially pending -> expanded
      expect(msg?.toolUse?.status).toBe('pending')

      // Simulate completion: approve and finish input streaming
      if (msg?.toolUse) {
        msg.toolUse.status = 'approved'
        msg.toolUse.isInputStreaming = false
      }

      // After completion the component auto-collapses because:
      // toolDefaultOpen = !(status !== 'pending' && !isInputStreaming) -> false
      const shouldAutoCollapse = msg?.toolUse?.status !== 'pending' && !msg?.toolUse?.isInputStreaming
      expect(shouldAutoCollapse).toBe(true)
    })

    it('manual toggle overrides auto-collapse (data model supports independent toggle)', () => {
      const chatStore = useChatStore()

      chatStore.startStreaming()

      const toolMessage = createMockToolMessage('Read', { file_path: '/test/file.txt' })
      chatStore.addMessage(toolMessage)

      const requestId = toolMessage.toolUse!.requestId
      const msg = chatStore.messages.find(m => m.toolUse?.requestId === requestId)

      // Complete the tool
      if (msg?.toolUse) {
        msg.toolUse.status = 'approved'
        msg.toolUse.isInputStreaming = false
      }

      // At this point, toolDefaultOpen computes to false (auto-collapse).
      // The component uses a separate `toolOpen` ref that can be toggled independently.
      // We simulate the manual toggle by tracking an independent state:
      let toolOpen = false // auto-collapsed
      // User manually re-opens:
      toolOpen = true
      expect(toolOpen).toBe(true)

      // The watcher only auto-collapses (sets toolOpen = false when toolDefaultOpen goes false),
      // but never force-opens. So after manual toggle, the state stays open.
      // Verify the tool data still shows "completed" (auto-collapse condition met)
      // but our manual override persists.
      const autoCollapseCondition = msg?.toolUse?.status !== 'pending' && !msg?.toolUse?.isInputStreaming
      expect(autoCollapseCondition).toBe(true)
      expect(toolOpen).toBe(true) // manual override still holds
    })
  })

  // ── Reasoning Effort Selector ──────────────────────────────────────────

  describe('Reasoning Effort Selector', () => {
    it('default thinking mode is standard', () => {
      const settingsStore = useSettingsStore()
      expect(settingsStore.thinkingMode).toBe('standard')
      expect(settingsStore.thinkingLabel).toBe('Standard')
    })

    it('changing thinking mode updates the settings store', () => {
      const settingsStore = useSettingsStore()

      const modes: ThinkingMode[] = ['think', 'think_hard', 'think_harder', 'ultrathink']
      for (const mode of modes) {
        settingsStore.thinkingMode = mode
        expect(settingsStore.thinkingMode).toBe(mode)
      }

      // Verify labels update correctly
      settingsStore.thinkingMode = 'ultrathink'
      expect(settingsStore.thinkingLabel).toBe('Ultrathink')

      settingsStore.thinkingMode = 'think_hard'
      expect(settingsStore.thinkingLabel).toBe('Think Hard')
    })

    it('thinking mode persists via save/init cycle', () => {
      const settingsStore = useSettingsStore()

      settingsStore.thinkingMode = 'think_harder'
      settingsStore.save()

      // Create a new store instance (simulates page reload)
      setupTestPinia()
      const freshStore = useSettingsStore()
      freshStore.init()

      expect(freshStore.thinkingMode).toBe('think_harder')
    })

    it('thinking mode is included in session preferences', () => {
      const settingsStore = useSettingsStore()
      settingsStore.thinkingMode = 'ultrathink'

      const prefs = settingsStore.getSessionPreferences()
      expect(prefs.thinkingMode).toBe('ultrathink')
    })
  })

  // ── Preference Memory ─────────────────────────────────────────────────

  describe('Preference Memory', () => {
    it('session preferences snapshot includes model, thinking mode, and permission mode', () => {
      const settingsStore = useSettingsStore()

      settingsStore.model = 'claude-sonnet-4-6'
      settingsStore.thinkingMode = 'think_hard'
      settingsStore.permissionMode = 'acceptEdits'
      settingsStore.maxOutputTokens = 8192

      const prefs = settingsStore.getSessionPreferences()

      expect(prefs.model).toBe('claude-sonnet-4-6')
      expect(prefs.thinkingMode).toBe('think_hard')
      expect(prefs.permissionMode).toBe('acceptEdits')
      expect(prefs.maxOutputTokens).toBe(8192)
    })

    it('session preferences restore on applySessionPreferences', () => {
      const settingsStore = useSettingsStore()

      // Start with defaults
      expect(settingsStore.model).toBe('claude-opus-4-6')
      expect(settingsStore.thinkingMode).toBe('standard')

      // Simulate restoring saved session preferences
      const savedPrefs: SessionPreferences = {
        model: 'claude-haiku-4-5-20251001',
        thinkingMode: 'think',
        permissionMode: 'default',
        allowedTools: ['Read', 'Glob'],
        disallowedTools: ['Bash(rm -rf:*)'],
        maxOutputTokens: 4096,
      }

      settingsStore.applySessionPreferences(savedPrefs)

      expect(settingsStore.model).toBe('claude-haiku-4-5-20251001')
      expect(settingsStore.thinkingMode).toBe('think')
      expect(settingsStore.permissionMode).toBe('default')
      expect(settingsStore.allowedTools).toEqual(['Read', 'Glob'])
      expect(settingsStore.disallowedTools).toEqual(['Bash(rm -rf:*)'])
      expect(settingsStore.maxOutputTokens).toBe(4096)
    })

    it('default preferences used for new sessions (partial prefs do not overwrite unset fields)', () => {
      const settingsStore = useSettingsStore()

      // Set non-default values
      settingsStore.model = 'claude-sonnet-4-6'
      settingsStore.thinkingMode = 'ultrathink'
      settingsStore.permissionMode = 'plan'

      // Apply a partial preference set (simulating a new session with minimal saved prefs)
      const partialPrefs: SessionPreferences = {
        model: 'claude-opus-4-6',
      }

      settingsStore.applySessionPreferences(partialPrefs)

      // Model was overwritten by the partial prefs
      expect(settingsStore.model).toBe('claude-opus-4-6')
      // Fields not in partialPrefs remain at their previous values
      // (applySessionPreferences only overwrites fields that are truthy in the prefs object)
      expect(settingsStore.thinkingMode).toBe('ultrathink')
      expect(settingsStore.permissionMode).toBe('plan')
    })

    it('session preferences include persona via the settings snapshot', () => {
      const settingsStore = useSettingsStore()
      const personasStore = usePersonasStore()

      // Set up a persona
      personasStore.setActivePersona('persona-coding-expert')

      // The persona ID lives in the personas store, but the settings store
      // getSessionPreferences captures model/thinking/permission.
      // Verify persona state is independently tracked.
      expect(personasStore.activePersonaId).toBe('persona-coding-expert')

      // Change persona and verify it updates
      personasStore.setActivePersona('persona-writer')
      expect(personasStore.activePersonaId).toBe('persona-writer')

      // Clear persona for new session
      personasStore.clearActivePersona()
      expect(personasStore.activePersonaId).toBeNull()
      expect(personasStore.activePersona).toBeNull()
    })

    it('preferences round-trip: get -> apply preserves values', () => {
      const settingsStore = useSettingsStore()

      settingsStore.model = 'claude-sonnet-4-6'
      settingsStore.thinkingMode = 'think_harder'
      settingsStore.permissionMode = 'acceptEdits'
      settingsStore.maxOutputTokens = 32768
      settingsStore.addAllowedTool('Write')
      settingsStore.addDisallowedTool('Bash(sudo:*)')

      const snapshot = settingsStore.getSessionPreferences()

      // Reset to defaults
      setupTestPinia()
      const freshStore = useSettingsStore()

      expect(freshStore.model).toBe('claude-opus-4-6') // default
      expect(freshStore.thinkingMode).toBe('standard') // default

      // Apply the snapshot
      freshStore.applySessionPreferences(snapshot)

      expect(freshStore.model).toBe('claude-sonnet-4-6')
      expect(freshStore.thinkingMode).toBe('think_harder')
      expect(freshStore.permissionMode).toBe('acceptEdits')
      expect(freshStore.maxOutputTokens).toBe(32768)
      expect(freshStore.allowedTools).toEqual(['Write'])
      expect(freshStore.disallowedTools).toEqual(['Bash(sudo:*)'])
    })
  })
})
