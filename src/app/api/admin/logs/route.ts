import { db } from '@/lib/db'
import { getSessionUser, isPrivileged } from '@/lib/auth'
import { jsonError } from '@/lib/api-helpers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const TYPE_FILTERS: Record<string, string[]> = {
  auth: ['AUTH_LOGIN', 'AUTH_REGISTER', 'AUTH_LOGOUT', 'AUTH_PROFILE_UPDATE'],
  upload: ['FILE_UPLOAD', 'FILE_UPLOAD_START'],
  download: ['FILE_DOWNLOAD'],
  share: ['FILE_SHARE', 'FILE_DELETE'],
  admin: ['ADMIN_USER_UPDATE', 'ADMIN_USER_DELETE', 'ADMIN_SETTINGS_UPDATE', 'ADMIN_TELEGRAM_TEST'],
}

export async function GET(req: Request) {
  const session = await getSessionUser()
  if (!session) return jsonError('Unauthorized', 401)
  if (!isPrivileged(session)) return jsonError('Forbidden', 403)

  const url = new URL(req.url)
  const type = url.searchParams.get('type') || 'all'
  const q = (url.searchParams.get('q') || '').trim().slice(0, 100)
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1') || 1)
  const limit = 50

  const where: any = {}
  if (TYPE_FILTERS[type]) where.action = { in: TYPE_FILTERS[type] }
  if (q) where.OR = [{ detail: { contains: q } }, { action: { contains: q } }]

  const [logs, total] = await Promise.all([
    db.activityLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: { user: { select: { email: true, name: true } } },
    }),
    db.activityLog.count({ where }),
  ])

  return Response.json({
    logs: logs.map(l => ({ id: l.id, action: l.action, detail: l.detail, ip: l.ip, createdAt: l.createdAt, userEmail: l.user?.email || null })),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / limit)),
  })
}
