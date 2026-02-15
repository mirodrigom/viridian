import { describe, it, expect } from 'vitest'

/**
 * isNewer is defined inside the composable closure.
 * We re-implement it here to test the pure version comparison logic.
 */
function isNewer(a: string, b: string): boolean {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0
    const nb = pb[i] || 0
    if (na > nb) return true
    if (na < nb) return false
  }
  return false
}

describe('isNewer (version comparison)', () => {
  describe('major version', () => {
    it('detects newer major version', () => {
      expect(isNewer('2.0.0', '1.0.0')).toBe(true)
    })

    it('detects older major version', () => {
      expect(isNewer('1.0.0', '2.0.0')).toBe(false)
    })
  })

  describe('minor version', () => {
    it('detects newer minor version', () => {
      expect(isNewer('1.2.0', '1.1.0')).toBe(true)
    })

    it('detects older minor version', () => {
      expect(isNewer('1.1.0', '1.2.0')).toBe(false)
    })
  })

  describe('patch version', () => {
    it('detects newer patch version', () => {
      expect(isNewer('1.0.2', '1.0.1')).toBe(true)
    })

    it('detects older patch version', () => {
      expect(isNewer('1.0.1', '1.0.2')).toBe(false)
    })
  })

  describe('equal versions', () => {
    it('returns false for equal versions', () => {
      expect(isNewer('1.0.0', '1.0.0')).toBe(false)
    })

    it('returns false for equal two-segment versions', () => {
      expect(isNewer('1.0', '1.0')).toBe(false)
    })
  })

  describe('different segment lengths', () => {
    it('handles a having more segments (treats missing as 0)', () => {
      expect(isNewer('1.0.1', '1.0')).toBe(true)
    })

    it('handles b having more segments', () => {
      expect(isNewer('1.0', '1.0.1')).toBe(false)
    })

    it('treats 1.0 and 1.0.0 as equal', () => {
      expect(isNewer('1.0', '1.0.0')).toBe(false)
      expect(isNewer('1.0.0', '1.0')).toBe(false)
    })
  })

  describe('realistic version bumps', () => {
    it('0.2.0 is newer than 0.1.0', () => {
      expect(isNewer('0.2.0', '0.1.0')).toBe(true)
    })

    it('0.1.10 is newer than 0.1.9', () => {
      expect(isNewer('0.1.10', '0.1.9')).toBe(true)
    })

    it('1.0.0 is newer than 0.99.99', () => {
      expect(isNewer('1.0.0', '0.99.99')).toBe(true)
    })

    it('2.1.3 is not newer than 2.1.3', () => {
      expect(isNewer('2.1.3', '2.1.3')).toBe(false)
    })
  })
})
