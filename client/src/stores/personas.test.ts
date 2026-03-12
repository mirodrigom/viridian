import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setupTestPinia } from '@/test/utils'
import { usePersonasStore, type Persona } from './personas'

// Mock apiFetch
vi.mock('@/lib/apiFetch', () => ({
  apiFetch: vi.fn(),
}))

import { apiFetch } from '@/lib/apiFetch'

const mockApiFetch = apiFetch as ReturnType<typeof vi.fn>

function createMockPersona(overrides: Partial<Persona> = {}): Persona {
  return {
    id: `persona-${Date.now()}-${Math.random()}`,
    name: 'Test Persona',
    description: 'A test persona',
    icon: '🤖',
    color: '#3b82f6',
    systemPrompt: 'You are a helpful assistant.',
    suggestedTools: [],
    isBuiltin: false,
    createdAt: '2026-03-11T00:00:00Z',
    ...overrides,
  }
}

const builtinPersonas: Persona[] = [
  createMockPersona({ id: 'code-reviewer', name: 'Code Reviewer', isBuiltin: true, systemPrompt: 'You are a code reviewer.' }),
  createMockPersona({ id: 'writer', name: 'Technical Writer', isBuiltin: true, systemPrompt: 'You are a technical writer.' }),
  createMockPersona({ id: 'debugger', name: 'Debugger', isBuiltin: true, systemPrompt: 'You are a debugging expert.' }),
]

