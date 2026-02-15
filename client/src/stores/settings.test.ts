import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setupTestPinia } from '@/test/utils'
import { useSettingsStore } from './settings'

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

describe('useSettingsStore', () => {
  beforeEach(() => {
    localStorageMock.clear()
    setupTestPinia()
  })

  describe('defaults', () => {
    it('has correct default values', () => {
      const store = useSettingsStore()
      expect(store.darkMode).toBe(true)
      expect(store.fontSize).toBe(13)
      expect(store.permissionMode).toBe('bypassPermissions')
      expect(store.model).toBe('claude-opus-4-6')
      expect(store.thinkingMode).toBe('standard')
      expect(store.maxTokens).toBe(200000)
      expect(store.maxOutputTokens).toBe(16384)
      expect(store.allowedTools).toEqual([])
      expect(store.disallowedTools).toEqual([])
      expect(store.projectsDir).toBe('')
      expect(store.editorWordWrap).toBe(false)
      expect(store.editorTabSize).toBe(2)
      expect(store.editorFontSize).toBe(13)
      expect(store.editorShowLineNumbers).toBe(true)
      expect(store.editorMinimap).toBe(true)
    })
  })

  describe('init()', () => {
    it('loads saved settings from localStorage', () => {
      localStorageMock.setItem('settings', JSON.stringify({
        darkMode: false,
        fontSize: 16,
        permissionMode: 'default',
        model: 'claude-sonnet-4-5-20250929',
        thinkingMode: 'think_hard',
        maxTokens: 100000,
        maxOutputTokens: 8192,
        projectsDir: '/home/user/projects',
        editorWordWrap: true,
        editorTabSize: 4,
      }))

      const store = useSettingsStore()
      store.init()

      expect(store.darkMode).toBe(false)
      expect(store.fontSize).toBe(16)
      expect(store.permissionMode).toBe('default')
      expect(store.model).toBe('claude-sonnet-4-5-20250929')
      expect(store.thinkingMode).toBe('think_hard')
      expect(store.maxTokens).toBe(100000)
      expect(store.maxOutputTokens).toBe(8192)
      expect(store.projectsDir).toBe('/home/user/projects')
      expect(store.editorWordWrap).toBe(true)
      expect(store.editorTabSize).toBe(4)
    })

    it('uses defaults for missing fields in saved data', () => {
      localStorageMock.setItem('settings', JSON.stringify({
        darkMode: false,
      }))

      const store = useSettingsStore()
      store.init()

      expect(store.darkMode).toBe(false)
      expect(store.fontSize).toBe(13) // default
      expect(store.model).toBe('claude-opus-4-6') // default
      expect(store.editorMinimap).toBe(true) // default
    })

    it('handles empty localStorage gracefully', () => {
      const store = useSettingsStore()
      store.init()
      // Should keep defaults
      expect(store.darkMode).toBe(true)
      expect(store.model).toBe('claude-opus-4-6')
    })
  })

  describe('save()', () => {
    it('persists all settings to localStorage', () => {
      const store = useSettingsStore()
      store.model = 'claude-haiku-4-5-20251001'
      store.fontSize = 18
      store.save()

      const saved = JSON.parse(localStorageMock.getItem('settings')!)
      expect(saved.model).toBe('claude-haiku-4-5-20251001')
      expect(saved.fontSize).toBe(18)
      expect(saved.darkMode).toBe(true)
    })
  })

  describe('toggleDarkMode()', () => {
    it('toggles dark mode and saves', () => {
      const store = useSettingsStore()
      expect(store.darkMode).toBe(true)

      store.toggleDarkMode()
      expect(store.darkMode).toBe(false)

      store.toggleDarkMode()
      expect(store.darkMode).toBe(true)
    })

    it('persists the toggled value', () => {
      const store = useSettingsStore()
      store.toggleDarkMode()

      const saved = JSON.parse(localStorageMock.getItem('settings')!)
      expect(saved.darkMode).toBe(false)
    })
  })

  describe('tool management', () => {
    it('addAllowedTool adds a tool', () => {
      const store = useSettingsStore()
      store.addAllowedTool('Write')
      expect(store.allowedTools).toContain('Write')
    })

    it('addAllowedTool does not add duplicates', () => {
      const store = useSettingsStore()
      store.addAllowedTool('Write')
      store.addAllowedTool('Write')
      expect(store.allowedTools.filter(t => t === 'Write')).toHaveLength(1)
    })

    it('removeAllowedTool removes a tool', () => {
      const store = useSettingsStore()
      store.addAllowedTool('Write')
      store.addAllowedTool('Read')
      store.removeAllowedTool('Write')
      expect(store.allowedTools).not.toContain('Write')
      expect(store.allowedTools).toContain('Read')
    })

    it('addDisallowedTool adds a tool', () => {
      const store = useSettingsStore()
      store.addDisallowedTool('Bash(rm -rf:*)')
      expect(store.disallowedTools).toContain('Bash(rm -rf:*)')
    })

    it('addDisallowedTool does not add duplicates', () => {
      const store = useSettingsStore()
      store.addDisallowedTool('Bash(rm -rf:*)')
      store.addDisallowedTool('Bash(rm -rf:*)')
      expect(store.disallowedTools.filter(t => t === 'Bash(rm -rf:*)')).toHaveLength(1)
    })

    it('removeDisallowedTool removes a tool', () => {
      const store = useSettingsStore()
      store.addDisallowedTool('Bash(rm -rf:*)')
      store.addDisallowedTool('Bash(sudo:*)')
      store.removeDisallowedTool('Bash(rm -rf:*)')
      expect(store.disallowedTools).not.toContain('Bash(rm -rf:*)')
      expect(store.disallowedTools).toContain('Bash(sudo:*)')
    })

    it('tool changes are persisted', () => {
      const store = useSettingsStore()
      store.addAllowedTool('Write')

      const saved = JSON.parse(localStorageMock.getItem('settings')!)
      expect(saved.allowedTools).toContain('Write')
    })
  })

  describe('computed labels', () => {
    it('modelLabel returns correct label', () => {
      const store = useSettingsStore()
      store.model = 'claude-opus-4-6'
      expect(store.modelLabel).toBe('Claude Opus 4.6')

      store.model = 'claude-sonnet-4-5-20250929'
      expect(store.modelLabel).toBe('Claude Sonnet 4.5')

      store.model = 'claude-haiku-4-5-20251001'
      expect(store.modelLabel).toBe('Claude Haiku 4.5')
    })

    it('modelLabel falls back to raw value for unknown model', () => {
      const store = useSettingsStore()
      store.model = 'unknown-model' as any
      expect(store.modelLabel).toBe('unknown-model')
    })

    it('permissionLabel returns correct label', () => {
      const store = useSettingsStore()
      store.permissionMode = 'bypassPermissions'
      expect(store.permissionLabel).toBe('Full Auto')

      store.permissionMode = 'default'
      expect(store.permissionLabel).toBe('Ask Every Time')
    })

    it('thinkingLabel returns correct label', () => {
      const store = useSettingsStore()
      store.thinkingMode = 'standard'
      expect(store.thinkingLabel).toBe('Standard')

      store.thinkingMode = 'ultrathink'
      expect(store.thinkingLabel).toBe('Ultrathink')
    })
  })
})
