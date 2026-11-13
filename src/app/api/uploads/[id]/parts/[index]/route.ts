import { createHash } from 'crypto'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/auth'
import { jsonError } from '@/lib/api-helpers'
import { uploadBigPart } from '@/lib/telethon'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function PUT(req: Request, { params }: { params: Promise<{ id: string; index: string }> }) {
  const user = await getSessionUser(req)
  if (!user) return jsonError('Unauthorized', 401)
  const { id, index: rawIndex } = await params
  const index = Number(rawIndex)
  if (!Number.isInteger(index) || index < 0) return jsonError('Invalid part index.')
  const session = await db.uploadSession.findUnique({ where: { id }, include: { file: true, parts: { where: { index } } } })
  if (!session || session.ownerId !== user.id) return jsonError('Upload not found.', 404)
  if (session.status !== 'UPLOADING' || session.expiresAt <= new Date() || session.file.deletedAt) return jsonError('Upload session is no longer active.', 409)
  if (index >= session.totalParts) return jsonError('Part index out of range.')
  const expectedSize = index === session.totalParts - 1 ? session.file.size - session.partSize * index : session.partSize
  if (Number(req.headers.get('content-length')) !== expectedSize) return jsonError('Part content-length does not match expected bytes.', 400)
  if (!req.body) return jsonError('Missing part body.', 400)
  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > expectedSize) {
        await reader.cancel('Part exceeds expected size').catch(() => {})
        return jsonError('Part exceeds expected size.', 413)
      }
      chunks.push(value)
    }
  } catch {
    return jsonError('Upload part request ended before the body was fully received.', 400)
  } finally { reader.releaseLock() }
  if (length !== expectedSize) return jsonError('Part is truncated.', 400)
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  const digest = createHash('sha256').update(bytes).digest('hex')
  const prior = session.parts[0]
  if (prior && (prior.sha256 !== digest || prior.size !== length)) return jsonError('A different payload was already recorded for this part.', 409)
  if (prior?.status === 'COMMITTED') return Response.json({ ok: true, index, duplicate: true })
  let claimed = false
  if (!prior) {
    try {
      await db.uploadPart.create({ data: { sessionId: id, index, size: length, sha256: digest, status: 'PENDING' } })
      claimed = true
    } catch {
      return jsonError('This part is being uploaded concurrently; retry shortly.', 409)
    }
  }
  if (prior?.status === 'PENDING') {
    const reclaim = await db.uploadPart.updateMany({
      where: { sessionId: id, index, sha256: digest, status: 'PENDING', createdAt: { lt: new Date(Date.now() - 2 * 60 * 1000) } },
      data: { createdAt: new Date() },
    })
    if (reclaim.count !== 1) return jsonError('This part is being uploaded concurrently; retry shortly.', 409)
    claimed = true
  }
  if (!claimed) return jsonError('This part is in an unknown state; retry status shortly.', 409)
  try {
    await uploadBigPart(session.telegramFileId, index, session.totalParts, bytes, req.signal)
    await db.uploadPart.updateMany({ where: { sessionId: id, index, sha256: digest, status: 'PENDING' }, data: { status: 'COMMITTED', createdAt: new Date() } })
    return Response.json({ ok: true, index, duplicate: !!prior })
  } catch (error) {
    // Keep the claim: a retry after the lease expires replays the same Telegram file ID/index.
    return jsonError(error instanceof Error ? error.message : 'Telegram part upload failed.', 502)
  }
}
