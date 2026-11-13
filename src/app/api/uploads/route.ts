import { randomBytes } from 'crypto'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/auth'
import { getSettings } from '@/lib/settings'
import { getUsedBytes } from '@/lib/files'
import { ownedFolder } from '@/lib/folders'
import { jsonError, readJson } from '@/lib/api-helpers'
import { emitChanged, ROOM } from '@/lib/realtime-emit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const PART_SIZE = 512 * 1024
const MAX_PARTS = 4000
const MAX_BYTES = 2_000_000_000
const EXPIRY_MS = 2 * 60 * 60 * 1000
const telegramFileId = () => (randomBytes(8).readBigUInt64BE() & BigInt('9223372036854775807')).toString()

export async function POST(req: Request) {
  const user = await getSessionUser(req)
  if (!user) return jsonError('Unauthorized', 401)
  const body = await readJson<{ name?: string; size?: number; mimeType?: string; folderId?: string | null }>(req)
  const name = (typeof body.name === 'string' ? body.name.trim() : '').slice(0, 255)
  const size = body.size
  if (!name || !Number.isSafeInteger(size) || !size || size < 1 || size > MAX_BYTES) return jsonError('Invalid upload metadata or file size.', 413)
  const settings = await getSettings()
  if (settings.storageBackend !== 'telegram') return jsonError('Multipart Telethon upload requires Telegram storage.', 409)
  if (size > settings.maxFileSize) return jsonError('File exceeds configured limit.', 413)
  const totalParts = Math.ceil(size / PART_SIZE)
  if (totalParts > MAX_PARTS) return jsonError('File exceeds the supported 4,000 Telegram part limit.', 413)
  const active = await db.uploadSession.count({ where: { ownerId: user.id, status: { in: ['UPLOADING', 'FINALIZING'] }, expiresAt: { gt: new Date() } } })
  if (active >= 3) return jsonError('Too many active uploads; finish or cancel one first.', 429)
  let folderId: string | null = null
  if (body.folderId) {
    const folder = await ownedFolder(body.folderId, user.id)
    if (!folder) return jsonError('Target folder not found.', 404)
    folderId = folder.id
  }
  if (user.quota !== -1 && await getUsedBytes(user.id) + size > user.quota) return jsonError('Storage quota exceeded.', 413)
  const session = await db.$transaction(async tx => {
    const file = await tx.file.create({ data: { ownerId: user.id, name, size, mimeType: (body.mimeType || 'application/octet-stream').slice(0, 120), status: 'PENDING', folderId } })
    return tx.uploadSession.create({ data: { ownerId: user.id, fileId: file.id, telegramFileId: telegramFileId(), partSize: PART_SIZE, totalParts, expiresAt: new Date(Date.now() + EXPIRY_MS) } })
  })
  emitChanged(['files'], { rooms: [ROOM.user(user.id)] })
  return Response.json({ id: session.id, fileId: session.fileId, partSize: PART_SIZE, totalParts, expiresAt: session.expiresAt })
}

export async function GET(req: Request) {
  const user = await getSessionUser(req)
  if (!user) return jsonError('Unauthorized', 401)
  const sessions = await db.uploadSession.findMany({
    where: { ownerId: user.id, status: 'UPLOADING', expiresAt: { gt: new Date() } },
    select: { id: true, fileId: true, totalParts: true, partSize: true, expiresAt: true, file: { select: { name: true, size: true, mimeType: true, folderId: true } }, parts: { where: { status: 'COMMITTED' }, select: { index: true, sha256: true, size: true } } },
  })
  return Response.json({ uploads: sessions.map(s => ({ id: s.id, fileId: s.fileId, totalParts: s.totalParts, partSize: s.partSize, expiresAt: s.expiresAt, name: s.file.name, size: s.file.size, mimeType: s.file.mimeType, folderId: s.file.folderId, parts: s.parts })) })
}
