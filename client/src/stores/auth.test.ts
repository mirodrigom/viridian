import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setupTestPinia } from '@/test/utils'
import { useAuthStore } from './auth'

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

describe('useAuthStore', () => {
  beforeEach(() => {
    localStorageMock.clear()
    setupTestPinia()
    vi.restoreAllMocks()
  })

  describe('initial state', () => {
    it('is not authenticated when localStorage is empty', () => {
      const store = useAuthStore()
      expect(store.isAuthenticated).toBe(false)
      expect(store.token).toBeNull()
      expect(store.username).toBeNull()
    })

    it('loads token from localStorage on creation', () => {
      localStorageMock.setItem('token', 'saved-token')
      localStorageMock.setItem('username', 'saved-user')
      setupTestPinia() // Re-create pinia

      const store = useAuthStore()
      expect(store.token).toBe('saved-token')
      expect(store.username).toBe('saved-user')
      expect(store.isAuthenticated).toBe(true)
    })
  })

  describe('login()', () => {
    it('stores token and username on successful login', async () => {
      const mockResponse = { token: 'jwt-token-123', username: 'testuser' }
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      } as Response)

      const store = useAuthStore()
      await store.login('testuser', 'password123')

      expect(store.token).toBe('jwt-token-123')
      expect(store.username).toBe('testuser')
      expect(store.isAuthenticated).toBe(true)
      expect(localStorageMock.getItem('token')).toBe('jwt-token-123')
      expect(localStorageMock.getItem('username')).toBe('testuser')
    })

    it('sends correct request', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ token: 't', username: 'u' }),
      } as Response)

      const store = useAuthStore()
      await store.login('myuser', 'mypass')

      expect(global.fetch).toHaveBeenCalledWith('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'myuser', password: 'mypass' }),
      })
    })

    it('throws on failed login with server error message', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ error: 'Invalid credentials' }),
      } as Response)

      const store = useAuthStore()
      await expect(store.login('bad', 'bad')).rejects.toThrow('Invalid credentials')
      expect(store.isAuthenticated).toBe(false)
    })

    it('throws generic message when no error field', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({}),
      } as Response)

      const store = useAuthStore()
      await expect(store.login('bad', 'bad')).rejects.toThrow('Login failed')
    })
  })

  describe('register()', () => {
    it('stores token and username on successful registration', async () => {
      const mockResponse = { token: 'new-token', username: 'newuser' }
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      } as Response)

      const store = useAuthStore()
      await store.register('newuser', 'newpass')

      expect(store.token).toBe('new-token')
      expect(store.username).toBe('newuser')
      expect(store.isAuthenticated).toBe(true)
      expect(localStorageMock.getItem('token')).toBe('new-token')
    })

    it('sends correct request', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ token: 't', username: 'u' }),
      } as Response)

      const store = useAuthStore()
      await store.register('newuser', 'newpass')

      expect(global.fetch).toHaveBeenCalledWith('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'newuser', password: 'newpass' }),
      })
    })

    it('throws on failed registration', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ error: 'Username already exists' }),
      } as Response)

      const store = useAuthStore()
      await expect(store.register('existing', 'pass')).rejects.toThrow('Username already exists')
    })
  })

  describe('logout()', () => {
    it('clears token and username', async () => {
      // First login
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ token: 'token', username: 'user' }),
      } as Response)

      const store = useAuthStore()
      await store.login('user', 'pass')
      expect(store.isAuthenticated).toBe(true)

      // Then logout
      store.logout()
      expect(store.token).toBeNull()
      expect(store.username).toBeNull()
      expect(store.isAuthenticated).toBe(false)
      expect(localStorageMock.getItem('token')).toBeNull()
      expect(localStorageMock.getItem('username')).toBeNull()
    })
  })

  describe('checkStatus()', () => {
    it('returns hasUsers status', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ hasUsers: true }),
      } as Response)

      const store = useAuthStore()
      const result = await store.checkStatus()
      expect(result).toEqual({ hasUsers: true })
      expect(global.fetch).toHaveBeenCalledWith('/api/auth/status')
    })

    it('throws on failed status check', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: false,
      } as Response)

      const store = useAuthStore()
      await expect(store.checkStatus()).rejects.toThrow('Failed to check auth status')
    })
  })
})
