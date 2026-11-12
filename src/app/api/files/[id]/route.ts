import { db } from '@/lib/db'
import { getSessionUser, isPrivileged, logActivity, getClientIp } from '@/lib/auth'
import { jsonError, readJson } from '@/lib/api-helpers'
import { deleteFileCompletely, trashFile } from '@/lib/files'
import { syncFileSummary } from '@/lib/tg-meta'
import { emitChanged, ROOM } from '@/lib/realtime-emit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

/** Rename a file and/or toggle the starred flag */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionUser(req)
  if (!session) return jsonError('Unauthorized', 401)
  const { id } = await params
  const body = await readJson<{ name?: string; starred?: boolean }>(req)

  const file = await db.file.findUnique({ where: { id } })
  if (!file) return jsonError('Not found', 404)
  if (file.ownerId !== session.id && !isPrivileged(session)) return jsonError('Forbidden', 403)

  const data: { name?: string; starred?: boolean } = {}
  if (typeof body.starred === 'boolean') data.starred = body.starred
  if (body.name !== undefined) {
    const name = (body.name || '').trim().slice(0, 255)
    if (!name) return jsonError('File name cannot be empty.')
    data.name = name
  }
  if (Object.keys(data).length === 0) return jsonError('Nothing to update.', 400)

  const updated = await db.file.update({ where: { id }, data })
  // realtime: rename/star reflect on this user's other tabs instantly
  emitChanged(['files'], { rooms: [ROOM.user(file.ownerId), ROOM.admins] })
  if (data.name) {
    void syncFileSummary(id) // Telegram summary card shows the new name (best effort)
    await logActivity(session.id, 'FILE_RENAME', `Renamed "${file.name}" → "${data.name}"`, getClientIp(req))
  }
  if (typeof data.starred === 'boolean' && data.starred !== file.starred) {
    await logActivity(session.id, data.starred ? 'FILE_STAR' : 'FILE_UNSTAR', `${data.starred ? 'Starred' : 'Unstarred'} "${file.name}"`, getClientIp(req))
  }
  return Response.json({ ok: true, file: { id: updated.id, name: updated.name, starred: updated.starred } })
}

/**
 * Delete a file.
 * - Default: soft-delete (trash) for the owner. If already trashed → permanent purge.
 * - ?permanent=1: immediate permanent purge (used by admins / trash view).
 */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionUser(req)
  if (!session) return jsonError('Unauthorized', 401)
  const { id } = await params
  const permanent = new URL(req.url).searchParams.get('permanent') === '1'

  const file = await db.file.findUnique({ where: { id } })
  if (!file) return jsonError('Not found', 404)
  if (file.ownerId !== session.id && !isPrivileged(session)) return jsonError('Forbidden', 403)

  const isAdminDeletingOthers = isPrivileged(session) && file.ownerId !== session.id
  if (permanent || file.deletedAt || isAdminDeletingOthers) {
    await deleteFileCompletely(id, session.id, session.role)
    // realtime: storage meter shrinks everywhere the moment bytes leave Telegram
    emitChanged(['files', 'activity'], { rooms: [ROOM.user(file.ownerId), ROOM.admins] })
    return Response.json({ ok: true, purged: true })
  }
  await trashFile(id, session.id)
  emitChanged(['files', 'activity'], { rooms: [ROOM.user(file.ownerId), ROOM.admins] })
  return Response.json({ ok: true, trashed: true })
}
