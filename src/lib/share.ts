import { getJwtSecret, verifyToken } from '@/lib/auth'

export function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.get('cookie') || ''
  const out: Record<string, string> = {}
  for (const pair of header.split(';')) {
    const idx = pair.indexOf('=')
    if (idx > 0) out[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim())
  }
  return out
}

export function shareCookieName(slug: string) {
  return `vs_share_${slug}`
}

/** Check whether the requester may access a password-protected shared file */
export async function hasShareAccess(req: Request, slug: string, sharePassword: string | null): Promise<boolean> {
  if (!sharePassword) return true
  const cookies = parseCookies(req)
  const token = cookies[shareCookieName(slug)]
  if (!token) return false
  const secret = await getJwtSecret()
  const payload = verifyToken(token, secret)
  return !!payload && payload.slug === slug
}

/** True when the share link has an expiry in the past */
export function isShareExpired(shareExpiresAt: Date | null | undefined): boolean {
  return !!shareExpiresAt && shareExpiresAt.getTime() <= Date.now()
}

/** Remaining public downloads for a share link (null = unlimited) */
export function shareRemaining(file: { shareMaxDownloads: number | null; shareDownloadCount: number }): number | null {
  if (file.shareMaxDownloads == null) return null
  return Math.max(0, file.shareMaxDownloads - file.shareDownloadCount)
}

/** True when the share link hit its download limit */
export function isShareExhausted(file: { shareMaxDownloads: number | null; shareDownloadCount: number }): boolean {
  return file.shareMaxDownloads != null && file.shareDownloadCount >= file.shareMaxDownloads
}
