import { db } from '@/lib/db'
import { getSessionUser, logActivity, getClientIp } from '@/lib/auth'
import { jsonError, readJson } from '@/lib/api-helpers'
import { publicFile } from '@/lib/files'
import { emitChanged, ROOM } from '@/lib/realtime-emit'
import { sendFileSummaryCard } from '@/lib/tg-meta'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionUser(req)
  if (!session) return jsonError('Unauthorized', 401)
  const { id } = await params
  await readJson(req) // drain

  const file = await db.file.findUnique({ where: { id } })
  if (!file) return jsonError('File not found.', 404)
  if (file.ownerId !== session.id) return jsonError('Forbidden', 403)
  if (file.status === 'READY') return Response.json({ ok: true, file: publicFile(file) })

  let parts: { ref: string; size: number }[] = []
  try { parts = JSON.parse(file.parts || '[]') } catch {}
  const expectedTotal = file.size === 0 ? 0 : Math.ceil(file.size / (16 * 1024 * 1024))

  const complete = parts.length === expectedTotal && parts.every(p => p && p.ref)
  if (!complete) {
    return jsonError(`Upload incomplete: ${parts.filter(p => p && p.ref).length}/${expectedTotal} parts received. Resume the upload to finish.`, 409)
  }
  const totalBytes = parts.reduce((a, p) => a + p.size, 0)

  const updated = await db.file.update({
    where: { id },
    data: { status: 'READY' },
  })
  // best-effort: post the organized summary card into the Telegram storage chat
  // (8s internal timeout — never meaningfully delays the upload response)
  try {
    await sendFileSummaryCard(updated, session)
  } catch {}
  await logActivity(session.id, 'FILE_UPLOAD', `Uploaded "${file.name}" (${file.size} bytes in ${parts.length} part(s) → ${totalBytes} bytes stored)`, getClientIp(req))
  // realtime: storage meter + file lists update everywhere the moment an upload lands
  emitChanged(['files', 'activity'], { rooms: [ROOM.user(file.ownerId), ROOM.admins] })

  return Response.json({ ok: true, file: publicFile(updated) })
}
