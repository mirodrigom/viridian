import { describe, it, expect, beforeEach } from 'vitest'
import type { IProvider, ProviderInfo, ProviderModel, ProviderCapabilities, ProviderQueryOptions } from './types.js'
import type { SDKMessage } from '../services/claude-sdk.js'

/**
 * We test the registry logic by re-implementing it (same pattern as claude.test.ts)
 * to avoid side-effects from the real providers auto-registering on import.
 */

// ─── Isolated registry re-implementation ─────────────────────────────────

type ProviderId = 'claude' | 'gemini' | 'codex' | 'aider' | 'cline'

function createRegistry() {
  const providers = new Map<ProviderId, IProvider>()

  return {
    registerProvider(provider: IProvider) {
      providers.set(provider.info.id, provider)
    },

    getProvider(id: ProviderId): IProvider {
      const provider = providers.get(id)
      if (!provider) {
        throw new Error(`Provider "${id}" is not registered. Available: [${[...providers.keys()].join(', ')}]`)
      }
      return provider
    },

    getAllProviders(): IProvider[] {
      return [...providers.values()]
    },

    getAvailableProviders(): IProvider[] {
      return [...providers.values()].filter(p => {
        try {
          return p.isAvailable()
        } catch {
          return false
        }
      })
    },

    getDefaultProvider(): IProvider {
      const claude = providers.get('claude')
      if (claude && claude.isAvailable()) return claude

      const available = [...providers.values()].filter(p => {
        try { return p.isAvailable() } catch { return false }
      })
      if (available.length > 0) return available[0]!

      if (claude) return claude
      throw new Error('No providers registered.')
    },

    getProviderDTOs() {
      return [...providers.values()].map(p => ({
        id: p.info.id,
        name: p.info.name,
        icon: p.info.icon,
        description: p.info.description,
        website: p.info.website,
        models: p.models,
        capabilities: p.capabilities,
        available: (() => { try { return p.isAvailable() } catch { return false } })(),
      }))
    },
  }
}

// ─── Mock Provider Factory ───────────────────────────────────────────────

