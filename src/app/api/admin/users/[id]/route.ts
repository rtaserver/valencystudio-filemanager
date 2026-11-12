import { db } from '@/lib/db'
import { getSessionUser, isPrivileged, logActivity, getClientIp, hashPassword } from '@/lib/auth'
import { jsonError, readJson } from '@/lib/api-helpers'
import { deleteFileCompletely } from '@/lib/files'
import { emitChanged, ROOM } from '@/lib/realtime-emit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 600

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionUser()
  if (!session) return jsonError('Unauthorized', 401)
  if (!isPrivileged(session)) return jsonError('Forbidden', 403)
  const { id } = await params
  const body = await readJson<{ role?: string; quota?: number; isActive?: boolean; name?: string | null; password?: string }>(req)

  const target = await db.user.findUnique({ where: { id } })
  if (!target) return jsonError('User not found', 404)

  // role hierarchy protection
  if (session.role !== 'OWNER') {
    if (target.role === 'OWNER') return jsonError('Only the owner can modify the owner account.', 403)
    if (body.role && body.role !== 'USER') return jsonError('Only the owner can grant admin roles.', 403)
  }
  if (target.id === session.id && body.isActive === false) return jsonError('You cannot deactivate your own account.', 400)
  if (target.id === session.id && body.role && body.role !== session.role) return jsonError('You cannot change your own role.', 400)

  const data: { role?: string; quota?: number; isActive?: boolean; name?: string | null; passwordHash?: string } = {}
  if (body.role && ['USER', 'ADMIN', 'OWNER'].includes(body.role)) {
    if (body.role === 'OWNER' && session.role !== 'OWNER') return jsonError('Forbidden', 403)
    data.role = body.role
  }
  if (typeof body.quota === 'number') data.quota = Math.max(-1, Math.floor(body.quota))
  if (typeof body.isActive === 'boolean') data.isActive = body.isActive
  if (body.name !== undefined) data.name = body.name === null ? null : String(body.name).trim().slice(0, 60) || null
  if (typeof body.password === 'string' && body.password.length > 0) {
    if (body.password.length < 6) return jsonError('Password must be at least 6 characters.')
    if (target.role === 'OWNER' && session.role !== 'OWNER') return jsonError('Only the owner can reset the owner password.', 403)
    if (target.id === session.id) return jsonError('Use Account Settings to change your own password.', 400)
    data.passwordHash = hashPassword(body.password)
  }

  if (Object.keys(data).length === 0) return jsonError('Nothing to update.')

  const updated = await db.user.update({ where: { id }, data, select: { id: true, email: true, role: true, quota: true, isActive: true } })
  const changed = [
    data.role && `role=${data.role}`,
    data.quota !== undefined && `quota=${data.quota}`,
    data.isActive !== undefined && `active=${data.isActive}`,
    data.name !== undefined && `name=${data.name ?? 'null'}`,
    data.passwordHash && 'password=reset',
  ].filter(Boolean).join(', ')
  await logActivity(session.id, 'ADMIN_USER_UPDATE', `Updated ${target.email}: ${changed}`, getClientIp(req))
  // realtime: admins' tables refresh + the target user's own UI (quota/role/deactivation) reacts instantly
  emitChanged(['users', 'activity'], { rooms: [ROOM.admins, ROOM.user(id)] })
  return Response.json({ ok: true, user: updated })
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionUser()
  if (!session) return jsonError('Unauthorized', 401)
  if (!isPrivileged(session)) return jsonError('Forbidden', 403)
  const { id } = await params

  const target = await db.user.findUnique({ where: { id }, include: { files: true } })
  if (!target) return jsonError('User not found', 404)
  if (target.role === 'OWNER') return jsonError('The owner account cannot be deleted.', 403)
  if (target.id === session.id) return jsonError('You cannot delete your own account.', 400)
  if (target.role === 'ADMIN' && session.role !== 'OWNER') return jsonError('Only the owner can delete an admin.', 403)

  // best-effort remove stored parts, then cascade delete
  for (const f of target.files) {
    try { await deleteFileCompletely(f.id, session.id, session.role) } catch {}
  }
  await db.user.delete({ where: { id } }).catch(() => {})
  await logActivity(session.id, 'ADMIN_USER_DELETE', `Deleted user ${target.email} and their files`, getClientIp(req))
  // realtime: every admin panel updates; the deleted user's session collapses to landing on next beat
  emitChanged(['users', 'files', 'activity'], { rooms: [ROOM.admins, ROOM.user(id)] })
  return Response.json({ ok: true })
}
