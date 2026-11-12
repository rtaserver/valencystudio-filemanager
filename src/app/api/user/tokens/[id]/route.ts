import { db } from '@/lib/db'
import { getSessionUser, logActivity, getClientIp } from '@/lib/auth'
import { jsonError } from '@/lib/api-helpers'
import { emitChanged, ROOM } from '@/lib/realtime-emit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** DELETE /api/user/tokens/[id] — revoke a personal API token */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionUser(req)
  if (!session) return jsonError('Unauthorized', 401)
  const { id } = await params
  const token = await db.apiToken.findUnique({ where: { id } })
  if (!token || token.userId !== session.id) return jsonError('Token not found.', 404)
  if (!token.revoked) {
    await db.apiToken.update({ where: { id }, data: { revoked: true } })
    await logActivity(session.id, 'API_TOKEN_REVOKE', `Revoked API token "${token.name}"`, getClientIp(req))
    emitChanged(['tokens'], { rooms: [ROOM.user(session.id)] })
  }
  return Response.json({ ok: true })
}
