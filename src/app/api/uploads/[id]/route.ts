import { db } from '@/lib/db'
import { getSessionUser, logActivity, getClientIp } from '@/lib/auth'
import { jsonError } from '@/lib/api-helpers'
import { publicFile } from '@/lib/files'
import { emitChanged, ROOM } from '@/lib/realtime-emit'
import { finalizeBigUpload } from '@/lib/telethon'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 900

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser(req)
  if (!user) return jsonError('Unauthorized', 401)
  const { id } = await params
  const session = await db.uploadSession.findUnique({ where: { id }, select: { id: true, ownerId: true, fileId: true, totalParts: true, partSize: true, expiresAt: true, status: true, messageId: true, parts: { where: { status: 'COMMITTED' }, select: { index: true, size: true } } } })
  if (!session || session.ownerId !== user.id) return jsonError('Upload not found.', 404)
  return Response.json({ ...session, received: session.parts.map(p => p.index) })
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser(req)
  if (!user) return jsonError('Unauthorized', 401)
  const { id } = await params
  const session = await db.uploadSession.findUnique({ where: { id }, include: { file: true, parts: true } })
  if (!session || session.ownerId !== user.id) return jsonError('Upload not found.', 404)
  if (session.status === 'READY' && session.messageId) {
    const file = await db.file.findUnique({ where: { id: session.fileId } })
    return file ? Response.json({ ok: true, file: publicFile(file) }) : jsonError('File not found.', 404)
  }
  if (session.status !== 'UPLOADING' && session.status !== 'FINALIZING') return jsonError('Upload session is no longer active.', 409)
  if (session.expiresAt <= new Date()) return jsonError('Upload session expired.', 409)
  const committed = session.parts.filter(part => part.status === 'COMMITTED')
  if (committed.length !== session.totalParts || committed.reduce((sum, part) => sum + part.size, 0) !== session.file.size) return jsonError(`Upload incomplete: ${committed.length}/${session.totalParts} confirmed parts.`, 409)
  const claimed = await db.uploadSession.updateMany({ where: { id, ownerId: user.id, status: 'UPLOADING' }, data: { status: 'FINALIZING' } })
  if (claimed.count !== 1) return jsonError('Upload is already being finalized; retry status shortly.', 409)
  try {
    const result = await finalizeBigUpload(session.telegramFileId, session.totalParts, session.file.name, session.file.mimeType, `upload:${session.id}`, req.signal)
    const parts = JSON.stringify([{ ref: `telethon:${result.messageId}`, size: session.file.size }])
    const [file] = await db.$transaction([
      db.file.update({ where: { id: session.fileId }, data: { status: 'READY', parts } }),
      db.uploadSession.update({ where: { id }, data: { status: 'READY', messageId: result.messageId } }),
    ])
    await logActivity(user.id, 'FILE_UPLOAD', `Uploaded "${session.file.name}" (${session.file.size} bytes via resumable Telegram multipart)`, getClientIp(req))
    emitChanged(['files', 'activity'], { rooms: [ROOM.user(user.id), ROOM.admins] })
    return Response.json({ ok: true, file: publicFile(file) })
  } catch (error) {
    // Keep FINALIZING: Telegram may have accepted the document even if the response was lost.
    // A retry uses the stable caption marker to reconcile the existing message.
    return jsonError(error instanceof Error ? error.message : 'Multipart finalization outcome is unknown; retry status shortly.', 502)
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser(req)
  if (!user) return jsonError('Unauthorized', 401)
  const { id } = await params
  const session = await db.uploadSession.findUnique({ where: { id }, select: { ownerId: true, fileId: true, status: true } })
  if (!session || session.ownerId !== user.id) return jsonError('Upload not found.', 404)
  if (session.status !== 'UPLOADING') return jsonError('Upload is finalizing or already completed; cancellation was not applied.', 409)
  const canceled = await db.uploadSession.updateMany({ where: { id, ownerId: user.id, status: 'UPLOADING' }, data: { status: 'CANCELED' } })
  if (canceled.count !== 1) return jsonError('Upload is finalizing or already completed; cancellation was not applied.', 409)
  await db.uploadSession.delete({ where: { id } })
  await db.file.delete({ where: { id: session.fileId } }).catch(() => {})
  return Response.json({ ok: true })
}
