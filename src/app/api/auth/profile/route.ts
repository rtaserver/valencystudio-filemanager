import { db } from '@/lib/db'
import { getSessionUser, hashPassword, logActivity, verifyPassword, getClientIp } from '@/lib/auth'
import { jsonError, readJson } from '@/lib/api-helpers'
import { emitChanged, ROOM } from '@/lib/realtime-emit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function PATCH(req: Request) {
  const user = await getSessionUser()
  if (!user) return jsonError('Unauthorized', 401)
  const body = await readJson<{ name?: string; currentPassword?: string; newPassword?: string }>(req)

  const data: { name?: string | null; passwordHash?: string } = {}
  if (typeof body.name === 'string') data.name = body.name.trim().slice(0, 60) || null

  if (body.newPassword) {
    if (body.newPassword.length < 6) return jsonError('New password must be at least 6 characters.')
    const full = await db.user.findUnique({ where: { id: user.id } })
    if (!full || !verifyPassword(body.currentPassword || '', full.passwordHash)) {
      return jsonError('Current password is incorrect.', 403)
    }
    data.passwordHash = hashPassword(body.newPassword)
  }

  if (Object.keys(data).length === 0) return jsonError('Nothing to update.')

  await db.user.update({ where: { id: user.id }, data })
  await logActivity(user.id, 'AUTH_PROFILE_UPDATE', 'Updated profile settings', getClientIp(req))
  // realtime: name changes reflect on every device of this user (+ admin user tables)
  emitChanged(['users'], { rooms: [ROOM.user(user.id), ROOM.admins] })
  return Response.json({ ok: true })
}
