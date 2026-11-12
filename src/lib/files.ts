import { db } from '@/lib/db'
import { deletePart, cacheInvalidate } from '@/lib/storage'
import { parseParts } from '@/lib/download'
import { logActivity } from '@/lib/auth'
import { deleteFileSummary, syncFileSummary } from '@/lib/tg-meta'

export const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

export async function getUsedBytes(userId: string): Promise<number> {
  const agg = await db.file.aggregate({
    where: { ownerId: userId, status: 'READY', deletedAt: null }, // trashed files free the quota (30-day retention caps abuse)
    _sum: { size: true },
  })
  return agg._sum.size || 0
}

export function publicFile(f: {
  id: string
  name: string
  mimeType: string
  size: number
  status: string
  shareEnabled: boolean
  shareSlug: string
  sharePassword: string | null
  shareExpiresAt?: Date | null
  shareMaxDownloads?: number | null
  shareDownloadCount?: number
  downloads: number
  starred?: boolean
  deletedAt?: Date | null
  createdAt: Date
  updatedAt: Date
  folderId?: string | null
  parts?: string
}) {
  let partCount = 0
  try { partCount = JSON.parse(f.parts || '[]').length } catch {}
  return {
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    size: f.size,
    status: f.status,
    folderId: f.folderId ?? null,
    starred: f.starred ?? false,
    shareEnabled: f.shareEnabled,
    shareSlug: f.shareSlug,
    shareHasPassword: !!f.sharePassword,
    shareExpiresAt: f.shareExpiresAt ?? null,
    shareMaxDownloads: f.shareMaxDownloads ?? null,
    shareDownloadCount: f.shareDownloadCount ?? 0,
    downloads: f.downloads,
    partCount,
    deletedAt: f.deletedAt ?? null,
    createdAt: f.createdAt,
    updatedAt: f.updatedAt,
  }
}

/**
 * Delete a file: removes parts from the storage backend (best effort), then the DB row (cascades logs).
 *
 * STORAGE-SAFE: zero-copy duplicates SHARE the same storage part refs, so before deleting
 * a part message we check whether ANY other file row still references it (any status —
 * trashed files keep their parts for restore). Shared refs are kept in storage and only
 * dropped from the in-memory cache; orphaned refs are physically deleted.
 */
export async function deleteFileCompletely(fileId: string, actorId: string | null, actorRole: string) {
  const file = await db.file.findUnique({ where: { id: fileId } })
  if (!file) return false
  const parts = parseParts(file.parts)
  if (parts.length > 0) {
    const others = await db.file.findMany({ where: { id: { not: fileId } }, select: { parts: true } })
    const shared = new Set<string>()
    for (const o of others) {
      let ps: { ref?: string }[] = []
      try { ps = JSON.parse(o.parts || '[]') } catch {}
      for (const p of ps) if (p && p.ref) shared.add(p.ref)
    }
    for (const p of parts) {
      if (shared.has(p.ref)) {
        cacheInvalidate(p.ref) // another file still owns this storage message — drop only the cache
      } else {
        await deletePart(p.ref)
      }
    }
  }
  await deleteFileSummary(file) // remove the Telegram summary card too (best effort)
  await db.file.delete({ where: { id: fileId } })
  const suffix = actorRole === 'SYSTEM' ? ' [system]' : actorRole !== 'USER' ? ' [admin]' : ''
  await logActivity(actorId, 'FILE_DELETE', `Deleted "${file.name}" (${file.size} bytes)${suffix}`)
  return true
}

/** Soft-delete a file: hides it, kills share link, keeps data for restore */
export async function trashFile(fileId: string, actorId: string) {
  const file = await db.file.findUnique({ where: { id: fileId } })
  if (!file || file.deletedAt) return null
  const updated = await db.file.update({
    where: { id: fileId },
    data: { deletedAt: new Date(), shareEnabled: false },
  })
  void syncFileSummary(fileId) // Telegram card flips to "🗑 In trash" (best effort)
  await logActivity(actorId, 'FILE_TRASH', `Moved "${file.name}" to trash`)
  return updated
}

export async function restoreFile(fileId: string, actorId: string) {
  const file = await db.file.findUnique({ where: { id: fileId } })
  if (!file || !file.deletedAt) return null
  const updated = await db.file.update({
    where: { id: fileId },
    data: { deletedAt: null },
  })
  void syncFileSummary(fileId) // Telegram card flips back to "✅ Ready" (best effort)
  await logActivity(actorId, 'FILE_RESTORE', `Restored "${file.name}" from trash`)
  return updated
}

/** Lazily purge trash items older than the retention window (called from list endpoints, throttled) */
let lastTrashSweep = 0
export async function purgeExpiredTrash(force = false) {
  if (!force && Date.now() - lastTrashSweep < 10 * 60_000) return 0
  lastTrashSweep = Date.now()
  const cutoff = new Date(Date.now() - TRASH_RETENTION_MS)
  const expired = await db.file.findMany({ where: { deletedAt: { lt: cutoff } }, select: { id: true, name: true } })
  for (const f of expired) {
    try {
      await deleteFileCompletely(f.id, null, 'SYSTEM')
    } catch {}
  }
  return expired.length
}

/**
 * Sweep stale uploads: PENDING files that never completed (crash between init/complete,
 * abandoned client) older than 24h. Frees their partial storage parts and removes the rows.
 * Throttled to at most one scan per 10 minutes; called lazily from list endpoints.
 */
export const STALE_PENDING_MS = 24 * 60 * 60 * 1000
let lastPendingSweep = 0
export async function sweepStalePending(force = false) {
  if (!force && Date.now() - lastPendingSweep < 10 * 60_000) return 0
  lastPendingSweep = Date.now()
  const cutoff = new Date(Date.now() - STALE_PENDING_MS)
  const stale = await db.file.findMany({
    where: { status: 'PENDING', createdAt: { lt: cutoff } },
    select: { id: true, name: true },
  })
  for (const f of stale) {
    try {
      await deleteFileCompletely(f.id, null, 'SYSTEM')
      await logActivity(null, 'FILE_SWEEP', `Swept stale incomplete upload "${f.name}" (pending > 24h)`)
    } catch {}
  }
  return stale.length
}
