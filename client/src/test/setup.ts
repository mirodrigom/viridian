import { vi } from 'vitest'

// Mock sessionStorage
const sessionStorageMock = (() => {
  let store: Record<string, string> = {}

  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value
    },
    removeItem: (key: string) => {
      delete store[key]
    },
    clear: () => {
      store = {}
    },
    length: Object.keys(store).length,
    key: (index: number) => Object.keys(store)[index] || null,
  }
})()

Object.defineProperty(window, 'sessionStorage', {
  value: sessionStorageMock,
})

// Mock WebSocket
class MockWebSocket {
  readyState = 1 // OPEN
  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null

  send = vi.fn()
  close = vi.fn()

  constructor(url: string) {
    // Simulate connection opening after a small delay
    setTimeout(() => {
      this.onopen?.(new Event('open'))
    }, 0)
  }
}

Object.defineProperty(window, 'WebSocket', {
  value: MockWebSocket,
})

// Mock fetch
global.fetch = vi.fn()

// Mock router
vi.mock('vue-router', () => ({
  useRouter: () => ({
    currentRoute: {
      value: { params: {} }
    },
    replace: vi.fn(),
  }),
  useRoute: () => ({
    params: {},
  }),
}))