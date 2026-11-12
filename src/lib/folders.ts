import { db } from '@/lib/db'
import { logActivity } from '@/lib/auth'

export interface FolderPathEntry {
  id: string
  name: string
  emoji?: string | null
  color?: string | null
}

/** Validate that a folder exists and belongs to the user — returns the folder or null */
export async function ownedFolder(folderId: string, ownerId: string) {
  if (!folderId) return null
  const f = await db.folder.findUnique({ where: { id: folderId } })
  return f && f.ownerId === ownerId ? f : null
}

/** Root-first breadcrumb path from root to the given folder (inclusive) */
export async function getFolderPath(folderId: string, ownerId: string): Promise<FolderPathEntry[]> {
  const path: FolderPathEntry[] = []
  let current = await ownedFolder(folderId, ownerId)
  let guard = 0
  while (current && guard < 50) {
    path.unshift({ id: current.id, name: current.name, emoji: current.emoji, color: current.color })
    current = current.parentId ? await ownedFolder(current.parentId, ownerId) : null
    guard++
  }
  return path
}

/** All descendant folder ids of the given folder (exclusive of the folder itself) */
export async function descendantFolderIds(folderId: string, ownerId: string): Promise<string[]> {
  const out: string[] = []
  const queue = [folderId]
  let guard = 0
  while (queue.length > 0 && guard < 1000) {
    const id = queue.shift()!
    const children = await db.folder.findMany({
      where: { parentId: id, ownerId },
      select: { id: true },
    })
    for (const c of children) {
      out.push(c.id)
      queue.push(c.id)
    }
    guard++
  }
  return out
}

/** True if `candidateAncestorId` is the folder itself or one of its descendants (cycle guard for moves) */
export async function isSelfOrDescendant(folderId: string, candidateAncestorId: string, ownerId: string): Promise<boolean> {
  if (folderId === candidateAncestorId) return true
  const descendants = await descendantFolderIds(folderId, ownerId)
  return descendants.includes(candidateAncestorId)
}

export interface FolderSummary {
  id: string
  name: string
  parentId: string | null
  emoji?: string | null
  color?: string | null
  fileCount: number
  totalSize: number
  createdAt: string
}

/** List direct child folders of `parentId` (null = root) with aggregate file stats */
export async function listChildFolders(ownerId: string, parentId: string | null): Promise<FolderSummary[]> {
  const folders = await db.folder.findMany({
    where: { ownerId, parentId },
    orderBy: { name: 'asc' },
  })
  const result: FolderSummary[] = []
  for (const f of folders) {
    const agg = await db.file.aggregate({
      where: { folderId: f.id, ownerId, deletedAt: null },
      _count: { id: true },
      _sum: { size: true },
    })
    result.push({
      id: f.id,
      name: f.name,
      parentId: f.parentId,
      emoji: f.emoji,
      color: f.color,
      fileCount: agg._count.id,
      totalSize: agg._sum.size || 0,
      createdAt: f.createdAt.toISOString(),
    })
  }
  return result
}

/**
 * Delete a folder tree: soft-trashes every non-deleted file inside (any depth),
 * removes the folder rows deepest-first. Folders themselves are not restorable —
 * the trashed files appear individually in the Trash view.
 */
export async function deleteFolderTree(folderId: string, ownerId: string) {
  const folder = await ownedFolder(folderId, ownerId)
  if (!folder) return null
  const ids = [folderId, ...(await descendantFolderIds(folderId, ownerId))]
  const files = await db.file.findMany({
    where: { folderId: { in: ids }, ownerId, deletedAt: null },
    select: { id: true, name: true },
  })
  let trashed = 0
  for (const f of files) {
    await db.file.update({
      where: { id: f.id },
      data: { deletedAt: new Date(), shareEnabled: false },
    })
    await logActivity(ownerId, 'FILE_TRASH', `Moved "${f.name}" to trash (folder "${folder.name}" deleted)`)
    trashed++
  }
  // delete deepest first: fetch depths and sort
  const rows = await db.folder.findMany({
    where: { id: { in: ids }, ownerId },
    select: { id: true, parentId: true, name: true },
  })
  const depthOf = new Map<string, number>()
  const depth = (id: string, guard = 0): number => {
    if (depthOf.has(id)) return depthOf.get(id)!
    const row = rows.find(r => r.id === id)
    if (!row || !row.parentId || !rows.some(r => r.id === row.parentId) || guard > 200) return 0
    const d = depth(row.parentId, guard + 1) + 1
    depthOf.set(id, d)
    return d
  }
  rows.forEach(r => depth(r.id))
  rows.sort((a, b) => (depthOf.get(b.id) || 0) - (depthOf.get(a.id) || 0))
  for (const r of rows) {
    await db.folder.delete({ where: { id: r.id } }).catch(() => {})
  }
  await logActivity(ownerId, 'FOLDER_DELETE', `Deleted folder "${folder.name}" (${trashed} file(s) moved to trash)`)
  return { trashed, folders: rows.length }
}
