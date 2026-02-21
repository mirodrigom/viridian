import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setupTestPinia } from '@/test/utils'
import { useProviderStore } from './provider'
import type { ProviderInfo } from '@/types/provider'

// Mock auth store
vi.mock('./auth', () => ({
  useAuthStore: vi.fn(() => ({
    token: 'mock-token',
  })),
}))

// Mock vue-sonner
const mockToast = vi.hoisted(() => ({
  info: vi.fn(),
  error: vi.fn(),
}))
vi.mock('vue-sonner', () => ({
  toast: mockToast,
}))

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

// Mock fetch
const mockFetch = vi.fn()
global.fetch = mockFetch

const MOCK_CLAUDE: ProviderInfo = {
  id: 'claude',
  name: 'Claude',
  icon: 'ClaudeLogo',
  description: 'Anthropic Claude Code',
  website: 'https://claude.ai',
  models: [
    { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', description: 'Fast', isDefault: true },
    { id: 'claude-opus-4-6', label: 'Claude Opus 4.6', description: 'Powerful' },
  ],
  capabilities: {
    supportsThinking: true,
    supportsToolUse: true,
    supportsPermissionModes: true,
    supportsImages: true,
    supportsResume: true,
    supportsStreaming: true,
    supportsControlRequests: true,
    supportsSubagents: true,
    supportsPlanMode: true,
    supportedPermissionModes: ['bypassPermissions', 'acceptEdits', 'plan', 'default'],
    customFeatures: [],
  },
  available: true,
}

const MOCK_GEMINI: ProviderInfo = {
  id: 'gemini',
  name: 'Gemini',
  icon: 'GeminiLogo',
  description: 'Google Gemini CLI',
  website: 'https://gemini.google.com',
  models: [
    { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', description: 'Default', isDefault: true },
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', description: 'Fast' },
  ],
  capabilities: {
    supportsThinking: false,
    supportsToolUse: true,
    supportsPermissionModes: false,
    supportsImages: false,
    supportsResume: false,
    supportsStreaming: true,
    supportsControlRequests: false,
    supportsSubagents: false,
    supportsPlanMode: false,
    supportedPermissionModes: ['bypassPermissions'],
    customFeatures: [],
  },
  available: true,
}

describe('useProviderStore', () => {
  beforeEach(() => {
    localStorageMock.clear()
    mockFetch.mockReset()
    mockToast.info.mockClear()
    mockToast.error.mockClear()
    setupTestPinia()
  })

  describe('defaults', () => {
    it('has Claude as the default provider', () => {
      const store = useProviderStore()
      expect(store.defaultProvider).toBe('claude')
      expect(store.activeProviderId).toBe('claude')
    })

    it('has fallback Claude provider in providers list', () => {
      const store = useProviderStore()
      expect(store.providers).toHaveLength(1)
      expect(store.providers[0]!.id).toBe('claude')
    })

    it('has no session provider override', () => {
      const store = useProviderStore()
      expect(store.sessionProvider).toBeNull()
    })

    it('loads default provider from localStorage', () => {
      localStorageMock.setItem('defaultProvider', 'gemini')
      setupTestPinia() // Re-create pinia after setting localStorage
      const store = useProviderStore()
      expect(store.defaultProvider).toBe('gemini')
    })
  })

  describe('activeProviderId', () => {
    it('returns defaultProvider when no session override', () => {
      const store = useProviderStore()
      expect(store.activeProviderId).toBe('claude')
    })

    it('returns sessionProvider when set', () => {
      const store = useProviderStore()
      store.setSessionProvider('gemini')
      expect(store.activeProviderId).toBe('gemini')
    })

    it('returns defaultProvider after clearing session override', () => {
      const store = useProviderStore()
      store.setSessionProvider('gemini')
      store.clearSessionProvider()
      expect(store.activeProviderId).toBe('claude')
    })
  })

  describe('activeProvider', () => {
    it('returns the matching provider object', () => {
      const store = useProviderStore()
      expect(store.activeProvider.id).toBe('claude')
      expect(store.activeProvider.name).toBe('Claude')
    })

    it('falls back to FALLBACK_CLAUDE for unknown provider', () => {
      localStorageMock.setItem('defaultProvider', 'nonexistent')
      setupTestPinia()
      const store = useProviderStore()
      // Falls back through the chain to FALLBACK_CLAUDE
      expect(store.activeProvider.id).toBe('claude')
    })
  })

  describe('activeModels', () => {
    it('returns models for the active provider', () => {
      const store = useProviderStore()
      expect(store.activeModels.length).toBeGreaterThan(0)
      expect(store.activeModels[0]!.id).toContain('claude')
    })
  })

  describe('defaultModel', () => {
    it('returns the model marked as default', () => {
      const store = useProviderStore()
      expect(store.defaultModel).toBe('claude-sonnet-4-6')
    })
  })

  describe('availableProviders', () => {
    it('filters to only available providers', () => {
      const store = useProviderStore()
      const unavailable: ProviderInfo = { ...MOCK_GEMINI, available: false }
      store.providers = [MOCK_CLAUDE, unavailable]

      expect(store.availableProviders).toHaveLength(1)
      expect(store.availableProviders[0]!.id).toBe('claude')
    })
  })

  describe('fetchProviders', () => {
    it('fetches and stores providers from API', async () => {
      const store = useProviderStore()
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([MOCK_CLAUDE, MOCK_GEMINI]),
      })

      await store.fetchProviders()

      expect(store.providers).toHaveLength(2)
      expect(store.providers[0]!.id).toBe('claude')
      expect(store.providers[1]!.id).toBe('gemini')
      expect(store.loaded).toBe(true)
    })

    it('keeps fallback when API returns empty array', async () => {
      const store = useProviderStore()
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      })

      await store.fetchProviders()

      // Empty response doesn't replace providers
      expect(store.providers).toHaveLength(1)
      expect(store.providers[0]!.id).toBe('claude')
    })

    it('handles API errors gracefully', async () => {
      const store = useProviderStore()
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      await store.fetchProviders()

      // Should keep fallback
      expect(store.providers).toHaveLength(1)
      expect(store.loaded).toBe(false)
    })

    it('resets default provider when stored one is no longer available', async () => {
      localStorageMock.setItem('defaultProvider', 'codex')
      setupTestPinia()
      const store = useProviderStore()

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([MOCK_CLAUDE, MOCK_GEMINI]),
      })

      await store.fetchProviders()

      // 'codex' not in the returned list, should fall back
      expect(store.defaultProvider).toBe('claude')
      expect(localStorageMock.getItem('defaultProvider')).toBe('claude')
    })
  })

  describe('setDefaultProvider', () => {
    it('updates default and persists to localStorage', () => {
      const store = useProviderStore()
      store.providers = [MOCK_CLAUDE, MOCK_GEMINI]

      store.setDefaultProvider('gemini')

      expect(store.defaultProvider).toBe('gemini')
      expect(localStorageMock.getItem('defaultProvider')).toBe('gemini')
    })

    it('does nothing when setting same provider', () => {
      const store = useProviderStore()

      store.setDefaultProvider('claude')

      expect(mockToast.info).not.toHaveBeenCalled()
    })

    it('does nothing for unknown provider', () => {
      const store = useProviderStore()

      store.setDefaultProvider('nonexistent' as any)

      expect(store.defaultProvider).toBe('claude')
    })
  })

  describe('isValidModel', () => {
    it('returns true for valid model of active provider', () => {
      const store = useProviderStore()
      expect(store.isValidModel('claude-sonnet-4-6')).toBe(true)
    })

    it('returns false for invalid model', () => {
      const store = useProviderStore()
      expect(store.isValidModel('nonexistent-model')).toBe(false)
    })

    it('validates against specific provider when provided', () => {
      const store = useProviderStore()
      store.providers = [MOCK_CLAUDE, MOCK_GEMINI]

      expect(store.isValidModel('gemini-2.5-pro', 'gemini')).toBe(true)
      expect(store.isValidModel('claude-sonnet-4-6', 'gemini')).toBe(false)
    })
  })
})
