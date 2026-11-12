import { db } from '@/lib/db'
import { getSessionUser, isPrivileged } from '@/lib/auth'
import { jsonError } from '@/lib/api-helpers'
import { restoreFile } from '@/lib/files'
import { emitChanged, ROOM } from '@/lib/realtime-emit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionUser(req)
  if (!session) return jsonError('Unauthorized', 401)
  const { id } = await params
  const file = await db.file.findUnique({ where: { id }, select: { ownerId: true, deletedAt: true } })
  if (!file) return jsonError('Not found', 404)
  if (file.ownerId !== session.id && !isPrivileged(session)) return jsonError('Forbidden', 403)

  const restored = await restoreFile(id, session.id)
  if (!restored) return jsonError('File is not in the trash.', 409)
  emitChanged(['files', 'activity'], { rooms: [ROOM.user(file.ownerId), ROOM.admins] })
  return Response.json({ ok: true })
}
