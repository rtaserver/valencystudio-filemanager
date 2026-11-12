/**
 * tg-meta.ts — assembles upload metadata (uploader, folder path, site name) and
 * keeps each file's Telegram summary card in sync with the app's DB state.
 *
 * Card lifecycle:
 *   complete/duplicate  → sendFileSummaryCard()  (stores message id on the File row)
 *   rename/move/trash/restore/share → syncFileSummary() (editMessageText, best effort)
 *   purge               → deleteFileSummary()    (deleteMessage, best effort)
 *
 * Everything here is best-effort: a Telegram outage must NEVER break an app
 * operation, so callers can safely fire-and-forget.
 */
import { db } from '@/lib/db'
import { getSettings } from '@/lib/settings'
import { sendStorageSummary, editStorageSummary, deleteTelegramMessage } from '@/lib/telegram'
import { buildSummaryText, type SummaryMeta } from '@/lib/telegram-captions'

/** Walk up the folder tree and produce a display path like "Photos / 2025" (null = root) */
export async function getFolderPath(folderId: string | null | undefined): Promise<string | null> {
  if (!folderId) return null
  const names: string[] = []
  let cur: { name: string; parentId: string | null } | null = await db.folder.findUnique({
    where: { id: folderId },
    select: { name: true, parentId: true },
  })
  let guard = 0
  while (cur && guard < 16) {
    names.unshift(cur.name)
    if (!cur.parentId) break
    cur = await db.folder.findUnique({ where: { id: cur.parentId }, select: { name: true, parentId: true } })
    guard++
  }
  return names.length ? names.join(' / ') : null
}

export interface FileLike {
  id: string
  name: string
  mimeType: string
  size: number
  folderId?: string | null
  createdAt: Date
  shareEnabled?: boolean
  deletedAt?: Date | null
  parts?: string
  tgSummaryMessageId?: number | null
}

export interface UploaderLike {
  id?: string
  name?: string | null
  email?: string | null
}

export function buildSummaryMeta(
  file: FileLike,
  uploader: UploaderLike | null,
  siteName: string,
  folderPath: string | null,
  extra?: { note?: string | null }
): SummaryMeta {
  let partCount = 0
  try { partCount = (JSON.parse(file.parts || '[]') as { ref?: string }[]).filter(p => p && p.ref).length } catch {}
  return {
    fileName: file.name,
    fileSize: file.size,
    partCount,
    mimeType: file.mimeType,
    folderPath,
    uploaderName: uploader?.name || uploader?.email || 'Unknown',
    uploaderEmail: uploader?.email || null,
    fileId: file.id,
    siteName,
    uploadedAt: file.createdAt,
    trashed: !!file.deletedAt,
    shared: !!file.shareEnabled,
    note: extra?.note || null,
  }
}

/**
 * Post the summary card for a file into the storage chat and remember its message id.
 * Safe to call for non-telegram backends (returns null silently). Throws only on
 * unexpected bugs — route callers should still wrap in try/catch.
 */
export async function sendFileSummaryCard(
  file: FileLike,
  uploader: UploaderLike | null,
  note?: string | null
): Promise<number | null> {
  const settings = await getSettings()
  if (settings.storageBackend !== 'telegram' || !settings.tgStorageChatId) return null
  const folderPath = await getFolderPath(file.folderId)
  const meta = buildSummaryMeta(file, uploader, settings.siteName || '', folderPath, { note })
  const messageId = await sendStorageSummary(meta)
  if (messageId) {
    await db.file.update({ where: { id: file.id }, data: { tgSummaryMessageId: messageId } }).catch(() => {})
  }
  return messageId
}

/**
 * Re-render a file's existing summary card from current DB state (name, folder,
 * trash status, share status). No-op when the file has no card or Telegram is not
 * the active backend. Returns true when the card was updated.
 */
export async function syncFileSummary(fileId: string): Promise<boolean> {
  try {
    const file = await db.file.findUnique({
      where: { id: fileId },
      include: { owner: { select: { name: true, email: true } } },
    })
    if (!file?.tgSummaryMessageId) return false
    const settings = await getSettings()
    if (settings.storageBackend !== 'telegram' || !settings.tgStorageChatId) return false
    const folderPath = await getFolderPath(file.folderId)
    const meta = buildSummaryMeta(file, file.owner, settings.siteName || '', folderPath)
    return await editStorageSummary(settings.tgStorageChatId, file.tgSummaryMessageId, meta)
  } catch {
    return false
  }
}

/** Best-effort removal of a file's summary card (used on permanent purge) */
export async function deleteFileSummary(file: { tgSummaryMessageId?: number | null }): Promise<void> {
  if (!file.tgSummaryMessageId) return
  try {
    const settings = await getSettings()
    if (settings.tgStorageChatId) {
      await deleteTelegramMessage(settings.tgStorageChatId, file.tgSummaryMessageId)
    }
  } catch {
    // best effort
  }
}
