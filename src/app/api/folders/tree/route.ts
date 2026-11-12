import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/auth'
import { jsonError } from '@/lib/api-helpers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/folders/tree — full flat folder list for the sidebar tree / move-target tree,
 * including RECURSIVE file counts and storage sizes (files in nested subfolders count
 * towards every ancestor).
 */
export async function GET(req: Request) {
  const session = await getSessionUser(req)
  if (!session) return jsonError('Unauthorized', 401)
  const folders = await db.folder.findMany({
    where: { ownerId: session.id },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, parentId: true, emoji: true, color: true, createdAt: true },
  })

  // direct per-folder aggregates (live files only) — one grouped query
  const agg = await db.file.groupBy({
    by: ['folderId'],
    where: { ownerId: session.id, deletedAt: null, status: 'READY' },
    _count: { id: true },
    _sum: { size: true },
  })
  const direct = new Map<string, { count: number; size: number }>()
  for (const g of agg) {
    if (g.folderId) direct.set(g.folderId, { count: g._count.id, size: g._sum.size || 0 })
  }

  // bottom-up accumulation of descendant stats
  const childrenOf = new Map<string | null, string[]>()
  for (const f of folders) {
    const k = f.parentId
    if (!childrenOf.has(k)) childrenOf.set(k, [])
    childrenOf.get(k)!.push(f.id)
  }
  const statsOf = new Map<string, { count: number; size: number }>()
  const compute = (id: string, guard = 0): { count: number; size: number } => {
    const cached = statsOf.get(id)
    if (cached) return cached
    const d = direct.get(id) || { count: 0, size: 0 }
    const acc = { count: d.count, size: d.size }
    if (guard < 100) {
      for (const c of childrenOf.get(id) || []) {
        const s = compute(c, guard + 1)
        acc.count += s.count
        acc.size += s.size
      }
    }
    statsOf.set(id, acc)
    return acc
  }
  for (const f of folders) compute(f.id)

  return Response.json({
    folders: folders.map(f => ({
      id: f.id,
      name: f.name,
      parentId: f.parentId,
      emoji: f.emoji,
      color: f.color,
      createdAt: f.createdAt.toISOString(),
      fileCount: statsOf.get(f.id)?.count || 0,
      totalSize: statsOf.get(f.id)?.size || 0,
    })),
  })
}
