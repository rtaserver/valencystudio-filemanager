/**
 * telegram-captions.ts — pure, dependency-free builders for the messages the bot
 * posts into the Telegram storage group.
 *
 * Every uploaded file is represented in Telegram by:
 *   1. one DOCUMENT message per part  → caption from buildPartCaption()
 *   2. one SUMMARY CARD message       → text from buildSummaryText()
 *
 * The summary card is kept in sync with the app (rename / move / trash / restore)
 * via editMessageText, and deleted together with the parts on purge.
 *
 * This module is intentionally free of any imports so it can be unit-inspected
 * and reused from scripts. All dynamic values are HTML-escaped; Telegram supports
 * a limited HTML subset (b, i, u, s, code, pre, a, blockquote).
 */

export const APP_LABEL = 'ValencyStudio File Manager'

/** Telegram hard limits */
export const CAPTION_LIMIT = 1024
export const MESSAGE_LIMIT = 4096

const TZ = 'Asia/Jakarta'
const TZ_LABEL = 'WIB'

/** Escape Telegram-HTML special characters */
export function esc(s: string): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Human-readable byte size, e.g. 16.0 MB */
export function fmtBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0 B'
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = n / 1024
  let u = 0
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024
    u++
  }
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${units[u]}`
}

const dateFmt = new Intl.DateTimeFormat('id-ID', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: TZ,
})

/** "15 Okt 2025, 14.32 WIB" */
export function fmtWhen(d: Date | string | number): string {
  const date = d instanceof Date ? d : new Date(d)
  if (isNaN(date.getTime())) return '—'
  return `${dateFmt.format(date)} ${TZ_LABEL}`
}

/** Short internal reference so files are searchable inside Telegram ("#VS-8F3KX2") */
export function fileKey(id: string): string {
  return `VS-${String(id || '').slice(-6).toUpperCase()}`
}

export function fileTag(id: string): string {
  return `#VS${String(id || '').slice(-6).toUpperCase()}`
}

function folderLine(folderPath: string | null | undefined): string {
  const p = (folderPath || '').trim()
  return p ? esc(p) : 'My Files (root)'
}

function divider(): string {
  return '━━━━━━━━━━━━━━━━━━━━━━━'
}

// ─────────────────────────────── Part caption ───────────────────────────────

export interface PartMeta {
  /** current file name in the app */
  fileName: string
  /** part position, 0-based */
  partIndex: number
  partTotal: number
  /** byte size of THIS part */
  partSize: number
  /** byte size of the WHOLE file */
  fileSize: number
  mimeType: string
  /** display path like "Photos / 2025" — null for root */
  folderPath?: string | null
  uploaderName?: string | null
  uploaderEmail?: string | null
  /** sha-256 of this part (hex) — shown truncated */
  checksum?: string | null
  fileId: string
  siteName?: string | null
  uploadedAt?: Date | string | number
}

export function buildPartCaption(m: PartMeta): string {
  const name = esc((m.fileName || 'file').slice(0, 120))
  const idx = (m.partIndex ?? 0) + 1
  const total = Math.max(m.partTotal ?? 1, idx)
  const lines = [
    `🧩 <b>${name}</b> — Part ${idx}/${total}`,
    divider(),
    `📦 Part: <b>${fmtBytes(m.partSize)}</b> · Whole file: ${fmtBytes(m.fileSize)}`,
    `🏷 Type: <code>${esc((m.mimeType || 'application/octet-stream').slice(0, 60))}</code>`,
    `📁 Location: ${folderLine(m.folderPath)}`,
    `👤 Uploader: <b>${esc((m.uploaderName || '—').slice(0, 60))}</b>${m.uploaderEmail ? ` · ${esc(m.uploaderEmail.slice(0, 60))}` : ''}`,
    `🕒 ${fmtWhen(m.uploadedAt ?? Date.now())}`,
  ]
  if (m.checksum) lines.push(`🔒 SHA-256: <code>${esc(m.checksum.slice(0, 16))}…</code>`)
  lines.push(`🆔 <code>${fileKey(m.fileId)}</code> ${fileTag(m.fileId)}`)
  lines.push(divider())
  lines.push(`⚡ <i>${esc(m.siteName || APP_LABEL)}</i> · <i>storage part ${idx}/${total} — keep this chat intact</i>`)
  const caption = lines.join('\n')
  // hard safety: trim the trailing decorative lines if we ever approach the caption limit
  if (caption.length <= CAPTION_LIMIT) return caption
  return caption.slice(0, CAPTION_LIMIT - 1) + '…'
}

// ─────────────────────────────── Summary card ───────────────────────────────

export interface SummaryMeta {
  fileName: string
  fileSize: number
  /** number of storage parts the file is split into */
  partCount: number
  mimeType: string
  folderPath?: string | null
  uploaderName?: string | null
  uploaderEmail?: string | null
  fileId: string
  siteName?: string | null
  uploadedAt?: Date | string | number
  /** true while the file sits in the trash */
  trashed?: boolean
  /** true when a public share link is active */
  shared?: boolean
  /** extra line, e.g. 'Duplicated from "x.pdf" (shared parts)' */
  note?: string | null
}

export function buildSummaryText(m: SummaryMeta): string {
  const name = esc((m.fileName || 'file').slice(0, 160))
  const lines = [
    `📦 <b>${name}</b>`,
    `🆔 <code>${fileKey(m.fileId)}</code> ${fileTag(m.fileId)} · 🏷 <code>${esc((m.mimeType || 'application/octet-stream').slice(0, 60))}</code>`,
    divider(),
    `💾 Size: <b>${fmtBytes(m.fileSize)}</b> · 🧩 ${m.partCount} part${m.partCount === 1 ? '' : 's'} (16 MB each)`,
    `📁 Location: ${folderLine(m.folderPath)}`,
    `👤 Uploader: <b>${esc((m.uploaderName || '—').slice(0, 60))}</b>${m.uploaderEmail ? ` · ${esc(m.uploaderEmail.slice(0, 60))}` : ''}`,
    `🕒 Uploaded: ${fmtWhen(m.uploadedAt ?? Date.now())}`,
    `📝 Status: ${m.trashed ? '🗑 <i>In trash — auto-purge after 30 days</i>' : '✅ Ready'}`,
    `🔗 Sharing: ${m.shared ? '🌐 <b>Public link active</b>' : '🔒 Private'}`,
  ]
  if (m.note) lines.push(`📌 ${esc(m.note.slice(0, 140))}`)
  lines.push(divider())
  lines.push(`⚡ <i>${esc(m.siteName || APP_LABEL)}</i> — <i>this card mirrors the app automatically</i>`)
  const text = lines.join('\n')
  if (text.length <= MESSAGE_LIMIT) return text
  return text.slice(0, MESSAGE_LIMIT - 1) + '…'
}
