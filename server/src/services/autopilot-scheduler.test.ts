import { describe, it, expect } from 'vitest'

/**
 * The scheduler's `isWithinWindow` and `getWindowEnd` are private functions.
 * We re-implement them here to test the pure logic without importing
 * the module (which has side effects via database imports).
 */

// ─── Extracted logic under test ─────────────────────────────────────────

function isWithinWindow(cfg: { schedule_start_time: string | null; schedule_end_time: string | null; schedule_days: string }, now: Date): boolean {
  const startStr = cfg.schedule_start_time
  const endStr = cfg.schedule_end_time
  if (!startStr || !endStr) return false

  const days: number[] = JSON.parse(cfg.schedule_days || '[1,2,3,4,5]')
  const currentDay = now.getDay()
  if (!days.includes(currentDay)) return false

  const [startH, startM] = startStr.split(':').map(Number)
  const [endH, endM] = endStr.split(':').map(Number)

  const startMinutes = startH * 60 + startM
  const endMinutes = endH * 60 + endM
  const nowMinutes = now.getHours() * 60 + now.getMinutes()

  if (startMinutes <= endMinutes) {
    return nowMinutes >= startMinutes && nowMinutes < endMinutes
  } else {
    return nowMinutes >= startMinutes || nowMinutes < endMinutes
  }
}

function getWindowEnd(cfg: { schedule_end_time: string | null }, now: Date): number {
  const endStr = cfg.schedule_end_time
  if (!endStr) return Date.now() + 8 * 60 * 60 * 1000

  const [endH, endM] = endStr.split(':').map(Number)
  const end = new Date(now)
  end.setHours(endH, endM, 0, 0)

  if (end.getTime() <= now.getTime()) {
    end.setDate(end.getDate() + 1)
  }

  return end.getTime()
}

// ─── Tests ──────────────────────────────────────────────────────────────

describe('isWithinWindow', () => {
  const weekdayCfg = (start: string, end: string, days = '[1,2,3,4,5]') => ({
    schedule_start_time: start,
    schedule_end_time: end,
    schedule_days: days,
  })

  describe('same-day window (e.g. 09:00-17:00)', () => {
    it('returns true when within the window', () => {
      // Wednesday at 12:00
      const now = new Date('2026-02-11T12:00:00') // Wednesday
      expect(isWithinWindow(weekdayCfg('09:00', '17:00'), now)).toBe(true)
    })

    it('returns true at exact start time', () => {
      const now = new Date('2026-02-11T09:00:00')
      expect(isWithinWindow(weekdayCfg('09:00', '17:00'), now)).toBe(true)
    })

    it('returns false at exact end time', () => {
      const now = new Date('2026-02-11T17:00:00')
      expect(isWithinWindow(weekdayCfg('09:00', '17:00'), now)).toBe(false)
    })

    it('returns false before the window', () => {
      const now = new Date('2026-02-11T08:59:00')
      expect(isWithinWindow(weekdayCfg('09:00', '17:00'), now)).toBe(false)
    })

    it('returns false after the window', () => {
      const now = new Date('2026-02-11T17:01:00')
      expect(isWithinWindow(weekdayCfg('09:00', '17:00'), now)).toBe(false)
    })
  })

  describe('cross-midnight window (e.g. 22:00-10:00)', () => {
    it('returns true in the evening portion', () => {
      const now = new Date('2026-02-11T23:00:00')
      expect(isWithinWindow(weekdayCfg('22:00', '10:00'), now)).toBe(true)
    })

    it('returns true in the morning portion', () => {
      const now = new Date('2026-02-11T09:00:00')
      expect(isWithinWindow(weekdayCfg('22:00', '10:00'), now)).toBe(true)
    })

    it('returns true at exact start (22:00)', () => {
      const now = new Date('2026-02-11T22:00:00')
      expect(isWithinWindow(weekdayCfg('22:00', '10:00'), now)).toBe(true)
    })

    it('returns false at exact end (10:00)', () => {
      const now = new Date('2026-02-11T10:00:00')
      expect(isWithinWindow(weekdayCfg('22:00', '10:00'), now)).toBe(false)
    })

    it('returns false in the gap (e.g. 15:00)', () => {
      const now = new Date('2026-02-11T15:00:00')
      expect(isWithinWindow(weekdayCfg('22:00', '10:00'), now)).toBe(false)
    })
  })

  describe('day-of-week filtering', () => {
    it('returns false on excluded days', () => {
      // Sunday = 0
      const sunday = new Date('2026-02-15T12:00:00')
      expect(isWithinWindow(weekdayCfg('09:00', '17:00', '[1,2,3,4,5]'), sunday)).toBe(false)
    })

    it('returns true on included days', () => {
      // Monday = 1
      const monday = new Date('2026-02-09T12:00:00')
      expect(isWithinWindow(weekdayCfg('09:00', '17:00', '[1,2,3,4,5]'), monday)).toBe(true)
    })

    it('supports weekend-only schedule', () => {
      const saturday = new Date('2026-02-14T12:00:00')
      expect(isWithinWindow(weekdayCfg('09:00', '17:00', '[0,6]'), saturday)).toBe(true)
    })

    it('supports all-days schedule', () => {
      const sunday = new Date('2026-02-15T12:00:00')
      expect(isWithinWindow(weekdayCfg('09:00', '17:00', '[0,1,2,3,4,5,6]'), sunday)).toBe(true)
    })
  })

  describe('edge cases', () => {
    it('returns false when start_time is null', () => {
      const now = new Date('2026-02-11T12:00:00')
      expect(isWithinWindow({ schedule_start_time: null, schedule_end_time: '17:00', schedule_days: '[1,2,3,4,5]' }, now)).toBe(false)
    })

    it('returns false when end_time is null', () => {
      const now = new Date('2026-02-11T12:00:00')
      expect(isWithinWindow({ schedule_start_time: '09:00', schedule_end_time: null, schedule_days: '[1,2,3,4,5]' }, now)).toBe(false)
    })

    it('returns false when both times are null', () => {
      const now = new Date('2026-02-11T12:00:00')
      expect(isWithinWindow({ schedule_start_time: null, schedule_end_time: null, schedule_days: '[1,2,3,4,5]' }, now)).toBe(false)
    })
  })
})

