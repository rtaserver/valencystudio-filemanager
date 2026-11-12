import { db } from '@/lib/db'
import { getSessionUser, isPrivileged } from '@/lib/auth'
import { jsonError } from '@/lib/api-helpers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const session = await getSessionUser()
  if (!session) return jsonError('Unauthorized', 401)
  if (!isPrivileged(session)) return jsonError('Forbidden', 403)

  const url = new URL(req.url)
  const q = (url.searchParams.get('q') || '').trim().slice(0, 100)

  const where: any = q
    ? { OR: [{ email: { contains: q } }, { name: { contains: q } }] }
    : {}

  const users = await db.user.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: { id: true, email: true, name: true, role: true, quota: true, isActive: true, createdAt: true, _count: { select: { files: true } } },
  })

  const usage = await db.file.groupBy({ by: ['ownerId'], where: { status: 'READY' }, _sum: { size: true } })
  const usageMap = new Map(usage.map(u => [u.ownerId, u._sum.size || 0]))

  return Response.json({
    users: users.map(u => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      quota: u.quota,
      isActive: u.isActive,
      createdAt: u.createdAt,
      files: u._count.files,
      usedBytes: usageMap.get(u.id) || 0,
    })),
    currentUserId: session.id,
  })
}
