import { getSessionUser, isPrivileged, logActivity, getClientIp } from '@/lib/auth'
import { getSettings, getSettingsRaw, setSettings } from '@/lib/settings'
import { jsonError, readJson } from '@/lib/api-helpers'
import { emitChanged } from '@/lib/realtime-emit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const STORAGE_KEYS = ['tgBotToken', 'tgApiId', 'tgApiHash', 'tgAdminIds', 'tgStorageChatId', 'storageBackend']

function maskSecret(v: string): string {
  if (!v) return ''
  if (v.length <= 8) return '••••••••'
  return v.slice(0, 4) + '••••••••••••' + v.slice(-4)
}

export async function GET() {
  const session = await getSessionUser()
  if (!session) return jsonError('Unauthorized', 401)
  if (!isPrivileged(session)) return jsonError('Forbidden', 403)
  const s = await getSettings()
  const isOwner = session.role === 'OWNER'
  let botUsername: string | null = null
  try {
    const { getMe } = await import('@/lib/telegram')
    botUsername = (await getMe()).username
  } catch {}
  return Response.json({
    settings: {
      siteName: s.siteName,
      siteDescription: s.siteDescription,
      announcement: s.announcement,
      allowRegistration: s.allowRegistration,
      defaultQuota: s.defaultQuota,
      maxFileSize: s.maxFileSize,
      storageBackend: s.storageBackend,
      tgBotToken: isOwner ? s.tgBotToken : maskSecret(s.tgBotToken),
      tgApiId: s.tgApiId,
      tgApiHash: isOwner ? s.tgApiHash : maskSecret(s.tgApiHash),
      tgAdminIds: s.tgAdminIds,
      tgStorageChatId: s.tgStorageChatId,
    },
    isOwner,
    botUsername,
  })
}

export async function PUT(req: Request) {
  const session = await getSessionUser()
  if (!session) return jsonError('Unauthorized', 401)
  if (!isPrivileged(session)) return jsonError('Forbidden', 403)
  const isOwner = session.role === 'OWNER'
  const body = await readJson<Record<string, unknown>>(req)
  const patch: Record<string, string> = {}

  const siteKeys = ['siteName', 'siteDescription', 'announcement'] as const
  for (const k of siteKeys) {
    if (typeof body[k] === 'string') patch[k] = (body[k] as string).slice(0, 500)
  }
  if (typeof body.allowRegistration === 'boolean') patch.allowRegistration = String(body.allowRegistration)
  if (typeof body.defaultQuota === 'number' && body.defaultQuota > 0) patch.defaultQuota = String(Math.floor(body.defaultQuota))
  if (typeof body.maxFileSize === 'number' && body.maxFileSize > 1024) patch.maxFileSize = String(Math.floor(body.maxFileSize))

  if (isOwner) {
    const raw = await getSettingsRaw()
    for (const k of STORAGE_KEYS) {
      if (typeof body[k] !== 'string') continue
      const val = body[k] as string
      if (val.includes('••••')) continue // masked value sent back unchanged
      if (k === 'storageBackend' && val !== 'telegram' && val !== 'local') continue
      patch[k] = val.trim()
    }
    if (patch.tgBotToken === '') delete patch.tgBotToken
    void raw
  }

  if (Object.keys(patch).length === 0) return jsonError('Nothing to update.')
  await setSettings(patch)
  await logActivity(session.id, 'ADMIN_SETTINGS_UPDATE', `Updated settings: ${Object.keys(patch).join(', ')}`, getClientIp(req))
  // realtime: site name / announcement / limits propagate to every open session
  emitChanged(['settings'], { all: true })
  return Response.json({ ok: true })
}