describe('getWindowEnd', () => {
  it('returns end time today when end is still in the future', () => {
    const now = new Date('2026-02-11T14:00:00')
    const result = getWindowEnd({ schedule_end_time: '17:00' }, now)
    const expected = new Date('2026-02-11T17:00:00').getTime()
    expect(result).toBe(expected)
  })

  it('returns end time tomorrow when end has already passed', () => {
    const now = new Date('2026-02-11T18:00:00')
    const result = getWindowEnd({ schedule_end_time: '17:00' }, now)
    const expected = new Date('2026-02-12T17:00:00').getTime()
    expect(result).toBe(expected)
  })

  it('returns end time tomorrow when now is exactly at end time', () => {
    const now = new Date('2026-02-11T17:00:00')
    const result = getWindowEnd({ schedule_end_time: '17:00' }, now)
    const expected = new Date('2026-02-12T17:00:00').getTime()
    expect(result).toBe(expected)
  })

  it('returns 8 hours from now when end_time is null', () => {
    const now = new Date('2026-02-11T12:00:00')
    const before = Date.now()
    const result = getWindowEnd({ schedule_end_time: null }, now)
    const after = Date.now()
    // Should be approximately 8 hours from now (Date.now(), not from the passed `now`)
    expect(result).toBeGreaterThanOrEqual(before + 8 * 60 * 60 * 1000)
    expect(result).toBeLessThanOrEqual(after + 8 * 60 * 60 * 1000)
  })

  it('handles midnight end time correctly', () => {
    const now = new Date('2026-02-11T23:30:00')
    const result = getWindowEnd({ schedule_end_time: '00:00' }, now)
    const expected = new Date('2026-02-12T00:00:00').getTime()
    expect(result).toBe(expected)
  })

  it('handles early morning end time from late night', () => {
    const now = new Date('2026-02-11T23:00:00')
    const result = getWindowEnd({ schedule_end_time: '06:00' }, now)
    const expected = new Date('2026-02-12T06:00:00').getTime()
    expect(result).toBe(expected)
  })
})
