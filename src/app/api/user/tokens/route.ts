import { db } from '@/lib/db'
import { getSessionUser, logActivity, getClientIp } from '@/lib/auth'
import { jsonError, readJson } from '@/lib/api-helpers'
import { emitChanged, ROOM } from '@/lib/realtime-emit'
import { generateRawToken, hashToken, tokenPrefix } from '@/lib/api-token'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_TOKENS = 20

/** GET /api/user/tokens — list the current user's API tokens (no secrets) */
export async function GET(req: Request) {
  const session = await getSessionUser(req)
  if (!session) return jsonError('Unauthorized', 401)
  const tokens = await db.apiToken.findMany({
    where: { userId: session.id },
    orderBy: { createdAt: 'desc' },
  })
  return Response.json({
    tokens: tokens.map(t => ({
      id: t.id,
      name: t.name,
      prefix: t.prefix,
      createdAt: t.createdAt.toISOString(),
      lastUsedAt: t.lastUsedAt ? t.lastUsedAt.toISOString() : null,
      revoked: t.revoked,
    })),
  })
}

/** POST /api/user/tokens — create a token { name } → raw token returned ONCE */
export async function POST(req: Request) {
  const session = await getSessionUser(req)
  if (!session) return jsonError('Unauthorized', 401)
  const body = await readJson<{ name?: string }>(req)
  const name = (body.name || '').trim().slice(0, 60)
  if (!name) return jsonError('Token name is required.')

  const count = await db.apiToken.count({ where: { userId: session.id, revoked: false } })
  if (count >= MAX_TOKENS) return jsonError(`You already have ${MAX_TOKENS} active tokens. Revoke one first.`, 409)

  const raw = generateRawToken()
  const token = await db.apiToken.create({
    data: {
      userId: session.id,
      name,
      tokenHash: hashToken(raw),
      prefix: tokenPrefix(raw),
    },
  })
  await logActivity(session.id, 'API_TOKEN_CREATE', `Created API token "${name}"`, getClientIp(req))
  emitChanged(['tokens'], { rooms: [ROOM.user(session.id)] })
  return Response.json({
    token: {
      id: token.id,
      name: token.name,
      prefix: token.prefix,
      createdAt: token.createdAt.toISOString(),
      lastUsedAt: null,
      revoked: false,
    },
    // only ever returned here — stored as a hash afterwards
    secret: raw,
  })
}
