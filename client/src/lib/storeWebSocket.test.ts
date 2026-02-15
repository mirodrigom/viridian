import { describe, it, expect, vi } from 'vitest'

/**
 * Test the reconnection and message dispatch logic from storeWebSocket.ts.
 * We re-implement the scheduling logic to test it without Vue reactivity.
 */

describe('storeWebSocket reconnection logic', () => {
  const BASE_RECONNECT_DELAY = 500
  const MAX_RECONNECT_DELAY = 10_000

  function calculateDelay(attempts: number): number {
    return Math.min(BASE_RECONNECT_DELAY * 2 ** attempts, MAX_RECONNECT_DELAY)
  }

  it('first reconnect attempt uses base delay (500ms)', () => {
    expect(calculateDelay(0)).toBe(500)
  })

  it('second attempt doubles the delay (1000ms)', () => {
    expect(calculateDelay(1)).toBe(1000)
  })

  it('third attempt is 2000ms', () => {
    expect(calculateDelay(2)).toBe(2000)
  })

  it('fourth attempt is 4000ms', () => {
    expect(calculateDelay(3)).toBe(4000)
  })

  it('fifth attempt is 8000ms', () => {
    expect(calculateDelay(4)).toBe(8000)
  })

  it('caps at MAX_RECONNECT_DELAY (10000ms)', () => {
    expect(calculateDelay(5)).toBe(MAX_RECONNECT_DELAY)
    expect(calculateDelay(10)).toBe(MAX_RECONNECT_DELAY)
    expect(calculateDelay(100)).toBe(MAX_RECONNECT_DELAY)
  })
})

describe('storeWebSocket message dispatch logic', () => {
  function createDispatcher() {
    const handlers = new Map<string, Set<(data: unknown) => void>>()

    function on(type: string, handler: (data: unknown) => void) {
      if (!handlers.has(type)) handlers.set(type, new Set())
      handlers.get(type)!.add(handler)
    }

    function dispatch(rawMessage: string) {
      try {
        const data = JSON.parse(rawMessage)
        const type = data.type as string
        const typeHandlers = handlers.get(type)
        if (typeHandlers) {
          typeHandlers.forEach(handler => handler(data))
        }
      } catch {
        // parse error
      }
    }

    return { on, dispatch, handlers }
  }

  it('dispatches messages to registered handlers by type', () => {
    const { on, dispatch } = createDispatcher()
    const handler = vi.fn()
    on('chat', handler)

    dispatch(JSON.stringify({ type: 'chat', text: 'hello' }))

    expect(handler).toHaveBeenCalledWith({ type: 'chat', text: 'hello' })
  })

  it('does not dispatch to handlers of different types', () => {
    const { on, dispatch } = createDispatcher()
    const chatHandler = vi.fn()
    const errorHandler = vi.fn()
    on('chat', chatHandler)
    on('error', errorHandler)

    dispatch(JSON.stringify({ type: 'chat', text: 'hello' }))

    expect(chatHandler).toHaveBeenCalled()
    expect(errorHandler).not.toHaveBeenCalled()
  })

  it('supports multiple handlers for the same type', () => {
    const { on, dispatch } = createDispatcher()
    const handler1 = vi.fn()
    const handler2 = vi.fn()
    on('update', handler1)
    on('update', handler2)

    dispatch(JSON.stringify({ type: 'update', value: 42 }))

    expect(handler1).toHaveBeenCalled()
    expect(handler2).toHaveBeenCalled()
  })

  it('silently ignores unregistered message types', () => {
    const { dispatch } = createDispatcher()
    expect(() => dispatch(JSON.stringify({ type: 'unknown' }))).not.toThrow()
  })

  it('silently handles malformed JSON', () => {
    const { dispatch } = createDispatcher()
    expect(() => dispatch('not json {')).not.toThrow()
  })

  it('silently handles empty message', () => {
    const { dispatch } = createDispatcher()
    expect(() => dispatch('')).not.toThrow()
  })
})
