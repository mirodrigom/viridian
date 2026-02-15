import { describe, it, expect, vi, beforeEach } from 'vitest'
import { cn, uuid } from './utils'

describe('cn', () => {
  it('merges simple class names', () => {
    expect(cn('foo', 'bar')).toBe('foo bar')
  })

  it('handles conditional classes', () => {
    expect(cn('base', false && 'hidden', 'visible')).toBe('base visible')
  })

  it('handles undefined and null', () => {
    expect(cn('base', undefined, null, 'end')).toBe('base end')
  })

  it('deduplicates conflicting Tailwind classes', () => {
    expect(cn('p-4', 'p-2')).toBe('p-2')
  })

  it('merges Tailwind text color classes', () => {
    expect(cn('text-red-500', 'text-blue-500')).toBe('text-blue-500')
  })

  it('keeps non-conflicting Tailwind classes', () => {
    expect(cn('p-4', 'mt-2', 'text-sm')).toBe('p-4 mt-2 text-sm')
  })

  it('handles array input', () => {
    expect(cn(['foo', 'bar'])).toBe('foo bar')
  })

  it('handles object input', () => {
    expect(cn({ foo: true, bar: false, baz: true })).toBe('foo baz')
  })

  it('returns empty string for no input', () => {
    expect(cn()).toBe('')
  })

  it('handles complex Tailwind merging', () => {
    const result = cn(
      'rounded-md bg-primary text-white',
      'bg-secondary hover:bg-accent'
    )
    expect(result).toContain('rounded-md')
    expect(result).toContain('text-white')
    expect(result).toContain('bg-secondary')
    expect(result).not.toContain('bg-primary')
  })
})

describe('uuid', () => {
  it('generates a string', () => {
    const id = uuid()
    expect(typeof id).toBe('string')
  })

  it('generates valid UUID format', () => {
    const id = uuid()
    // UUID v4 format: 8-4-4-4-12 hex characters
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('generates unique values', () => {
    const ids = new Set(Array.from({ length: 100 }, () => uuid()))
    expect(ids.size).toBe(100)
  })

  it('uses crypto.randomUUID when available', () => {
    const mockUUID = '12345678-1234-4123-8123-123456789abc'
    const originalRandomUUID = crypto.randomUUID
    crypto.randomUUID = vi.fn(() => mockUUID)

    expect(uuid()).toBe(mockUUID)
    expect(crypto.randomUUID).toHaveBeenCalled()

    crypto.randomUUID = originalRandomUUID
  })
})
