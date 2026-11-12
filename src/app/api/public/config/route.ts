import { ensureBootstrap, getSettings } from '@/lib/settings'
import { getMe } from '@/lib/telegram'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  await ensureBootstrap()
  const s = await getSettings()
  let botUsername: string | null = null
  try {
    botUsername = (await getMe()).username
  } catch {}
  return Response.json({
    siteName: s.siteName,
    siteDescription: s.siteDescription,
    announcement: s.announcement,
    allowRegistration: s.allowRegistration,
    botUsername,
  })
}
