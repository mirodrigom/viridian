import { describe, it, expect } from 'vitest'

/**
 * Test the pure helper functions from useClaudeStream:
 * - parseResetTime (date + time string)
 * - parseResetTimeOnly (time-only string)
 * - detectRateLimit pattern matching
 *
 * These are re-implemented since they're closured inside the composable.
 */

// ─── Re-implemented from useClaudeStream.ts ─────────────────────────────

function parseResetTime(timeStr: string): number | null {
  try {
    const cleaned = timeStr.replace(',', '').trim()
    const match = cleaned.match(/^(\w+)\s+(\d{1,2})\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i)
    if (!match) return null

    const [, monthStr, dayStr, hourStr, minStr, ampm] = match
    const months: Record<string, number> = {
      jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
      jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
    }
    const month = months[monthStr!.toLowerCase().slice(0, 3)]
    if (month === undefined) return null

    let hour = parseInt(hourStr!, 10)
    const minute = minStr ? parseInt(minStr, 10) : 0
    if (ampm!.toLowerCase() === 'pm' && hour !== 12) hour += 12
    if (ampm!.toLowerCase() === 'am' && hour === 12) hour = 0

    const now = new Date()
    const resetDate = new Date(now.getFullYear(), month, parseInt(dayStr!, 10), hour, minute, 0, 0)

    if (resetDate.getTime() < Date.now()) {
      resetDate.setFullYear(resetDate.getFullYear() + 1)
    }

    return resetDate.getTime()
  } catch {
    return null
  }
}

function parseResetTimeOnly(timeStr: string): number | null {
  try {
    const cleaned = timeStr.trim()
    const match = cleaned.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i)
    if (!match) return null

    let hour = parseInt(match[1]!, 10)
    const minute = match[2] ? parseInt(match[2], 10) : 0
    if (match[3]!.toLowerCase() === 'pm' && hour !== 12) hour += 12
    if (match[3]!.toLowerCase() === 'am' && hour === 12) hour = 0

    const now = new Date()
    const resetDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0, 0)

    if (resetDate.getTime() < Date.now()) {
      resetDate.setDate(resetDate.getDate() + 1)
    }

    return resetDate.getTime()
  } catch {
    return null
  }
}

function detectsRateLimit(text: string): boolean {
  const rateLimitWithDateMatch = text.match(/resets?\s+(\w+\s+\d{1,2},?\s+\d{1,2}(?::\d{2})?\s*(?:am|pm))/i)
  const rateLimitTimeOnlyMatch = !rateLimitWithDateMatch && text.match(/resets?\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm))/i)
  return !!(rateLimitWithDateMatch || rateLimitTimeOnlyMatch || /rate.?limit|hit.?(?:your|the)?.?limit|you.?ve hit|usage.?limit|quota|too many requests|429|overloaded/i.test(text))
}

// ─── Tests ──────────────────────────────────────────────────────────────

describe('parseResetTime', () => {
  it('parses "Feb 13, 12pm"', () => {
    const result = parseResetTime('Feb 13, 12pm')
    expect(result).not.toBeNull()
    const date = new Date(result!)
    expect(date.getMonth()).toBe(1) // February
    expect(date.getDate()).toBe(13)
    expect(date.getHours()).toBe(12)
  })

  it('parses "Mar 5 3:30pm"', () => {
    const result = parseResetTime('Mar 5 3:30pm')
    expect(result).not.toBeNull()
    const date = new Date(result!)
    expect(date.getMonth()).toBe(2) // March
    expect(date.getDate()).toBe(5)
    expect(date.getHours()).toBe(15)
    expect(date.getMinutes()).toBe(30)
  })

  it('handles 12am correctly (midnight)', () => {
    const result = parseResetTime('Jan 1 12am')
    expect(result).not.toBeNull()
    const date = new Date(result!)
    expect(date.getHours()).toBe(0)
  })

  it('handles 12pm correctly (noon)', () => {
    const result = parseResetTime('Jan 1 12pm')
    expect(result).not.toBeNull()
    const date = new Date(result!)
    expect(date.getHours()).toBe(12)
  })

  it('returns null for invalid month', () => {
    expect(parseResetTime('Xyz 1 12pm')).toBeNull()
  })

  it('returns null for completely invalid string', () => {
    expect(parseResetTime('not a date')).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(parseResetTime('')).toBeNull()
  })
})

describe('parseResetTimeOnly', () => {
  it('parses "10pm"', () => {
    const result = parseResetTimeOnly('10pm')
    expect(result).not.toBeNull()
    const date = new Date(result!)
    expect(date.getHours()).toBe(22)
    expect(date.getMinutes()).toBe(0)
  })

  it('parses "3:30am"', () => {
    const result = parseResetTimeOnly('3:30am')
    expect(result).not.toBeNull()
    const date = new Date(result!)
    expect(date.getHours()).toBe(3)
    expect(date.getMinutes()).toBe(30)
  })

  it('parses "12am" as midnight', () => {
    const result = parseResetTimeOnly('12am')
    expect(result).not.toBeNull()
    const date = new Date(result!)
    expect(date.getHours()).toBe(0)
  })

  it('parses "12pm" as noon', () => {
    const result = parseResetTimeOnly('12pm')
    expect(result).not.toBeNull()
    const date = new Date(result!)
    expect(date.getHours()).toBe(12)
  })

  it('returns future timestamp (today or tomorrow)', () => {
    const result = parseResetTimeOnly('11:59pm')
    expect(result).not.toBeNull()
    expect(result!).toBeGreaterThan(Date.now() - 24 * 60 * 60 * 1000)
  })

  it('returns null for invalid string', () => {
    expect(parseResetTimeOnly('not a time')).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(parseResetTimeOnly('')).toBeNull()
  })
})

describe('detectsRateLimit', () => {
  it('detects "rate limit" text', () => {
    expect(detectsRateLimit('You have hit the rate limit')).toBe(true)
  })

  it('detects "rate_limit"', () => {
    expect(detectsRateLimit('rate_limit exceeded')).toBe(true)
  })

  it('detects "you\'ve hit" pattern', () => {
    expect(detectsRateLimit("You've hit your usage limit")).toBe(true)
  })

  it('detects "usage limit" pattern', () => {
    expect(detectsRateLimit('Your usage limit has been reached')).toBe(true)
  })

  it('detects "quota" text', () => {
    expect(detectsRateLimit('API quota exceeded')).toBe(true)
  })

  it('detects "too many requests"', () => {
    expect(detectsRateLimit('Error: too many requests')).toBe(true)
  })

  it('detects "429" status code', () => {
    expect(detectsRateLimit('HTTP 429 error')).toBe(true)
  })

  it('detects "overloaded"', () => {
    expect(detectsRateLimit('The API is overloaded')).toBe(true)
  })

  it('detects reset time with date', () => {
    expect(detectsRateLimit('Your limit resets Feb 13, 12pm')).toBe(true)
  })

  it('detects reset time without date', () => {
    expect(detectsRateLimit('Your limit resets 10pm')).toBe(true)
  })

  it('returns false for normal text', () => {
    expect(detectsRateLimit('Hello, how can I help?')).toBe(false)
  })

  it('returns false for empty string', () => {
    expect(detectsRateLimit('')).toBe(false)
  })
})
