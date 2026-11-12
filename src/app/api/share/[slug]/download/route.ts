import { db } from '@/lib/db'
import { jsonError } from '@/lib/api-helpers'
import { buildFileResponse } from '@/lib/download'
import { hasShareAccess, isShareExpired, isShareExhausted } from '@/lib/share'
import { logActivity, getClientIp } from '@/lib/auth'
import { emitChanged, ROOM } from '@/lib/realtime-emit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const file = await db.file.findUnique({ where: { shareSlug: slug } })
  if (!file || !file.shareEnabled || file.status !== 'READY' || file.deletedAt) {
    return jsonError('This file is not available. The link may have been revoked.', 404)
  }
  if (isShareExpired(file.shareExpiresAt)) {
    return jsonError('This share link has expired.', 410)
  }
  if (isShareExhausted(file)) {
    return jsonError('This file reached its download limit.', 410)
  }
  if (!(await hasShareAccess(req, slug, file.sharePassword))) {
    return jsonError('This file is password protected.', 401)
  }
  const res = await buildFileResponse(req, { name: file.name, mimeType: file.mimeType, size: file.size, parts: file.parts }, 'attachment')
  await db.file.update({ where: { id: file.id }, data: { downloads: { increment: 1 }, shareDownloadCount: { increment: 1 } } })
  await db.downloadLog.create({ data: { fileId: file.id, ip: getClientIp(req), userAgent: req.headers.get('user-agent')?.slice(0, 250) } })
  await logActivity(null, 'FILE_DOWNLOAD', `Public download of "${file.name}" (shared by ${file.ownerId})`, getClientIp(req))
  // realtime: owner analytics + the public share page counter tick up live
  emitChanged(['downloads', 'activity'], { rooms: [ROOM.user(file.ownerId), ROOM.admins, ROOM.slug(slug)] })
  return res
}
