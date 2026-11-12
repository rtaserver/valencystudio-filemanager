import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/auth'
import { jsonError } from '@/lib/api-helpers'
import { fileKind } from '@/lib/format'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Personal analytics: storage breakdown by file type for the signed-in user */
export async function GET(req: Request) {
  const session = await getSessionUser(req)
  if (!session) return jsonError('Unauthorized', 401)

  const files = await db.file.findMany({
    where: { ownerId: session.id, status: 'READY', deletedAt: null },
    select: { name: true, mimeType: true, size: true },
  })

  const groups = new Map<string, { type: string; count: number; size: number }>()
  for (const f of files) {
    const kind = fileKind(f.mimeType, f.name)
    const g = groups.get(kind) || { type: kind, count: 0, size: 0 }
    g.count++
    g.size += f.size
    groups.set(kind, g)
  }

  const byType = [...groups.values()].sort((a, b) => b.size - a.size)
  const totalSize = byType.reduce((a, g) => a + g.size, 0)
  const totalCount = byType.reduce((a, g) => a + g.count, 0)

  return Response.json({ byType, totalSize, totalCount })
}
