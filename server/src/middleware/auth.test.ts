import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the auth service before importing
vi.mock('../services/auth.js', () => ({
  verifyToken: vi.fn(),
}))

import { authMiddleware, type AuthRequest } from './auth.js'
import { verifyToken } from '../services/auth.js'

function createMockReqRes(authHeader?: string) {
  const req = {
    headers: {
      authorization: authHeader,
    },
    user: undefined,
  } as unknown as AuthRequest

  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as any

  const next = vi.fn()

  return { req, res, next }
}

describe('authMiddleware', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when no Authorization header', () => {
    const { req, res, next } = createMockReqRes(undefined)
    authMiddleware(req, res, next)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json).toHaveBeenCalledWith({ error: 'No token provided' })
    expect(next).not.toHaveBeenCalled()
  })

  it('returns 401 when header does not start with Bearer', () => {
    const { req, res, next } = createMockReqRes('Basic abc123')
    authMiddleware(req, res, next)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json).toHaveBeenCalledWith({ error: 'No token provided' })
    expect(next).not.toHaveBeenCalled()
  })

  it('returns 401 for empty Authorization header', () => {
    const { req, res, next } = createMockReqRes('')
    authMiddleware(req, res, next)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(next).not.toHaveBeenCalled()
  })

  it('calls next() with valid token', () => {
    const mockUser = { id: 1, username: 'testuser' }
    vi.mocked(verifyToken).mockReturnValue(mockUser)

    const { req, res, next } = createMockReqRes('Bearer valid-token-123')
    authMiddleware(req, res, next)

    expect(verifyToken).toHaveBeenCalledWith('valid-token-123')
    expect(next).toHaveBeenCalled()
    expect(res.status).not.toHaveBeenCalled()
  })

  it('sets req.user from token payload', () => {
    const mockUser = { id: 42, username: 'admin' }
    vi.mocked(verifyToken).mockReturnValue(mockUser)

    const { req, res, next } = createMockReqRes('Bearer my-jwt')
    authMiddleware(req, res, next)

    expect(req.user).toEqual({ id: 42, username: 'admin' })
  })

  it('returns 401 for invalid token', () => {
    vi.mocked(verifyToken).mockImplementation(() => {
      throw new Error('jwt malformed')
    })

    const { req, res, next } = createMockReqRes('Bearer bad-token')
    authMiddleware(req, res, next)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid token' })
    expect(next).not.toHaveBeenCalled()
  })

  it('returns 401 for expired token', () => {
    vi.mocked(verifyToken).mockImplementation(() => {
      throw new Error('jwt expired')
    })

    const { req, res, next } = createMockReqRes('Bearer expired-token')
    authMiddleware(req, res, next)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid token' })
    expect(next).not.toHaveBeenCalled()
  })

  it('extracts token correctly (strips "Bearer " prefix)', () => {
    vi.mocked(verifyToken).mockReturnValue({ id: 1, username: 'u' })

    const { req, res, next } = createMockReqRes('Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig')
    authMiddleware(req, res, next)

    expect(verifyToken).toHaveBeenCalledWith('eyJhbGciOiJIUzI1NiJ9.payload.sig')
  })
})
