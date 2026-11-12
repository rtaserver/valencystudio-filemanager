import { db } from '@/lib/db'
import { getSessionUser, logActivity, getClientIp } from '@/lib/auth'
import { jsonError, readJson } from '@/lib/api-helpers'
import { ownedFolder, isSelfOrDescendant, deleteFolderTree } from '@/lib/folders'
import { isValidFolderColor, sanitizeFolderEmoji } from '@/lib/folder-style'
import { emitChanged, ROOM } from '@/lib/realtime-emit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** PATCH /api/folders/[id] — rename { name? } and/or move { parentId? } and/or restyle { emoji?, color? } */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionUser(req)
  if (!session) return jsonError('Unauthorized', 401)
  const { id } = await params
  const folder = await ownedFolder(id, session.id)
  if (!folder) return jsonError('Folder not found.', 404)

  const body = await readJson<{ name?: string; parentId?: string | null; emoji?: string | null; color?: string | null }>(req)
  const data: { name?: string; parentId?: string | null; emoji?: string | null; color?: string | null } = {}

  if (body.name !== undefined) {
    const name = (body.name || '').trim().slice(0, 80)
    if (!name) return jsonError('Folder name cannot be empty.')
    const dupe = await db.folder.findFirst({
      where: { ownerId: session.id, parentId: folder.parentId, name: { equals: name }, id: { not: id } },
    })
    if (dupe) return jsonError(`A folder named "${name}" already exists here.`, 409)
    data.name = name
  }

  if (body.parentId !== undefined) {
    if (body.parentId === null || body.parentId === '') {
      data.parentId = null
    } else {
      const target = await ownedFolder(body.parentId, session.id)
      if (!target) return jsonError('Target folder not found.', 404)
      if (await isSelfOrDescendant(id, target.id, session.id)) {
        return jsonError('Cannot move a folder into itself or one of its subfolders.', 400)
      }
      data.parentId = target.id
    }
  }

  if (body.emoji !== undefined) {
    data.emoji = sanitizeFolderEmoji(body.emoji)
  }
  if (body.color !== undefined) {
    data.color = isValidFolderColor(body.color) ? body.color : null
  }

  if (Object.keys(data).length === 0) return jsonError('Nothing to update.')

  const updated = await db.folder.update({ where: { id }, data })
  const detail = [
    data.name ? `renamed to "${data.name}"` : null,
    data.parentId !== undefined ? 'moved' : null,
    data.emoji !== undefined || data.color !== undefined ? 'restyled' : null,
  ]
    .filter(Boolean)
    .join(' & ')
  await logActivity(session.id, 'FOLDER_UPDATE', `Folder "${folder.name}" ${detail}`, getClientIp(req))
  emitChanged(['folders'], { rooms: [ROOM.user(session.id)] })
  return Response.json({ ok: true, id: updated.id, name: updated.name, parentId: updated.parentId, emoji: updated.emoji, color: updated.color })
}

/** DELETE /api/folders/[id] — delete folder tree (files inside are soft-trashed) */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionUser(req)
  if (!session) return jsonError('Unauthorized', 401)
  const { id } = await params
  const result = await deleteFolderTree(id, session.id)
  if (!result) return jsonError('Folder not found.', 404)
  // realtime: tree + lists update instantly; trashed files change storage stats
  emitChanged(['folders', 'files', 'activity'], { rooms: [ROOM.user(session.id), ROOM.admins] })
  return Response.json({ ok: true, ...result })
}
