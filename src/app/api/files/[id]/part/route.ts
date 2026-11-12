import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/auth'
import { putPart, StoredPart } from '@/lib/storage'
import { jsonError } from '@/lib/api-helpers'
import { getSettings } from '@/lib/settings'
import { getFolderPath } from '@/lib/tg-meta'
import type { PartMeta } from '@/lib/telegram-captions'
import { createHash } from 'crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

// per-file lock to serialize parts JSON read-modify-write under concurrent uploads
const locks = new Map<string, Promise<unknown>>()
async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) || Promise.resolve()
  const p = prev.then(fn, fn)
  locks.set(key, p.catch(() => {}))
  return p
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionUser(req)
  if (!session) return jsonError('Unauthorized', 401)
  const { id } = await params
  const url = new URL(req.url)
  const index = parseInt(url.searchParams.get('index') || '')
  if (isNaN(index) || index < 0 || index > 100_000) return jsonError('Invalid part index.')

  const file = await db.file.findUnique({ where: { id } })
  if (!file) return jsonError('File not found.', 404)
  if (file.ownerId !== session.id) return jsonError('Forbidden', 403)
  if (file.status === 'READY') return Response.json({ ok: true, alreadyDone: true })

  const settings = await getSettings()
  if (settings.storageBackend === 'telegram') {
    return jsonError('Telegram storage requires one Telethon document; multipart part uploads are disabled.', 409)
  }

  const expectedTotal = file.size === 0 ? 0 : Math.ceil(file.size / (16 * 1024 * 1024))
  if (index >= expectedTotal) return jsonError('Part index out of range.')

  const buffer = Buffer.from(await req.arrayBuffer())

  // rich Telegram caption metadata (uploader, folder, checksum) — only built when the
  // parts are destined for Telegram; the local backend ignores it
  let meta: PartMeta | undefined
  // cast to string to avoid a TypeScript control-flow/narrowing false-positive when
  // earlier branches may have narrowed `settings.storageBackend` to the other literal.
  if ((settings.storageBackend as string) === 'telegram' && settings.tgStorageChatId) {
    const folderPath = await getFolderPath(file.folderId)
    meta = {
      fileName: file.name,
      partIndex: index,
      partTotal: expectedTotal || 1,
      partSize: buffer.length,
      fileSize: file.size,
      mimeType: file.mimeType,
      folderPath,
      uploaderName: session.name || session.email,
      uploaderEmail: session.email,
      checksum: createHash('sha256').update(buffer).digest('hex'),
      fileId: file.id,
      siteName: settings.siteName,
      uploadedAt: file.createdAt,
    }
  }

  const part: StoredPart = await putPart(buffer, index, expectedTotal, file.name, meta)

  const result = await withLock(id, async () => {
    const fresh = await db.file.findUnique({ where: { id }, select: { parts: true } })
    if (!fresh) throw new Error('File vanished')
    let parts: StoredPart[] = []
    try { parts = JSON.parse(fresh.parts || '[]') } catch {}
    if (parts[index]?.ref) return { duplicate: true, count: parts.filter(p => p?.ref).length }
    while (parts.length < index) parts.push({ ref: '', size: 0 }) // keep indexes aligned
    parts[index] = part
    await db.file.update({ where: { id }, data: { parts: JSON.stringify(parts) } })
    return { duplicate: false, count: parts.filter(p => p?.ref).length }
  })

  return Response.json({ ok: true, index, received: result.count, total: expectedTotal, duplicate: result.duplicate })
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  // resume support: which parts are already uploaded
  const session = await getSessionUser(req)
  if (!session) return jsonError('Unauthorized', 401)
  const { id } = await params
  const file = await db.file.findUnique({ where: { id }, select: { parts: true, ownerId: true, size: true, status: true } })
  if (!file || file.ownerId !== session.id) return jsonError('Not found', 404)
  let done: number[] = []
  try {
    done = (JSON.parse(file.parts) as StoredPart[]).map((p, i) => (p && p.ref ? i : -1)).filter(i => i >= 0)
  } catch {}
  return Response.json({ done, total: file.size === 0 ? 0 : Math.ceil(file.size / (16 * 1024 * 1024)), status: file.status })
}
