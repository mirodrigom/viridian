import { describe, it, expect, vi } from 'vitest'
import { safeJsonParse } from './safeJson.js'

// Mock the logger module
vi.mock('../logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

describe('safeJsonParse', () => {
  it('parses valid JSON string', () => {
    expect(safeJsonParse('{"a":1}', {})).toEqual({ a: 1 })
  })

  it('parses valid JSON array', () => {
    expect(safeJsonParse('[1,2,3]', [])).toEqual([1, 2, 3])
  })

  it('parses valid JSON string value', () => {
    expect(safeJsonParse('"hello"', '')).toBe('hello')
  })

  it('parses valid JSON number', () => {
    expect(safeJsonParse('42', 0)).toBe(42)
  })

  it('parses valid JSON boolean', () => {
    expect(safeJsonParse('true', false)).toBe(true)
  })

  it('parses valid JSON null', () => {
    expect(safeJsonParse('null', 'fallback')).toBeNull()
  })

  it('returns fallback for malformed JSON', () => {
    expect(safeJsonParse('{invalid', [])).toEqual([])
  })

  it('returns fallback for empty string', () => {
    expect(safeJsonParse('', [])).toEqual([])
  })

  it('returns fallback for null input', () => {
    expect(safeJsonParse(null, { default: true })).toEqual({ default: true })
  })

  it('returns fallback for undefined input', () => {
    expect(safeJsonParse(undefined, 'default')).toBe('default')
  })

  it('returns fallback for non-string input (number)', () => {
    expect(safeJsonParse(123, [])).toEqual([])
  })

  it('returns fallback for non-string input (object)', () => {
    expect(safeJsonParse({} as unknown, [])).toEqual([])
  })

  it('returns fallback for non-string input (boolean)', () => {
    expect(safeJsonParse(true as unknown, 'fallback')).toBe('fallback')
  })

  it('preserves type of fallback value', () => {
    const fallback: string[] = ['a', 'b']
    const result = safeJsonParse('not-json', fallback)
    expect(result).toBe(fallback) // Same reference
  })

  it('handles deeply nested valid JSON', () => {
    const input = JSON.stringify({ a: { b: { c: [1, 2, { d: true }] } } })
    expect(safeJsonParse(input, {})).toEqual({ a: { b: { c: [1, 2, { d: true }] } } })
  })

  it('returns fallback for long invalid input', () => {
    const longString = 'x'.repeat(200)
    expect(safeJsonParse(longString, null)).toBeNull()
  })
})
