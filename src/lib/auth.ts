import { db } from '@/lib/db'
import { getJwtSecret } from '@/lib/settings'
import { extractBearerToken, verifyBearerToken } from '@/lib/api-token'
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'crypto'
import { cookies } from 'next/headers'

export { getJwtSecret }

export const COOKIE_NAME = 'vs_token'
const TOKEN_TTL = 60 * 60 * 24 * 7 // 7 days

// ---------- password hashing (scrypt) ----------
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [salt, hash] = stored.split(':')
    if (!salt || !hash) return false
    const candidate = scryptSync(password, salt, 64)
    const expected = Buffer.from(hash, 'hex')
    return candidate.length === expected.length && timingSafeEqual(candidate, expected)
  } catch {
    return false
  }
}

export function hashSharePassword(password: string, salt: string): string {
  return scryptSync(password, salt, 32).toString('hex')
}

// ---------- tokens (HMAC-signed) ----------
function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url')
}

export function signToken(payload: object, secret: string): string {
  const body = b64url(JSON.stringify({ ...payload, exp: Date.now() + TOKEN_TTL * 1000 }))
  const sig = createHmac('sha256', secret).update(body).digest('base64url')
  return `${body}.${sig}`
}

export function verifyToken(token: string, secret: string): (Record<string, any> & { uid?: string; exp: number }) | null {
  try {
    const [body, sig] = token.split('.')
    if (!body || !sig) return null
    const expected = createHmac('sha256', secret).update(body).digest('base64url')
    const a = Buffer.from(sig)
    const b = Buffer.from(expected)
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString())
    if (!payload.exp || payload.exp < Date.now()) return null
    return payload
  } catch {
    return null
  }
}

// ---------- session helpers ----------
export interface SessionUser {
  id: string
  email: string
  name: string | null
  role: string
  quota: number
  isActive: boolean
  createdAt: Date
}

export async function getSessionUser(req?: Request): Promise<SessionUser | null> {
  // 1) Personal API token (Authorization: Bearer vs_…) — only when a Request is provided
  if (req) {
    const bearer = extractBearerToken(req)
    if (bearer) {
      const match = await verifyBearerToken(bearer)
      if (!match) return null
      const tokenUser = await db.user.findUnique({ where: { id: match.userId } })
      if (!tokenUser || !tokenUser.isActive) return null
      return {
        id: tokenUser.id,
        email: tokenUser.email,
        name: tokenUser.name,
        role: tokenUser.role,
        quota: tokenUser.quota,
        isActive: tokenUser.isActive,
        createdAt: tokenUser.createdAt,
      }
    }
  }
  // 2) Session cookie
  const store = await cookies()
  const token = store.get(COOKIE_NAME)?.value
  if (!token) return null
  const secret = await getJwtSecret()
  const payload = verifyToken(token, secret)
  if (!payload) return null
  const user = await db.user.findUnique({ where: { id: payload.uid } })
  if (!user || !user.isActive) return null
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    quota: user.quota,
    isActive: user.isActive,
    createdAt: user.createdAt,
  }
}

export function isPrivileged(user: SessionUser | null): boolean {
  return !!user && (user.role === 'OWNER' || user.role === 'ADMIN')
}

export function cookieOptions(req?: Request) {
  // secure automatically when the request arrived over https (proxied deploys set
  // X-Forwarded-Proto) or when forced via env — plain http previews keep working
  const proto = (req?.headers.get('x-forwarded-proto') || '').split(',')[0].trim()
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.COOKIE_SECURE === '1' || proto === 'https',
    path: '/',
    maxAge: TOKEN_TTL,
  }
}

// ---------- misc ----------
export function getClientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0].trim()
  return req.headers.get('x-real-ip') || '127.0.0.1'
}

// simple in-memory rate limiter (expired buckets are pruned to keep memory flat)
const rateBuckets = new Map<string, { count: number; reset: number }>()
export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now()
  if (rateBuckets.size > 5_000) {
    for (const [k, b] of rateBuckets) {
      if (now > b.reset) rateBuckets.delete(k)
    }
    if (rateBuckets.size > 10_000) rateBuckets.clear() // last-resort guard against abuse
  }
  const bucket = rateBuckets.get(key)
  if (!bucket || now > bucket.reset) {
    rateBuckets.set(key, { count: 1, reset: now + windowMs })
    return true
  }
  if (bucket.count >= limit) return false
  bucket.count++
  return true
}

export function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status })
}

export async function logActivity(userId: string | null, action: string, detail?: string, ip?: string) {
  try {
    await db.activityLog.create({ data: { userId, action, detail: detail?.slice(0, 500), ip } })
  } catch {
    // non-fatal
  }
}
