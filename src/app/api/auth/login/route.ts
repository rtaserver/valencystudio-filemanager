import { db } from '@/lib/db'
import { ensureBootstrap } from '@/lib/settings'
import { verifyPassword, logActivity, rateLimit, getClientIp, COOKIE_NAME, signToken, cookieOptions, getJwtSecret } from '@/lib/auth'
import { jsonError, readJson, setSessionCookie } from '@/lib/api-helpers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  await ensureBootstrap()
  const ip = getClientIp(req)
  const body = await readJson<{ email?: string; password?: string }>(req)
  const email = (body.email || '').trim().toLowerCase()
  const password = body.password || ''

  if (!rateLimit(`login:${ip}:${email}`, 10, 15 * 60_000)) {
    return jsonError('Too many login attempts. Try again in 15 minutes.', 429)
  }

  const user = await db.user.findUnique({ where: { email } })
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return jsonError('Invalid email or password.', 401)
  }
  if (!user.isActive) {
    return jsonError('This account has been deactivated. Contact an administrator.', 403)
  }

  const secret = await getJwtSecret()
  const token = signToken({ uid: user.id }, secret)
  await setSessionCookie(COOKIE_NAME, token, cookieOptions().maxAge, cookieOptions(req).secure)
  await logActivity(user.id, 'AUTH_LOGIN', `Signed in as ${email}`, ip)

  return Response.json({
    user: { id: user.id, email: user.email, name: user.name, role: user.role, quota: user.quota },
  })
}
