import { getSessionUser, isPrivileged } from '@/lib/auth'
import { jsonError } from '@/lib/api-helpers'
import { detectChats } from '@/lib/telegram'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST() {
  const session = await getSessionUser()
  if (!session) return jsonError('Unauthorized', 401)
  if (!isPrivileged(session)) return jsonError('Forbidden', 403)
  if (session.role !== 'OWNER') return jsonError('Only the owner can run storage detection.', 403)

  try {
    const { chats, notice } = await detectChats()
    return Response.json({ ok: true, chats, notice })
  } catch (e: any) {
    return Response.json({ ok: false, error: e.message || 'Detection failed', chats: [] })
  }
}
