import { db } from '@/lib/db'
import { getSessionUser, isPrivileged } from '@/lib/auth'
import { jsonError } from '@/lib/api-helpers'
import { getSettings } from '@/lib/settings'
import { getMe } from '@/lib/telegram'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getSessionUser()
  if (!session) return jsonError('Unauthorized', 401)
  if (!isPrivileged(session)) return jsonError('Forbidden', 403)

  const now = Date.now()
  const dayMs = 24 * 60 * 60 * 1000
  const todayStart = new Date(now - (now % dayMs))
  const weekStart = new Date(now - 7 * dayMs)
  const monthStart = new Date(now - 30 * dayMs)

  const [users, filesReady, storageAgg, downloadsTotal, downloadsToday, downloadsWeek] = await Promise.all([
    db.user.count(),
    db.file.count({ where: { status: 'READY' } }),
    db.file.aggregate({ where: { status: 'READY' }, _sum: { size: true } }),
    db.downloadLog.count(),
    db.downloadLog.count({ where: { createdAt: { gte: todayStart } } }),
    db.downloadLog.count({ where: { createdAt: { gte: weekStart } } }),
  ])

  // daily series for last 30 days
  const [recentFiles, recentDownloads] = await Promise.all([
    db.file.findMany({ where: { createdAt: { gte: monthStart } }, select: { createdAt: true, size: true, deletedAt: true, status: true }, orderBy: { createdAt: 'asc' } }),
    db.downloadLog.findMany({ where: { createdAt: { gte: monthStart } }, select: { createdAt: true } }),
  ])

  const days: string[] = []
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now - i * dayMs)
    days.push(d.toISOString().slice(0, 10))
  }
  const uploadsByDay = new Map(days.map(d => [d, 0]))
  const downloadsByDay = new Map(days.map(d => [d, 0]))
  const bytesByDay = new Map(days.map(d => [d, 0]))
  for (const f of recentFiles) {
    const k = f.createdAt.toISOString().slice(0, 10)
    if (uploadsByDay.has(k)) uploadsByDay.set(k, (uploadsByDay.get(k) || 0) + 1)
    if (bytesByDay.has(k) && f.status === 'READY' && !f.deletedAt) {
      bytesByDay.set(k, (bytesByDay.get(k) || 0) + f.size)
    }
  }
  for (const d of recentDownloads) {
    const k = d.createdAt.toISOString().slice(0, 10)
    if (downloadsByDay.has(k)) downloadsByDay.set(k, (downloadsByDay.get(k) || 0) + 1)
  }
  // cumulative storage growth (live bytes added per day, running total)
  let cumulative = 0
  const series = days.map(d => {
    cumulative += bytesByDay.get(d) || 0
    return { date: d, uploads: uploadsByDay.get(d) || 0, downloads: downloadsByDay.get(d) || 0, storageBytes: cumulative }
  })

  // top users by storage
  const grouped = await db.file.groupBy({ by: ['ownerId'], where: { status: 'READY' }, _sum: { size: true }, _count: { id: true }, orderBy: { _sum: { size: 'desc' } }, take: 5 })
  const topUsers = await Promise.all(grouped.map(async g => {
    const u = await db.user.findUnique({ where: { id: g.ownerId }, select: { email: true, name: true, role: true } })
    return { email: u?.email || 'unknown', name: u?.name, role: u?.role || 'USER', storage: g._sum.size || 0, files: g._count.id }
  }))

  const recentActivity = await db.activityLog.findMany({ orderBy: { createdAt: 'desc' }, take: 12, include: { user: { select: { email: true, name: true } } } })
  const recentFileRows = await db.file.findMany({ orderBy: { createdAt: 'desc' }, take: 6, select: { id: true, name: true, size: true, createdAt: true, owner: { select: { email: true, name: true } } } })

  const settings = await getSettings()
  let botUsername: string | null = null
  try {
    const me = await getMe()
    botUsername = me.username
  } catch {}

  return Response.json({
    stats: {
      users,
      files: filesReady,
      storage: storageAgg._sum.size || 0,
      downloadsTotal,
      downloadsToday,
      downloadsWeek,
    },
    series,
    topUsers,
    recentActivity: recentActivity.map(a => ({ id: a.id, action: a.action, detail: a.detail, createdAt: a.createdAt, userEmail: a.user?.email || null })),
    recentFiles: recentFileRows.map(f => ({ id: f.id, name: f.name, size: f.size, createdAt: f.createdAt, owner: f.owner?.name || f.owner?.email || 'unknown' })),
    storageHealth: {
      backend: settings.storageBackend,
      storageChatId: settings.tgStorageChatId,
      botUsername,
      configured: settings.storageBackend === 'local' || (!!settings.tgBotToken && !!settings.tgStorageChatId),
    },
  })
}
