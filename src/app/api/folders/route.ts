import { db } from '@/lib/db'
import { getSessionUser, logActivity, getClientIp } from '@/lib/auth'
import { jsonError, readJson } from '@/lib/api-helpers'
import { ownedFolder, getFolderPath, listChildFolders } from '@/lib/folders'
import { isValidFolderColor, sanitizeFolderEmoji } from '@/lib/folder-style'
import { emitChanged, ROOM } from '@/lib/realtime-emit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET /api/folders?parent=<id|root> — child folders + breadcrumb path */
export async function GET(req: Request) {
  const session = await getSessionUser(req)
  if (!session) return jsonError('Unauthorized', 401)
  const url = new URL(req.url)
  const parent = url.searchParams.get('parent') || 'root'

  let parentId: string | null = null
  if (parent !== 'root') {
    const f = await ownedFolder(parent, session.id)
    if (!f) return jsonError('Folder not found.', 404)
    parentId = f.id
  }

  const [folders, path] = await Promise.all([
    listChildFolders(session.id, parentId),
    parentId ? getFolderPath(parentId, session.id) : Promise.resolve([]),
  ])
  return Response.json({ folders, path, parentId })
}

/** POST /api/folders — create a folder { name, parentId?, emoji?, color? } */
export async function POST(req: Request) {
  const session = await getSessionUser(req)
  if (!session) return jsonError('Unauthorized', 401)
  const body = await readJson<{ name?: string; parentId?: string | null; emoji?: string | null; color?: string | null }>(req)
  const name = (body.name || '').trim().slice(0, 80)
  if (!name) return jsonError('Folder name is required.')

  const emoji = sanitizeFolderEmoji(body.emoji)
  const color = isValidFolderColor(body.color) ? body.color : null

  let parentId: string | null = null
  if (body.parentId) {
    const f = await ownedFolder(body.parentId, session.id)
    if (!f) return jsonError('Target folder not found.', 404)
    parentId = f.id
  }

  const dupe = await db.folder.findFirst({
    where: { ownerId: session.id, parentId, name: { equals: name } },
  })
  if (dupe) return jsonError(`A folder named "${name}" already exists here.`, 409)

  const folder = await db.folder.create({
    data: { name, ownerId: session.id, parentId, emoji, color },
  })
  await logActivity(session.id, 'FOLDER_CREATE', `Created folder "${name}"`, getClientIp(req))
  // realtime: folder appears in grids + sidebar tree on every owner device
  emitChanged(['folders'], { rooms: [ROOM.user(session.id)] })
  return Response.json({
    folder: { id: folder.id, name: folder.name, parentId: folder.parentId, emoji: folder.emoji, color: folder.color, fileCount: 0, totalSize: 0, createdAt: folder.createdAt.toISOString() },
  })
}
