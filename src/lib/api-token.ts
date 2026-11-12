import { db } from '@/lib/db'
import { createHash, randomBytes } from 'crypto'

/**
 * Personal API tokens (Zipline-style): high-entropy raw token shown ONCE,
 * stored as sha256 hash. Sent by clients as `Authorization: Bearer <raw>`.
 */

export interface ApiTokenRecord {
  id: string
  name: string
  prefix: string
  createdAt: string
  lastUsedAt: string | null
  revoked: boolean
}

export function generateRawToken(): string {
  return `vs_${randomBytes(24).toString('hex')}` // 48 hex chars, ~192 bits entropy
}

export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

export function tokenPrefix(raw: string): string {
  return raw.slice(0, 10)
}

/** Look up a raw bearer token → { userId, tokenRow } or null (also throttles lastUsedAt writes) */
export async function verifyBearerToken(raw: string): Promise<{ userId: string; tokenId: string } | null> {
  if (!raw.startsWith('vs_') || raw.length < 20 || raw.length > 128) return null
  const row = await db.apiToken.findUnique({ where: { tokenHash: hashToken(raw) } })
  if (!row || row.revoked) return null
  // throttle lastUsedAt updates to once per minute per token
  const now = Date.now()
  if (!row.lastUsedAt || now - row.lastUsedAt.getTime() > 60_000) {
    await db.apiToken.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } }).catch(() => {})
  }
  return { userId: row.userId, tokenId: row.id }
}

export function extractBearerToken(req: Request): string | null {
  const header = req.headers.get('authorization') || ''
  if (!header.toLowerCase().startsWith('bearer ')) return null
  const raw = header.slice(7).trim()
  return raw || null
}
