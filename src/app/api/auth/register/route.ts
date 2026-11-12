import { db } from '@/lib/db'
import { ensureBootstrap, getSettings } from '@/lib/settings'
import { hashPassword, logActivity, rateLimit, getClientIp, COOKIE_NAME, signToken, cookieOptions, getJwtSecret } from '@/lib/auth'
import { jsonError, isValidEmail, readJson, setSessionCookie } from '@/lib/api-helpers'
import { emitChanged, ROOM } from '@/lib/realtime-emit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  await ensureBootstrap()
  const ip = getClientIp(req)
  const body = await readJson<{ email?: string; password?: string; name?: string }>(req)
  const email = (body.email || '').trim().toLowerCase()
  const password = body.password || ''
  const name = (body.name || '').trim().slice(0, 60) || null

  if (!rateLimit(`register:${ip}`, 10, 15 * 60_000)) return jsonError('Too many attempts. Try again later.', 429)
  if (!isValidEmail(email)) return jsonError('Please enter a valid email address.')
  if (password.length < 6) return jsonError('Password must be at least 6 characters.')

  const settings = await getSettings()
  if (!settings.allowRegistration) return jsonError('Registration is currently disabled by the administrator.', 403)

  const existing = await db.user.findUnique({ where: { email } })
  if (existing) return jsonError('An account with this email already exists.', 409)

  const user = await db.user.create({
    data: {
      email,
      passwordHash: hashPassword(password),
      name,
      role: 'USER',
      quota: settings.defaultQuota,
    },
  })

  const secret = await getJwtSecret()
  const token = signToken({ uid: user.id }, secret)
  await setSessionCookie(COOKIE_NAME, token, cookieOptions().maxAge, cookieOptions(req).secure)
  await logActivity(user.id, 'AUTH_REGISTER', `Registered account ${email}`, ip)
  // realtime: admin user tables + overview counters pick up the new account instantly
  emitChanged(['users', 'activity'], { rooms: [ROOM.admins] })

  return Response.json({
    user: { id: user.id, email: user.email, name: user.name, role: user.role, quota: user.quota },
  })
}
