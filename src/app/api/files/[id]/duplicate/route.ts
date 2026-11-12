import { db } from '@/lib/db'
import { getSessionUser, logActivity, getClientIp } from '@/lib/auth'
import { jsonError } from '@/lib/api-helpers'
import { getUsedBytes } from '@/lib/files'
import { emitChanged, ROOM } from '@/lib/realtime-emit'
import { sendFileSummaryCard } from '@/lib/tg-meta'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/files/[id]/duplicate — create an instant copy of a READY file.
 * The copy REUSES the same storage parts JSON (Telegram parts / local parts are shared),
 * so duplication costs zero upload time and zero additional backend storage.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionUser(req)
  if (!session) return jsonError('Unauthorized', 401)
  const { id } = await params

  const file = await db.file.findUnique({ where: { id } })
  if (!file) return jsonError('Not found', 404)
  if (file.ownerId !== session.id) return jsonError('Forbidden', 403)
  if (file.deletedAt) return jsonError('Restore this file from the trash before duplicating it.', 409)
  if (file.status !== 'READY') return jsonError('Only fully uploaded files can be duplicated.', 400)

  // quota check for the user's own accounting (backend storage itself is shared)
  const user = await db.user.findUnique({ where: { id: session.id } })
  if (!user) return jsonError('Unauthorized', 401)
  if (user.quota !== -1) {
    const used = await getUsedBytes(user.id)
    if (used + file.size > user.quota) {
      return jsonError('Storage quota exceeded — duplicating would push you over your quota.', 413)
    }
  }

  // unique copy name: "report.pdf" → "report (copy).pdf" → "report (copy 2).pdf" …
  const dot = file.name.lastIndexOf('.')
  const base = dot > 0 ? file.name.slice(0, dot) : file.name
  const ext = dot > 0 ? file.name.slice(dot) : ''
  const taken = new Set(
    (
      await db.file.findMany({
        where: { ownerId: user.id, folderId: file.folderId, deletedAt: null, name: { startsWith: `${base} (copy` } },
        select: { name: true },
      })
    ).map(r => r.name)
  )
  let copyName = `${base} (copy)${ext}`
  let n = 2
  while (taken.has(copyName)) {
    copyName = `${base} (copy ${n})${ext}`
    n++
  }

  const created = await db.file.create({
    data: {
      ownerId: user.id,
      folderId: file.folderId,
      name: copyName.slice(0, 255),
      mimeType: file.mimeType,
      size: file.size,
      parts: file.parts, // shared storage — zero-copy
      status: 'READY',
    },
  })

  await logActivity(user.id, 'FILE_DUPLICATE', `Duplicated "${file.name}" → "${created.name}" (shared storage parts, 0 bytes transferred)`, getClientIp(req))
  // best-effort: the copy gets its own summary card pointing at the shared Telegram parts
  try {
    await sendFileSummaryCard(created, user, `Duplicated from "${file.name}" — shares the same storage parts (0 bytes transferred)`)
  } catch {}
  emitChanged(['files', 'activity'], { rooms: [ROOM.user(user.id), ROOM.admins] })

  return Response.json({
    ok: true,
    file: { id: created.id, name: created.name, size: created.size, folderId: created.folderId },
  })
}
