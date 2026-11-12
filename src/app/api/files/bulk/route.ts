import { db } from '@/lib/db'
import { getSessionUser, isPrivileged } from '@/lib/auth'
import { jsonError, readJson } from '@/lib/api-helpers'
import { deleteFileCompletely, trashFile, restoreFile } from '@/lib/files'
import { ownedFolder } from '@/lib/folders'
import { logActivity } from '@/lib/auth'
import { syncFileSummary } from '@/lib/tg-meta'
import { emitChanged, ROOM } from '@/lib/realtime-emit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 600

/** Bulk operations on the current user's files: { action: 'trash' | 'restore' | 'purge' | 'move' | 'star' | 'unstar', ids: string[], folderId? } */
export async function POST(req: Request) {
  const session = await getSessionUser(req)
  if (!session) return jsonError('Unauthorized', 401)
  const body = await readJson<{ action?: string; ids?: string[]; folderId?: string | null }>(req)
  const action = body.action
  const ids = Array.isArray(body.ids) ? body.ids.slice(0, 500) : []
  if (!['trash', 'restore', 'purge', 'move', 'star', 'unstar'].includes(action || '')) return jsonError('Invalid action.')
  if (ids.length === 0) return jsonError('No files selected.')

  // resolve target folder for move
  let moveFolderId: string | null = null
  if (action === 'move') {
    if (body.folderId) {
      const f = await ownedFolder(body.folderId, session.id)
      if (!f) return jsonError('Target folder not found.', 404)
      moveFolderId = f.id
    }
  }

  const files = await db.file.findMany({ where: { id: { in: ids }, ownerId: session.id } })
  let done = 0
  for (const f of files) {
    try {
      if (action === 'trash' && !f.deletedAt) {
        await trashFile(f.id, session.id)
        done++
      } else if (action === 'restore' && f.deletedAt) {
        await restoreFile(f.id, session.id)
        done++
      } else if (action === 'purge') {
        await deleteFileCompletely(f.id, session.id, session.role)
        done++
      } else if (action === 'move' && !f.deletedAt && f.folderId !== moveFolderId) {
        await db.file.update({ where: { id: f.id }, data: { folderId: moveFolderId } })
        done++
      } else if ((action === 'star' || action === 'unstar') && !f.deletedAt && f.starred !== (action === 'star')) {
        await db.file.update({ where: { id: f.id }, data: { starred: action === 'star' } })
        done++
      }
    } catch {}
  }
  if (action === 'move' && done > 0) {
    await logActivity(session.id, 'FILE_MOVE', `Moved ${done} file(s) to ${moveFolderId ? 'a folder' : 'My Files'}`)
    // Telegram summary cards follow the new location (best effort, fire-and-forget)
    for (const f of files) {
      if (!f.deletedAt && f.folderId !== moveFolderId) void syncFileSummary(f.id)
    }
  }
  if ((action === 'star' || action === 'unstar') && done > 0) {
    await logActivity(session.id, action === 'star' ? 'FILE_STAR' : 'FILE_UNSTAR', `${action === 'star' ? 'Starred' : 'Unstarred'} ${done} file(s)`)
  }
  // realtime: bulk ops refresh every tab/device of this user (+ admin panels)
  if (done > 0) emitChanged(['files', 'activity'], { rooms: [ROOM.user(session.id), ROOM.admins] })
  return Response.json({ ok: true, affected: done, requested: ids.length })
}
