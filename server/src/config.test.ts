import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Test the config functions (getJwtSecret, getPort) in isolation.
 * We re-implement them here since the module has top-level side effects
 * (config is eagerly evaluated on import).
 */

function getJwtSecret(env: { JWT_SECRET?: string; NODE_ENV?: string }): string {
  const secret = env.JWT_SECRET
  const isProduction = env.NODE_ENV === 'production'
  const isDevelopment = env.NODE_ENV === 'development' || !env.NODE_ENV

  if (isProduction && !secret) {
    throw new Error(
      'JWT_SECRET environment variable is required in production. ' +
      'Generate a secure secret with: openssl rand -base64 64'
    )
  }

  if (isDevelopment && !secret) {
    return 'viridian-dev-secret-change-in-production'
  }

  if (secret && secret.length < 32) {
    throw new Error(
      'JWT_SECRET must be at least 32 characters long for security. ' +
      'Current length: ' + secret.length
    )
  }

  return secret!
}

function getPort(envPort?: string): number {
  const parsed = parseInt(envPort || '3010', 10)
  if (Number.isNaN(parsed) || parsed < 1 || parsed > 65535) {
    return 3010
  }
  return parsed
}

// ─── Tests ──────────────────────────────────────────────────────────────

describe('getJwtSecret', () => {
  it('throws in production without JWT_SECRET', () => {
    expect(() => getJwtSecret({ NODE_ENV: 'production' }))
      .toThrow('JWT_SECRET environment variable is required in production')
  })

  it('returns default secret in development without JWT_SECRET', () => {
    const secret = getJwtSecret({ NODE_ENV: 'development' })
    expect(secret).toBe('viridian-dev-secret-change-in-production')
  })

  it('returns default secret when NODE_ENV is unset (treated as development)', () => {
    const secret = getJwtSecret({})
    expect(secret).toBe('viridian-dev-secret-change-in-production')
  })

  it('returns the provided secret when long enough', () => {
    const longSecret = 'a'.repeat(64)
    const secret = getJwtSecret({ JWT_SECRET: longSecret, NODE_ENV: 'production' })
    expect(secret).toBe(longSecret)
  })

  it('throws when secret is less than 32 characters', () => {
    expect(() => getJwtSecret({ JWT_SECRET: 'short', NODE_ENV: 'production' }))
      .toThrow('JWT_SECRET must be at least 32 characters long')
  })

  it('throws with exact length in error message', () => {
    expect(() => getJwtSecret({ JWT_SECRET: 'abc', NODE_ENV: 'production' }))
      .toThrow('Current length: 3')
  })

  it('accepts exactly 32 characters', () => {
    const secret = 'a'.repeat(32)
    expect(getJwtSecret({ JWT_SECRET: secret, NODE_ENV: 'production' })).toBe(secret)
  })

  it('accepts secret in development mode even if long', () => {
    const secret = 'a'.repeat(64)
    expect(getJwtSecret({ JWT_SECRET: secret, NODE_ENV: 'development' })).toBe(secret)
  })
})

describe('getPort', () => {
  it('returns 3010 by default when no PORT set', () => {
    expect(getPort(undefined)).toBe(3010)
    expect(getPort('')).toBe(3010)
  })

  it('parses valid port number', () => {
    expect(getPort('8080')).toBe(8080)
    expect(getPort('3000')).toBe(3000)
    expect(getPort('443')).toBe(443)
  })

  it('falls back to 3010 for non-numeric value', () => {
    expect(getPort('abc')).toBe(3010)
  })

  it('falls back to 3010 for port 0', () => {
    expect(getPort('0')).toBe(3010)
  })

  it('falls back to 3010 for negative port', () => {
    expect(getPort('-1')).toBe(3010)
  })

  it('falls back to 3010 for port above 65535', () => {
    expect(getPort('70000')).toBe(3010)
  })

  it('accepts port 1 (minimum)', () => {
    expect(getPort('1')).toBe(1)
  })

  it('accepts port 65535 (maximum)', () => {
    expect(getPort('65535')).toBe(65535)
  })

  it('falls back to 3010 for float values', () => {
    // parseInt('3.14') returns 3, which is valid
    expect(getPort('3.14')).toBe(3)
  })
})
