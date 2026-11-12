import { getClientIp, COOKIE_NAME, getSessionUser, logActivity } from '@/lib/auth'
import { setSessionCookie } from '@/lib/api-helpers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const user = await getSessionUser()
  if (user) await logActivity(user.id, 'AUTH_LOGOUT', undefined, getClientIp(req))
  await setSessionCookie(COOKIE_NAME, '', 0)
  return Response.json({ ok: true })
}
