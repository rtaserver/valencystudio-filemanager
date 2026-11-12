import { db } from '@/lib/db'
import { getSessionUser, isPrivileged, logActivity, getClientIp } from '@/lib/auth'
import { json, jsonError, readJson } from '@/lib/api-helpers'
import { emitChanged, ROOM } from '@/lib/realtime-emit'
import { createHash, randomBytes } from 'crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const TTL_OPTIONS = [60, 1440, 10080, 43200] // minutes: 1h, 1d, 7d, 30d
const MAX_ACTIVE_LINKS_PER_FILE = 20

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

function serialize(row: {
  id: string
  prefix: string
  oneTime: boolean
  usedCount: number
  expiresAt: Date
  revoked: boolean
  lastUsedAt: Date | null
  createdAt: Date
}) {
  const expired = row.expiresAt.getTime() <= Date.now()
  const burnt = row.oneTime && row.usedCount > 0
  return {
    id: row.id,
    prefix: row.prefix,
    oneTime: row.oneTime,
    usedCount: row.usedCount,
    expiresAt: row.expiresAt.toISOString(),
    revoked: row.revoked,
    lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    active: !row.revoked && !expired && !burnt,
    expired,
    burnt,
  }
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionUser(req)
  if (!session) return jsonError('Unauthorized', 401)
  const { id } = await params
  const file = await db.file.findUnique({ where: { id } })
  if (!file) return jsonError('Not found', 404)
  if (file.ownerId !== session.id && !isPrivileged(session)) return jsonError('Forbidden', 403)
  const links = await db.downloadToken.findMany({
    where: { fileId: id },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })
  return json({ links: links.map(serialize) })
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionUser(req)
  if (!session) return jsonError('Unauthorized', 401)
  const { id } = await params
  const body = await readJson<{ ttlMinutes?: number; oneTime?: boolean }>(req)

  const file = await db.file.findUnique({ where: { id } })
  if (!file) return jsonError('Not found', 404)
  if (file.ownerId !== session.id && !isPrivileged(session)) return jsonError('Forbidden', 403)
  if (file.status !== 'READY' || file.deletedAt) {
    return jsonError('Only ready, non-trashed files can get download links.', 409)
  }

  const ttl = Number(body.ttlMinutes)
  if (!TTL_OPTIONS.includes(ttl)) {
    return jsonError('Invalid expiry — choose 60, 1440, 10080 or 43200 minutes.', 400)
  }
  const oneTime = body.oneTime === true

  const activeCount = await db.downloadToken.count({
    where: { fileId: id, revoked: false, expiresAt: { gt: new Date() } },
  })
  if (activeCount >= MAX_ACTIVE_LINKS_PER_FILE) {
    return jsonError(`Too many active links for this file (max ${MAX_ACTIVE_LINKS_PER_FILE}). Revoke some first.`, 429)
  }

  const raw = `vd_${randomBytes(32).toString('hex')}`
  const row = await db.downloadToken.create({
    data: {
      tokenHash: sha256(raw),
      prefix: raw.slice(0, 12),
      fileId: id,
      userId: session.id,
      oneTime,
      expiresAt: new Date(Date.now() + ttl * 60 * 1000),
    },
  })
  await logActivity(session.id, 'FILE_LINK_CREATE', `Created ${oneTime ? 'one-time ' : ''}expiring download link for "${file.name}" (${ttl < 1440 ? `${ttl / 60}h` : `${ttl / 1440}d`})`, getClientIp(req))
  // realtime: details-dialog link list updates on every owner device
  emitChanged(['tokens', 'activity'], { rooms: [ROOM.user(file.ownerId)] })

  return json(
    {
      link: {
        ...serialize(row),
        // raw URL is returned exactly once — only the sha256 hash is stored
        url: `${new URL(req.url).origin}/api/dl/${raw}`,
      },
    },
    { status: 201 }
  )
}
