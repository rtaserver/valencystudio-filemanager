import { db } from '@/lib/db'
import { jsonError } from '@/lib/api-helpers'
import { buildFileResponse } from '@/lib/download'
import { hasShareAccess, isShareExpired, isShareExhausted } from '@/lib/share'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const file = await db.file.findUnique({ where: { shareSlug: slug } })
  if (!file || !file.shareEnabled || file.status !== 'READY' || file.deletedAt) {
    return jsonError('This file is not available. The link may have been revoked.', 404)
  }
  if (isShareExpired(file.shareExpiresAt)) {
    return jsonError('This share link has expired.', 410)
  }
  if (isShareExhausted(file)) {
    return jsonError('This file reached its download limit.', 410)
  }
  if (!(await hasShareAccess(req, slug, file.sharePassword))) {
    return jsonError('This file is password protected.', 401)
  }
  return buildFileResponse(req, { name: file.name, mimeType: file.mimeType, size: file.size, parts: file.parts }, 'inline')
}