function createMockProvider(overrides: {
  id?: ProviderId
  name?: string
  available?: boolean
} = {}): IProvider {
  const id = overrides.id || 'claude'
  const name = overrides.name || 'Mock Provider'
  const available = overrides.available !== false

  return {
    info: {
      id,
      name,
      icon: `${name}Logo`,
      description: `Mock ${name} provider`,
      website: `https://${id}.example.com`,
      binaryName: id,
    },
    models: [
      { id: `${id}-default`, label: `${name} Default`, description: 'Default model', isDefault: true },
      { id: `${id}-fast`, label: `${name} Fast`, description: 'Fast model' },
    ],
    capabilities: {
      supportsThinking: id === 'claude',
      supportsToolUse: true,
      supportsPermissionModes: id === 'claude',
      supportsImages: id === 'claude',
      supportsResume: id === 'claude',
      supportsStreaming: true,
      supportsControlRequests: id === 'claude',
      supportsSubagents: id === 'claude',
      supportsPlanMode: id === 'claude',
      supportedPermissionModes: id === 'claude' ? ['bypassPermissions', 'default'] : ['bypassPermissions'],
      customFeatures: [],
    },
    isAvailable() { return available },
    findBinary() {
      if (!available) throw new Error(`${name} binary not found`)
      return `/usr/bin/${id}`
    },
    async *query(_options: ProviderQueryOptions): AsyncGenerator<SDKMessage, void, undefined> {
      yield { type: 'text_delta', text: 'mock response' } as SDKMessage
      yield { type: 'result', sessionId: 'mock-session' } as SDKMessage
    },
    buildControlResponse(requestId: string, approved: boolean) {
      if (id !== 'claude') return null
      return JSON.stringify({ type: 'control_response', request_id: requestId, approved })
    },
    getSessionDir() { return null },
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────

describe('Provider Registry', () => {
  let registry: ReturnType<typeof createRegistry>

  beforeEach(() => {
    registry = createRegistry()
  })

  describe('registerProvider', () => {
    it('registers a provider by its id', () => {
      const provider = createMockProvider({ id: 'claude', name: 'Claude' })
      registry.registerProvider(provider)

      expect(registry.getAllProviders()).toHaveLength(1)
      expect(registry.getProvider('claude')).toBe(provider)
    })

    it('overwrites provider with same id', () => {
      const provider1 = createMockProvider({ id: 'claude', name: 'Claude v1' })
      const provider2 = createMockProvider({ id: 'claude', name: 'Claude v2' })

      registry.registerProvider(provider1)
      registry.registerProvider(provider2)

      expect(registry.getAllProviders()).toHaveLength(1)
      expect(registry.getProvider('claude').info.name).toBe('Claude v2')
    })

    it('registers multiple different providers', () => {
      registry.registerProvider(createMockProvider({ id: 'claude' }))
      registry.registerProvider(createMockProvider({ id: 'gemini' }))

      expect(registry.getAllProviders()).toHaveLength(2)
    })
  })

  describe('getProvider', () => {
    it('returns registered provider by id', () => {
      const provider = createMockProvider({ id: 'gemini', name: 'Gemini' })
      registry.registerProvider(provider)

      const result = registry.getProvider('gemini')
      expect(result.info.name).toBe('Gemini')
    })

    it('throws for unregistered provider', () => {
      expect(() => registry.getProvider('gemini')).toThrow('Provider "gemini" is not registered')
    })

    it('includes available providers in error message', () => {
      registry.registerProvider(createMockProvider({ id: 'claude' }))
      expect(() => registry.getProvider('gemini')).toThrow('Available: [claude]')
    })
  })

  describe('getAllProviders', () => {
    it('returns empty array when no providers registered', () => {
      expect(registry.getAllProviders()).toEqual([])
    })

    it('returns all registered providers regardless of availability', () => {
      registry.registerProvider(createMockProvider({ id: 'claude', available: true }))
      registry.registerProvider(createMockProvider({ id: 'gemini', available: false }))

      expect(registry.getAllProviders()).toHaveLength(2)
    })
  })

  describe('getAvailableProviders', () => {
    it('returns only available providers', () => {
      registry.registerProvider(createMockProvider({ id: 'claude', available: true }))
      registry.registerProvider(createMockProvider({ id: 'gemini', available: false }))

      const available = registry.getAvailableProviders()
      expect(available).toHaveLength(1)
      expect(available[0]!.info.id).toBe('claude')
    })

    it('handles providers that throw in isAvailable()', () => {
      const throwing: IProvider = {
        ...createMockProvider({ id: 'codex' }),
        isAvailable() { throw new Error('Binary check failed') },
      }
      registry.registerProvider(throwing)

      expect(registry.getAvailableProviders()).toEqual([])
    })

    it('returns empty array when no providers available', () => {
      registry.registerProvider(createMockProvider({ id: 'claude', available: false }))
      expect(registry.getAvailableProviders()).toEqual([])
    })
  })

  describe('getDefaultProvider', () => {
    it('prefers Claude when available', () => {
      registry.registerProvider(createMockProvider({ id: 'gemini', name: 'Gemini', available: true }))
      registry.registerProvider(createMockProvider({ id: 'claude', name: 'Claude', available: true }))

      const def = registry.getDefaultProvider()
      expect(def.info.id).toBe('claude')
    })

    it('falls back to first available when Claude is unavailable', () => {
      registry.registerProvider(createMockProvider({ id: 'claude', available: false }))
      registry.registerProvider(createMockProvider({ id: 'gemini', name: 'Gemini', available: true }))

      const def = registry.getDefaultProvider()
      expect(def.info.id).toBe('gemini')
    })

    it('returns unavailable Claude when nothing is available', () => {
      registry.registerProvider(createMockProvider({ id: 'claude', available: false }))
      registry.registerProvider(createMockProvider({ id: 'gemini', available: false }))

      const def = registry.getDefaultProvider()
      expect(def.info.id).toBe('claude')
    })

    it('throws when no providers registered at all', () => {
      expect(() => registry.getDefaultProvider()).toThrow('No providers registered')
    })
  })

  describe('getProviderDTOs', () => {
    it('serializes providers to DTO format', () => {
      registry.registerProvider(createMockProvider({ id: 'claude', name: 'Claude', available: true }))

      const dtos = registry.getProviderDTOs()
      expect(dtos).toHaveLength(1)
      expect(dtos[0]).toEqual({
        id: 'claude',
        name: 'Claude',
        icon: 'ClaudeLogo',
        description: 'Mock Claude provider',
        website: 'https://claude.example.com',
        models: expect.arrayContaining([
          expect.objectContaining({ id: 'claude-default', isDefault: true }),
        ]),
        capabilities: expect.objectContaining({
          supportsThinking: true,
          supportsToolUse: true,
        }),
        available: true,
      })
    })

    it('marks unavailable providers correctly', () => {
      registry.registerProvider(createMockProvider({ id: 'gemini', available: false }))

      const dtos = registry.getProviderDTOs()
      expect(dtos[0]!.available).toBe(false)
    })

    it('handles providers that throw in isAvailable()', () => {
      const throwing: IProvider = {
        ...createMockProvider({ id: 'codex' }),
        isAvailable() { throw new Error('fail') },
      }
      registry.registerProvider(throwing)

      const dtos = registry.getProviderDTOs()
      expect(dtos[0]!.available).toBe(false)
    })
  })
})

describe('Provider Capabilities', () => {
  it('Claude has all capabilities enabled', () => {
    const claude = createMockProvider({ id: 'claude' })
    expect(claude.capabilities.supportsThinking).toBe(true)
    expect(claude.capabilities.supportsControlRequests).toBe(true)
    expect(claude.capabilities.supportsResume).toBe(true)
    expect(claude.capabilities.supportsSubagents).toBe(true)
  })

  it('Non-Claude provider has limited capabilities', () => {
    const gemini = createMockProvider({ id: 'gemini' })
    expect(gemini.capabilities.supportsThinking).toBe(false)
    expect(gemini.capabilities.supportsControlRequests).toBe(false)
    expect(gemini.capabilities.supportsResume).toBe(false)
    expect(gemini.capabilities.supportsSubagents).toBe(false)
  })

  it('Non-Claude provider only supports bypassPermissions', () => {
    const gemini = createMockProvider({ id: 'gemini' })
    expect(gemini.capabilities.supportedPermissionModes).toEqual(['bypassPermissions'])
  })

  it('Claude buildControlResponse returns JSON string', () => {
    const claude = createMockProvider({ id: 'claude' })
    const response = claude.buildControlResponse('req-1', true)
    expect(response).toBeTruthy()
    const parsed = JSON.parse(response!)
    expect(parsed.type).toBe('control_response')
    expect(parsed.approved).toBe(true)
  })

  it('Non-Claude buildControlResponse returns null', () => {
    const gemini = createMockProvider({ id: 'gemini' })
    const response = gemini.buildControlResponse('req-1', true)
    expect(response).toBeNull()
  })
})

describe('Provider Query', () => {
  it('query yields SDKMessage events', async () => {
    const provider = createMockProvider({ id: 'claude' })
    const messages: SDKMessage[] = []

    for await (const msg of provider.query({ prompt: 'hello', cwd: '/tmp' })) {
      messages.push(msg)
    }

    expect(messages).toHaveLength(2)
    expect(messages[0]!.type).toBe('text_delta')
    expect(messages[1]!.type).toBe('result')
  })
})
