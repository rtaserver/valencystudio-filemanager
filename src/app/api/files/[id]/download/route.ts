import { db } from '@/lib/db'
import { getSessionUser, isPrivileged, logActivity, getClientIp } from '@/lib/auth'
import { jsonError } from '@/lib/api-helpers'
import { buildFileResponse } from '@/lib/download'
import { emitChanged, ROOM } from '@/lib/realtime-emit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionUser(req)
  if (!session) return jsonError('Unauthorized', 401)
  const { id } = await params
  const file = await db.file.findUnique({ where: { id } })
  if (!file || (file.ownerId !== session.id && !isPrivileged(session))) return jsonError('Not found', 404)
  if (file.status !== 'READY') return jsonError('Upload is not finished yet.', 409)
  if (file.deletedAt) return jsonError('This file is in the trash. Restore it first.', 409)

  const inline = new URL(req.url).searchParams.get('inline') === '1'
  const res = await buildFileResponse(req, { name: file.name, mimeType: file.mimeType, size: file.size, parts: file.parts }, inline ? 'inline' : 'attachment')

  if (!inline) {
    await db.file.update({ where: { id }, data: { downloads: { increment: 1 } } })
    await db.downloadLog.create({ data: { fileId: id, ip: getClientIp(req), userAgent: req.headers.get('user-agent')?.slice(0, 250) } })
    await logActivity(session.id, 'FILE_DOWNLOAD', `Downloaded "${file.name}" (owner copy)`, getClientIp(req))
    // realtime: owner's analytics/dialogs/admin panels see the counter tick up live
    emitChanged(['downloads', 'activity'], { rooms: [ROOM.user(file.ownerId), ROOM.admins] })
  }
  return res
}
