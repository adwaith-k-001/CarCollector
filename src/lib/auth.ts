import jwt from 'jsonwebtoken'
import { NextRequest } from 'next/server'

if (!process.env.JWT_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET environment variable must be set in production')
  }
  console.warn('[auth] WARNING: JWT_SECRET not set — using insecure development default')
}

const JWT_SECRET = process.env.JWT_SECRET || 'car-auction-dev-only-insecure-default'

export interface JWTPayload {
  userId: number
  username: string
  iat?: number
  exp?: number
}

export function signToken(payload: { userId: number; username: string }): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' })
}

export function verifyToken(token: string): JWTPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JWTPayload
  } catch {
    return null
  }
}

export function getAuthUser(req: NextRequest): JWTPayload | null {
  const authHeader = req.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) return null
  const token = authHeader.substring(7)
  return verifyToken(token)
}
