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

  const files = await db.file.findMany({
    where: q ? { name: { contains: q } } : {},
    orderBy: { createdAt: 'desc' },
    take: 300,
    select: { id: true, name: true, size: true, mimeType: true, status: true, downloads: true, createdAt: true, shareEnabled: true, deletedAt: true, owner: { select: { email: true, name: true, role: true } } },
  })

  return Response.json({ files })
}
