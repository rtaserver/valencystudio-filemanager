import { db } from '@/lib/db'
import { ensureBootstrap, getSettings } from '@/lib/settings'
import { getSessionUser, isPrivileged } from '@/lib/auth'
import { getUsedBytes } from '@/lib/files'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  await ensureBootstrap()
  const settings = await getSettings()
  const user = await getSessionUser()
  if (!user) {
    return Response.json({
      user: null,
      site: {
        siteName: settings.siteName,
        siteDescription: settings.siteDescription,
        announcement: settings.announcement,
        allowRegistration: settings.allowRegistration,
      },
    })
  }
  const [fileCount, usedBytes] = await Promise.all([
    db.file.count({ where: { ownerId: user.id, status: 'READY', deletedAt: null } }), // matches My Files (trash excluded)
    getUsedBytes(user.id),
  ])
  return Response.json({
    user,
    isPrivileged: isPrivileged(user),
    stats: { fileCount, usedBytes },
    site: {
      siteName: settings.siteName,
      siteDescription: settings.siteDescription,
      announcement: settings.announcement,
      allowRegistration: settings.allowRegistration,
    },
  })
}
