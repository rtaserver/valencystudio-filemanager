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

function csvCell(value: unknown): string {
  const s = String(value ?? '')
  // escape quotes, wrap when needed, neutralize formula-injection prefixes
  if (/^[=+\-@]/.test(s)) return `'` + s.replace(/"/g, '""')
  return `"${s.replace(/"/g, '""')}"`
}

/** GET /api/admin/logs/export?same filters as /api/admin/logs → CSV download (cap 5000 rows) */
export async function GET(req: Request) {
  const session = await getSessionUser(req)
  if (!session) return jsonError('Unauthorized', 401)
  if (!isPrivileged(session)) return jsonError('Forbidden', 403)

  const url = new URL(req.url)
  const type = url.searchParams.get('type') || 'all'
  const q = (url.searchParams.get('q') || '').trim().slice(0, 100)

  const where: any = {}
  if (TYPE_FILTERS[type]) where.action = { in: TYPE_FILTERS[type] }
  if (q) where.OR = [{ detail: { contains: q } }, { action: { contains: q } }]

  const logs = await db.activityLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 5000,
    include: { user: { select: { email: true, name: true } } },
  })

  const header = ['id', 'timestamp', 'action', 'user', 'detail', 'ip']
  const lines = [header.join(',')]
  for (const l of logs) {
    lines.push(
      [
        csvCell(l.id),
        csvCell(l.createdAt.toISOString()),
        csvCell(l.action),
        csvCell(l.user?.email || ''),
        csvCell(l.detail || ''),
        csvCell(l.ip || ''),
      ].join(',')
    )
  }

  return new Response('\uFEFF' + lines.join('\r\n'), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="valencystudio-audit-logs-${new Date().toISOString().slice(0, 10)}.csv"`,
      'Cache-Control': 'no-store',
    },
  })
}
