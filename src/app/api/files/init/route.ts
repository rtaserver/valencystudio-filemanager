import { db } from '@/lib/db'
import { getSettings } from '@/lib/settings'
import { getSessionUser, logActivity, getClientIp } from '@/lib/auth'
import { jsonError, readJson } from '@/lib/api-helpers'
import { getUsedBytes } from '@/lib/files'
import { ownedFolder } from '@/lib/folders'
import { emitChanged, ROOM } from '@/lib/realtime-emit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const PART_SIZE = 16 * 1024 * 1024 // 16 MB — respects Bot API 50MB upload / 20MB getFile limits

export async function POST(req: Request) {
  const user = await getSessionUser(req)
  if (!user) return jsonError('Unauthorized', 401)
  const body = await readJson<{ name?: string; size?: number; mimeType?: string; folderId?: string | null }>(req)
  const name = (body.name || '').trim().slice(0, 255)
  const size = Math.max(0, Math.floor(Number(body.size) || 0))
  const mimeType = (body.mimeType || 'application/octet-stream').slice(0, 120)
  if (!name) return jsonError('File name is required.')
  if (!body.name && size === 0) return jsonError('Invalid upload.')

  // resolve target folder (null = My Files root)
  let folderId: string | null = null
  if (body.folderId) {
    const f = await ownedFolder(body.folderId, user.id)
    if (!f) return jsonError('Target folder not found.', 404)
    folderId = f.id
  }

  const settings = await getSettings()
  if (settings.storageBackend === 'telegram') {
    return jsonError('Telegram storage accepts single-document Telethon uploads only; multipart uploads are disabled.', 409)
  }
  if (size > settings.maxFileSize) {
    return jsonError(`File exceeds the maximum allowed size of ${Math.floor(settings.maxFileSize / 1024 / 1024)} MB.`, 413)
  }

  if (user.quota !== -1) {
    const used = await getUsedBytes(user.id)
    if (used + size > user.quota) {
      return jsonError('Storage quota exceeded. Delete some files or contact an administrator.', 413)
    }
  }

  // Duplicate hint (non-blocking): same name already ACTIVE in the same folder for this owner.
  // Only a warning — the upload proceeds; the UI surfaces a toast so the user can cancel early.
  const existing = await db.file.findFirst({
    where: { ownerId: user.id, name, folderId, deletedAt: null },
    select: { id: true, size: true },
  })

  const file = await db.file.create({
    data: { ownerId: user.id, name, size, mimeType, status: 'PENDING', folderId },
  })
  await logActivity(user.id, 'FILE_UPLOAD_START', `Started upload "${name}" (${size} bytes, ${Math.max(1, Math.ceil(size / PART_SIZE))} part(s))`, getClientIp(req))
  // realtime: PENDING row appears in lists for this user's other tabs immediately
  emitChanged(['files'], { rooms: [ROOM.user(user.id)] })

  return Response.json({
    id: file.id,
    partSize: PART_SIZE,
    shareSlug: file.shareSlug,
    duplicate: !!existing && existing.size === size,
  })
}
