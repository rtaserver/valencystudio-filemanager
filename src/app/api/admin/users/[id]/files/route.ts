import { db } from '@/lib/db'
import { getSessionUser, isPrivileged } from '@/lib/auth'
import { json, jsonError } from '@/lib/api-helpers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Admin: list a user's files (for the per-user drawer in the admin panel). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionUser()
  if (!session) return jsonError('Unauthorized', 401)
  if (!isPrivileged(session)) return jsonError('Forbidden', 403)
  const { id } = await params

  const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, name: true, role: true, isActive: true, createdAt: true, quota: true } })
  if (!user) return jsonError('User not found', 404)

  const files = await db.file.findMany({
    where: { ownerId: id },
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: {
      id: true, name: true, mimeType: true, size: true, status: true,
      starred: true, shareEnabled: true, downloads: true,
      deletedAt: true, createdAt: true, folderId: true,
    },
  })

  const [agg, sharedCount, trashedCount, folders] = await Promise.all([
    db.file.aggregate({ _count: { id: true }, _sum: { size: true }, where: { ownerId: id, deletedAt: null } }),
    db.file.count({ where: { ownerId: id, shareEnabled: true, deletedAt: null } }),
    db.file.count({ where: { ownerId: id, deletedAt: { not: null } } }),
    db.folder.findMany({ where: { ownerId: id }, select: { id: true, name: true } }),
  ])

  const folderMap = new Map(folders.map(f => [f.id, f.name]))

  return json({
    user,
    totals: {
      count: agg._count.id,
      totalSize: agg._sum.size ?? 0,
      shared: sharedCount,
      trashed: trashedCount,
    },
    files: files.map(f => ({
      ...f,
      createdAt: f.createdAt.toISOString(),
      deletedAt: f.deletedAt ? f.deletedAt.toISOString() : null,
      folderName: f.folderId ? folderMap.get(f.folderId) ?? null : null,
    })),
  })
}
