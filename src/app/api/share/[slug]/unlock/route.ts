import { db } from '@/lib/db'
import { jsonError, readJson } from '@/lib/api-helpers'
import { getSettingsRaw, getJwtSecret } from '@/lib/settings'
import { hashSharePassword, signToken, cookieOptions, rateLimit, getClientIp } from '@/lib/auth'
import { setSessionCookie } from '@/lib/api-helpers'
import { shareCookieName, isShareExpired } from '@/lib/share'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const body = await readJson<{ password?: string }>(req)
  const file = await db.file.findUnique({ where: { shareSlug: slug }, select: { shareEnabled: true, sharePassword: true, shareExpiresAt: true, status: true } })
  if (!file || !file.shareEnabled || file.status !== 'READY') return jsonError('This file is not available.', 404)
  if (isShareExpired(file.shareExpiresAt)) return jsonError('This share link has expired.', 410)
  if (!file.sharePassword) return Response.json({ ok: true, unlocked: true })

  // brute-force guard on share passwords (10 tries / 15 min per ip+slug)
  if (!rateLimit(`share-unlock:${getClientIp(req)}:${slug}`, 10, 15 * 60_000)) {
    return jsonError('Too many attempts. Try again later.', 429)
  }

  const raw = await getSettingsRaw()
  const hash = hashSharePassword(body.password || '', raw.sharePasswordSalt || 'vsalt')
  if (hash !== file.sharePassword) return jsonError('Incorrect password.', 403)

  const secret = await getJwtSecret()
  const token = signToken({ slug }, secret)
  await setSessionCookie(shareCookieName(slug), token, 60 * 60, cookieOptions(req).secure) // 1 hour
  return Response.json({ ok: true, unlocked: true })
}
