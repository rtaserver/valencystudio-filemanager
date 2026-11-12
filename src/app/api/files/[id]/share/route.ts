import { db } from '@/lib/db'
import { getSessionUser, isPrivileged, hashSharePassword, logActivity, getClientIp, getJwtSecret } from '@/lib/auth'
import { jsonError, readJson } from '@/lib/api-helpers'
import { getSettingsRaw } from '@/lib/settings'
import { publicFile } from '@/lib/files'
import { syncFileSummary } from '@/lib/tg-meta'
import { emitChanged, ROOM } from '@/lib/realtime-emit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionUser(req)
  if (!session) return jsonError('Unauthorized', 401)
  const { id } = await params
  const body = await readJson<{ enabled?: boolean; password?: string | null; removePassword?: boolean; expiresInMinutes?: number | null; maxDownloads?: number | null }>(req)

  const file = await db.file.findUnique({ where: { id } })
  if (!file) return jsonError('Not found', 404)
  if (file.ownerId !== session.id && !isPrivileged(session)) return jsonError('Forbidden', 403)
  if (file.status !== 'READY') return jsonError('Finish uploading the file before sharing it.', 409)

  const data: { shareEnabled?: boolean; sharePassword?: string | null; shareExpiresAt?: Date | null; shareMaxDownloads?: number | null } = {}
  if (typeof body.enabled === 'boolean') data.shareEnabled = body.enabled

  if (body.maxDownloads !== undefined) {
    if (body.maxDownloads === null) {
      data.shareMaxDownloads = null
    } else {
      const n = Number(body.maxDownloads)
      if (!Number.isInteger(n) || n < 1 || n > 1_000_000) return jsonError('Download limit must be between 1 and 1,000,000.')
      data.shareMaxDownloads = n
    }
  }

  if (body.expiresInMinutes !== undefined) {
    if (body.expiresInMinutes === null) {
      data.shareExpiresAt = null
    } else {
      const mins = Number(body.expiresInMinutes)
      if (!Number.isFinite(mins) || mins <= 0) return jsonError('Invalid expiry value.')
      data.shareExpiresAt = new Date(Date.now() + mins * 60 * 1000)
    }
  }

  if (body.removePassword) {
    data.sharePassword = null
  } else if (typeof body.password === 'string' && body.password.length > 0) {
    if (body.password.length < 4) return jsonError('Share password must be at least 4 characters.')
    const raw = await getSettingsRaw()
    data.sharePassword = hashSharePassword(body.password, raw.sharePasswordSalt || 'vsalt')
  }

  const updated = await db.file.update({ where: { id }, data })
  // realtime: share-dialog + shared list update instantly on every owner device
  emitChanged(['files'], { rooms: [ROOM.user(file.ownerId)] })
  if (typeof body.enabled === 'boolean') {
    void syncFileSummary(id) // Telegram card flips 🔒 Private ↔ 🌐 Public link (best effort)
    await logActivity(session.id, 'FILE_SHARE', `${body.enabled ? 'Enabled' : 'Disabled'} share link for "${file.name}"${data.sharePassword ? ' (password protected)' : ''}${data.shareMaxDownloads ? ` (limit ${data.shareMaxDownloads})` : ''}`, getClientIp(req))
  } else if (data.sharePassword) {
    await logActivity(session.id, 'FILE_SHARE', `Updated share password for "${file.name}"`, getClientIp(req))
  } else if (body.maxDownloads !== undefined) {
    await logActivity(session.id, 'FILE_SHARE', `${data.shareMaxDownloads == null ? 'Removed' : `Set ${data.shareMaxDownloads}`} download limit for "${file.name}"`, getClientIp(req))
  }

  return Response.json({ ok: true, file: publicFile(updated) })
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionUser(req)
  if (!session) return jsonError('Unauthorized', 401)
  const { id } = await params
  const file = await db.file.findUnique({ where: { id } })
  if (!file || (file.ownerId !== session.id && !isPrivileged(session))) return jsonError('Not found', 404)

  // download analytics: per-day counts for the last 14 days
  const dayMs = 24 * 60 * 60 * 1000
  const now = Date.now()
  const since = new Date(now - 13 * dayMs)
  const logs = await db.downloadLog.findMany({
    where: { fileId: id, createdAt: { gte: since } },
    select: { createdAt: true },
  })
  const days: string[] = []
  for (let i = 13; i >= 0; i--) days.push(new Date(now - i * dayMs).toISOString().slice(0, 10))
  const byDay = new Map<string, number>(days.map(d => [d, 0]))
  for (const l of logs) {
    const k = l.createdAt.toISOString().slice(0, 10)
    if (byDay.has(k)) byDay.set(k, (byDay.get(k) || 0) + 1)
  }

  return Response.json({
    ok: true,
    file: publicFile(file),
    analytics: {
      total: file.downloads,
      shareTotal: file.shareDownloadCount,
      byDay: days.map(d => ({ date: d, count: byDay.get(d) || 0 })),
    },
  })
}

// keep getJwtSecret referenced for potential signed link features
void getJwtSecret
