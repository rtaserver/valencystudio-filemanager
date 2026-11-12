import { db } from '@/lib/db'
import { getSessionUser, isPrivileged, logActivity, getClientIp } from '@/lib/auth'
import { jsonError } from '@/lib/api-helpers'
import { emitChanged, ROOM } from '@/lib/realtime-emit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionUser(req)
  if (!session) return jsonError('Unauthorized', 401)
  const { id } = await params
  const row = await db.downloadToken.findUnique({ where: { id }, include: { file: { select: { name: true } } } })
  if (!row) return jsonError('Not found', 404)
  if (row.userId !== session.id && !isPrivileged(session)) return jsonError('Forbidden', 403)
  if (row.revoked) return jsonError('This link is already revoked.', 409)
  await db.downloadToken.update({ where: { id }, data: { revoked: true } })
  await logActivity(session.id, 'FILE_LINK_REVOKE', `Revoked an expiring download link for "${row.file.name}"`, getClientIp(req))
  emitChanged(['tokens', 'activity'], { rooms: [ROOM.user(row.userId)] })
  return new Response(null, { status: 204 })
}
