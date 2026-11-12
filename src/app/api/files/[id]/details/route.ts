import { db } from '@/lib/db'
import { getSessionUser, isPrivileged } from '@/lib/auth'
import { jsonError } from '@/lib/api-helpers'
import { parseParts } from '@/lib/download'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionUser(req)
  if (!session) return jsonError('Unauthorized', 401)
  const { id } = await params
  const file = await db.file.findUnique({ where: { id } })
  if (!file || (file.ownerId !== session.id && !isPrivileged(session))) return jsonError('Not found', 404)

  const parts = parseParts(file.parts).map((p, i) => {
    const isTelethon = p.ref.startsWith('telethon:')
    const isTg = p.ref.startsWith('tg:')
    return {
      index: i,
      size: p.size,
      backend: isTelethon ? 'cloud object' : isTg ? 'distributed cloud' : 'local vault',
      refPreview: isTelethon
        ? `obj_${p.ref.slice('telethon:'.length)}`
        : isTg
          ? `blk_${p.ref.split(':')[1]?.slice(0, 12)}…`
          : p.ref,
    }
  })

  const downloads = await db.downloadLog.findMany({
    where: { fileId: id },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: { id: true, ip: true, userAgent: true, createdAt: true },
  })
  const totalDownloads = await db.downloadLog.count({ where: { fileId: id } })

  // 14-day downloads-per-day series for the mini chart
  const now = Date.now()
  const dayMs = 24 * 60 * 60 * 1000
  const since = new Date(now - 14 * dayMs)
  const recentLogDates = await db.downloadLog.findMany({
    where: { fileId: id, createdAt: { gte: since } },
    select: { createdAt: true },
  })
  const byDay = new Map<string, number>()
  const dayKeys: string[] = []
  for (let i = 13; i >= 0; i--) {
    const k = new Date(now - i * dayMs).toISOString().slice(0, 10)
    dayKeys.push(k)
    byDay.set(k, 0)
  }
  for (const l of recentLogDates) {
    const k = l.createdAt.toISOString().slice(0, 10)
    if (byDay.has(k)) byDay.set(k, (byDay.get(k) || 0) + 1)
  }
  const downloadsPerDay = dayKeys.map(k => ({ date: k, count: byDay.get(k) || 0 }))

  return Response.json({
    file: {
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      size: file.size,
      status: file.status,
      downloads: file.downloads,
      partCount: parts.length,
      shareEnabled: file.shareEnabled,
      shareHasPassword: !!file.sharePassword,
      shareExpiresAt: file.shareExpiresAt,
      shareMaxDownloads: file.shareMaxDownloads,
      shareDownloadCount: file.shareDownloadCount,
      deletedAt: file.deletedAt,
      createdAt: file.createdAt,
      updatedAt: file.updatedAt,
    },
    parts,
    downloads,
    totalDownloads,
    downloadsPerDay,
  })
}
