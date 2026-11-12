import { db } from '@/lib/db'
import { jsonError } from '@/lib/api-helpers'
import { getSettings } from '@/lib/settings'
import { isShareExpired, isShareExhausted, shareRemaining } from '@/lib/share'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const file = await db.file.findUnique({
    where: { shareSlug: slug },
    select: { name: true, size: true, mimeType: true, createdAt: true, downloads: true, shareEnabled: true, sharePassword: true, shareExpiresAt: true, shareMaxDownloads: true, shareDownloadCount: true, status: true, deletedAt: true, owner: { select: { name: true, email: true } } },
  })
  if (!file || !file.shareEnabled || file.status !== 'READY' || file.deletedAt) {
    return jsonError('This file is not available. The link may have been revoked.', 404)
  }
  if (isShareExpired(file.shareExpiresAt)) {
    return jsonError('This share link has expired.', 410)
  }
  if (isShareExhausted(file)) {
    return jsonError('This file reached its download limit.', 410)
  }
  const settings = await getSettings()
  return Response.json({
    file: {
      name: file.name,
      size: file.size,
      mimeType: file.mimeType,
      createdAt: file.createdAt,
      downloads: file.downloads,
      hasPassword: !!file.sharePassword,
      remainingDownloads: shareRemaining(file),
      ownerName: file.owner?.name || file.owner?.email?.split('@')[0] || 'Anonymous',
    },
    site: { siteName: settings.siteName },
  })
}
