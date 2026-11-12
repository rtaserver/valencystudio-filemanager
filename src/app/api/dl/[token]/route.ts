import { db } from '@/lib/db'
import { jsonError } from '@/lib/api-helpers'
import { buildFileResponse } from '@/lib/download'
import { logActivity, getClientIp } from '@/lib/auth'
import { emitChanged, ROOM } from '@/lib/realtime-emit'
import { createHash } from 'crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * Public direct-download endpoint for expiring links (vd_… tokens).
 * The raw token is the only secret — DB stores its sha256 hash.
 */
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!token || !token.startsWith('vd_') || token.length < 20) {
    return jsonError('This download link is not valid.', 404)
  }
  const hash = createHash('sha256').update(token).digest('hex')
  const row = await db.downloadToken.findUnique({ where: { tokenHash: hash }, include: { file: true } })
  if (!row) return jsonError('This download link is not valid.', 404)
  if (row.revoked) return jsonError('This download link was revoked by its owner.', 410)
  if (row.expiresAt.getTime() <= Date.now()) return jsonError('This download link has expired.', 410)
  if (row.oneTime && row.usedCount > 0) {
    return jsonError('This one-time link has already been used.', 410)
  }
  const file = row.file
  if (!file || file.status !== 'READY' || file.deletedAt) {
    return jsonError('This file is no longer available.', 404)
  }

  // Atomically claim a one-time token. Concurrent requests may all have read
  // usedCount=0 above, but only one can transition it from 0 to 1.
  if (row.oneTime) {
    const claim = await db.downloadToken.updateMany({
      where: { id: row.id, usedCount: 0, revoked: false, expiresAt: { gt: new Date() } },
      data: { usedCount: { increment: 1 }, lastUsedAt: new Date() },
    })
    if (claim.count !== 1) return jsonError('This one-time link has already been used.', 410)
  } else {
    await db.downloadToken.update({
      where: { id: row.id },
      data: { usedCount: { increment: 1 }, lastUsedAt: new Date() },
    })
  }
  await db.file.update({ where: { id: file.id }, data: { downloads: { increment: 1 } } })
  await db.downloadLog.create({ data: { fileId: file.id, ip: getClientIp(req), userAgent: req.headers.get('user-agent')?.slice(0, 250) } })
  await logActivity(null, 'FILE_DOWNLOAD', `Direct (expiring) link download of "${file.name}"`, getClientIp(req))
  // realtime: owner sees link usage + counters update live
  emitChanged(['downloads', 'tokens', 'activity'], { rooms: [ROOM.user(file.ownerId), ROOM.user(row.userId), ROOM.admins] })

  return buildFileResponse(req, { name: file.name, mimeType: file.mimeType, size: file.size, parts: file.parts }, 'attachment')
}