describe('usePersonasStore', () => {
  beforeEach(() => {
    setupTestPinia()
    vi.clearAllMocks()
  })

  describe('initial state', () => {
    it('should have empty personas and no active persona', () => {
      const store = usePersonasStore()

      expect(store.personas).toHaveLength(0)
      expect(store.activePersonaId).toBeNull()
      expect(store.activePersona).toBeNull()
      expect(store.loading).toBe(false)
      expect(store.builtinPersonas).toHaveLength(0)
      expect(store.customPersonas).toHaveLength(0)
    })
  })

  describe('fetchPersonas()', () => {
    it('should load personas from API', async () => {
      const allPersonas = [...builtinPersonas, createMockPersona({ id: 'custom-1', name: 'Custom', isBuiltin: false })]
      mockApiFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ personas: allPersonas }),
      })

      const store = usePersonasStore()
      await store.fetchPersonas()

      expect(store.personas).toHaveLength(4)
      expect(store.builtinPersonas).toHaveLength(3)
      expect(store.customPersonas).toHaveLength(1)
      expect(store.loading).toBe(false)
    })

    it('should set loading state during fetch', async () => {
      let resolvePromise: (value: unknown) => void
      mockApiFetch.mockReturnValueOnce(
        new Promise(resolve => { resolvePromise = resolve }),
      )

      const store = usePersonasStore()
      const fetchPromise = store.fetchPersonas()

      expect(store.loading).toBe(true)

      resolvePromise!({
        ok: true,
        json: () => Promise.resolve({ personas: [] }),
      })
      await fetchPromise

      expect(store.loading).toBe(false)
    })

    it('should handle API failure gracefully', async () => {
      mockApiFetch.mockResolvedValueOnce({ ok: false })

      const store = usePersonasStore()
      await store.fetchPersonas()

      // Should not throw, just log warning
      expect(store.personas).toHaveLength(0)
      expect(store.loading).toBe(false)
    })

    it('should handle network errors gracefully', async () => {
      mockApiFetch.mockRejectedValueOnce(new Error('Network error'))

      const store = usePersonasStore()
      await store.fetchPersonas()

      expect(store.personas).toHaveLength(0)
      expect(store.loading).toBe(false)
    })
  })

  describe('built-in personas', () => {
    it('should correctly separate built-in and custom personas', () => {
      const store = usePersonasStore()
      store.personas = [
        ...builtinPersonas,
        createMockPersona({ id: 'custom-1', isBuiltin: false }),
        createMockPersona({ id: 'custom-2', isBuiltin: false }),
      ]

      expect(store.builtinPersonas).toHaveLength(3)
      expect(store.customPersonas).toHaveLength(2)
    })

    it('should include expected built-in persona names', () => {
      const store = usePersonasStore()
      store.personas = [...builtinPersonas]

      const names = store.builtinPersonas.map(p => p.name)
      expect(names).toContain('Code Reviewer')
      expect(names).toContain('Technical Writer')
      expect(names).toContain('Debugger')
    })
  })

  describe('selectPersona() / setActivePersona()', () => {
    it('should set the active persona', () => {
      const store = usePersonasStore()
      store.personas = [...builtinPersonas]

      store.setActivePersona('code-reviewer')

      expect(store.activePersonaId).toBe('code-reviewer')
      expect(store.activePersona).not.toBeNull()
      expect(store.activePersona!.name).toBe('Code Reviewer')
    })

    it('should return null for activePersona if id does not match', () => {
      const store = usePersonasStore()
      store.personas = [...builtinPersonas]

      store.setActivePersona('non-existent')

      expect(store.activePersonaId).toBe('non-existent')
      expect(store.activePersona).toBeNull()
    })
  })

  describe('clearActivePersona()', () => {
    it('should reset active persona to null', () => {
      const store = usePersonasStore()
      store.personas = [...builtinPersonas]
      store.setActivePersona('code-reviewer')

      expect(store.activePersona).not.toBeNull()

      store.clearActivePersona()

      expect(store.activePersonaId).toBeNull()
      expect(store.activePersona).toBeNull()
    })
  })

  describe('createPersona()', () => {
    it('should add a new custom persona', async () => {
      const newPersona = createMockPersona({ id: 'new-1', name: 'My Persona', isBuiltin: false })
      mockApiFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ persona: newPersona }),
      })

      const store = usePersonasStore()
      const result = await store.createPersona({
        name: 'My Persona',
        description: 'A custom persona',
        icon: '🎨',
        color: '#ff0000',
        systemPrompt: 'You are creative.',
        suggestedTools: [],
      })

      expect(result).not.toBeNull()
      expect(result!.id).toBe('new-1')
      expect(store.personas).toHaveLength(1)
      expect(store.customPersonas).toHaveLength(1)
    })

    it('should return null on API failure', async () => {
      mockApiFetch.mockResolvedValueOnce({ ok: false })

      const store = usePersonasStore()
      const result = await store.createPersona({
        name: 'Fail',
        description: '',
        icon: '',
        color: '',
        systemPrompt: '',
        suggestedTools: [],
      })

      expect(result).toBeNull()
      expect(store.personas).toHaveLength(0)
    })

    it('should return null on network error', async () => {
      mockApiFetch.mockRejectedValueOnce(new Error('Network error'))

      const store = usePersonasStore()
      const result = await store.createPersona({
        name: 'Fail',
        description: '',
        icon: '',
        color: '',
        systemPrompt: '',
        suggestedTools: [],
      })

      expect(result).toBeNull()
    })
  })

  describe('updatePersona()', () => {
    it('should modify an existing persona', async () => {
      const store = usePersonasStore()
      store.personas = [createMockPersona({ id: 'p-1', name: 'Original' })]

      const updated = createMockPersona({ id: 'p-1', name: 'Updated' })
      mockApiFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ persona: updated }),
      })

      const result = await store.updatePersona('p-1', { name: 'Updated' })

      expect(result).not.toBeNull()
      expect(result!.name).toBe('Updated')
      expect(store.personas[0].name).toBe('Updated')
    })

    it('should return null on API failure', async () => {
      mockApiFetch.mockResolvedValueOnce({ ok: false })

      const store = usePersonasStore()
      store.personas = [createMockPersona({ id: 'p-1' })]

      const result = await store.updatePersona('p-1', { name: 'x' })
      expect(result).toBeNull()
    })

    it('should return null on network error', async () => {
      mockApiFetch.mockRejectedValueOnce(new Error('Network error'))

      const store = usePersonasStore()
      const result = await store.updatePersona('p-1', { name: 'x' })
      expect(result).toBeNull()
    })
  })

  describe('deletePersona()', () => {
    it('should remove a custom persona', async () => {
      const store = usePersonasStore()
      store.personas = [
        createMockPersona({ id: 'custom-1', isBuiltin: false }),
        createMockPersona({ id: 'custom-2', isBuiltin: false }),
      ]

      mockApiFetch.mockResolvedValueOnce({ ok: true })

      const result = await store.deletePersona('custom-1')

      expect(result).toBe(true)
      expect(store.personas).toHaveLength(1)
      expect(store.personas[0].id).toBe('custom-2')
    })

    it('should clear active persona if the deleted persona was active', async () => {
      const store = usePersonasStore()
      store.personas = [createMockPersona({ id: 'custom-1', isBuiltin: false })]
      store.setActivePersona('custom-1')

      mockApiFetch.mockResolvedValueOnce({ ok: true })

      await store.deletePersona('custom-1')

      expect(store.activePersonaId).toBeNull()
      expect(store.activePersona).toBeNull()
    })

    it('should not clear active persona if a different persona was deleted', async () => {
      const store = usePersonasStore()
      store.personas = [
        createMockPersona({ id: 'custom-1', isBuiltin: false }),
        createMockPersona({ id: 'custom-2', isBuiltin: false }),
      ]
      store.setActivePersona('custom-1')

      mockApiFetch.mockResolvedValueOnce({ ok: true })

      await store.deletePersona('custom-2')

      expect(store.activePersonaId).toBe('custom-1')
    })

    it('should return false on API failure', async () => {
      mockApiFetch.mockResolvedValueOnce({ ok: false })

      const store = usePersonasStore()
      store.personas = [createMockPersona({ id: 'p-1' })]

      const result = await store.deletePersona('p-1')

      expect(result).toBe(false)
      expect(store.personas).toHaveLength(1)
    })

    it('should return false on network error', async () => {
      mockApiFetch.mockRejectedValueOnce(new Error('Network error'))

      const store = usePersonasStore()
      store.personas = [createMockPersona({ id: 'p-1' })]

      const result = await store.deletePersona('p-1')
      expect(result).toBe(false)
      expect(store.personas).toHaveLength(1)
    })
  })

  describe('getPersonaById (via activePersona)', () => {
    it('should find a persona by setting active and reading computed', () => {
      const store = usePersonasStore()
      store.personas = [
        ...builtinPersonas,
        createMockPersona({ id: 'custom-1', name: 'My Custom' }),
      ]

      store.setActivePersona('custom-1')
      expect(store.activePersona!.name).toBe('My Custom')

      store.setActivePersona('writer')
      expect(store.activePersona!.name).toBe('Technical Writer')
    })

    it('should return null for non-existent persona', () => {
      const store = usePersonasStore()
      store.personas = [...builtinPersonas]

      store.setActivePersona('does-not-exist')
      expect(store.activePersona).toBeNull()
    })
  })

  describe('active persona system prompt', () => {
    it('should expose the system prompt of the active persona', () => {
      const store = usePersonasStore()
      store.personas = [...builtinPersonas]

      store.setActivePersona('code-reviewer')
      expect(store.activePersona!.systemPrompt).toBe('You are a code reviewer.')

      store.setActivePersona('debugger')
      expect(store.activePersona!.systemPrompt).toBe('You are a debugging expert.')
    })

    it('should return null when no persona is active', () => {
      const store = usePersonasStore()
      store.personas = [...builtinPersonas]

      expect(store.activePersona).toBeNull()
    })
  })
})
