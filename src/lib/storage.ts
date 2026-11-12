import { getSettings } from '@/lib/settings'
import { deleteTelegramMessage, getTelegramFileUrl, uploadPartToTelegram } from '@/lib/telegram'
import { deleteFromTelethon } from '@/lib/telethon'
import type { PartMeta } from '@/lib/telegram-captions'
import { mkdir, readFile, unlink, writeFile } from 'fs/promises'
import path from 'path'

export interface StoredPart {
  ref: string // "tg:<fileId>:<messageId>" or "local:<relativePath>"
  size: number
}

const STORAGE_ROOT = path.join(process.cwd(), 'storage', 'parts')

// ---------- LRU buffer cache for fast range requests ----------
const partCache = new Map<string, { buf: Buffer; ts: number }>()
const CACHE_MAX_BYTES = 128 * 1024 * 1024
let cacheBytes = 0

function cachePut(ref: string, buf: Buffer) {
  if (cacheBytes + buf.length > CACHE_MAX_BYTES) {
    // evict oldest entries until it fits
    const entries = [...partCache.entries()].sort((a, b) => a[1].ts - b[1].ts)
    for (const [k, v] of entries) {
      partCache.delete(k)
      cacheBytes -= v.buf.length
      if (cacheBytes + buf.length <= CACHE_MAX_BYTES) break
    }
  }
  partCache.set(ref, { buf, ts: Date.now() })
  cacheBytes += buf.length
}

export function cacheInvalidate(ref?: string) {
  if (ref) {
    const hit = partCache.get(ref)
    if (hit) {
      cacheBytes -= hit.buf.length
      partCache.delete(ref)
    }
  } else {
    partCache.clear()
    cacheBytes = 0
  }
}

function tgRefParts(ref: string): { fileId: string; messageId?: number } | null {
  if (!ref.startsWith('tg:')) return null
  const [, fileId, messageId] = ref.split(':')
  return { fileId, messageId: messageId ? parseInt(messageId) : undefined }
}

function localPath(ref: string): string {
  const rel = ref.slice('local:'.length)
  const safe = path.normalize(rel).replace(/^(\.\.(\/|\\|$))+/, '')
  return path.join(STORAGE_ROOT, safe)
}

/** Store one part and return its reference */
export async function putPart(buffer: Buffer, index: number, total: number, originalName: string, meta?: PartMeta): Promise<StoredPart> {
  const settings = await getSettings()
  if (settings.storageBackend === 'telegram') {
    const safeName = originalName.replace(/[^\w.\- ()\[\]]+/g, '_').slice(0, 80) || 'file.bin'
    const { fileId, messageId } = await uploadPartToTelegram(buffer, `${safeName}.${String(index).padStart(4, '0')}.vpart`, index, total, originalName, meta)
    return { ref: `tg:${fileId}:${messageId}`, size: buffer.length }
  }
  // local backend
  const dir = path.join(STORAGE_ROOT, Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8))
  await mkdir(dir, { recursive: true })
  const file = path.join(dir, `part_${String(index).padStart(4, '0')}.bin`)
  await writeFile(file, buffer)
  return { ref: `local:${path.relative(STORAGE_ROOT, file)}`, size: buffer.length }
}

/** Read one full part into memory (with LRU cache) */
export async function readPartBuffer(ref: string): Promise<Buffer> {
  const hit = partCache.get(ref)
  if (hit) {
    hit.ts = Date.now()
    return hit.buf
  }
  let buf: Buffer
  if (ref.startsWith('tg:')) {
    const p = tgRefParts(ref)
    if (!p) throw new Error('Corrupt part reference')
    const url = await getTelegramFileUrl(p.fileId)
    const res = await fetch(url, { signal: AbortSignal.timeout(120_000) })
    if (!res.ok) throw new Error(`Telegram download failed (${res.status}) — file link expired or part exceeds 20MB`)
    buf = Buffer.from(await res.arrayBuffer())
  } else {
    buf = await readFile(localPath(ref))
  }
  cachePut(ref, buf)
  return buf
}

/** Best-effort delete of a stored part */
export async function deletePart(ref: string): Promise<void> {
  cacheInvalidate(ref)
  try {
    if (ref.startsWith('telethon:')) {
      const msgId = parseInt(ref.slice('telethon:'.length))
      if (!isNaN(msgId)) {
        await deleteFromTelethon(msgId)
      }
    } else if (ref.startsWith('tg:')) {
      const p = tgRefParts(ref)
      const settings = await getSettings()
      if (p && p.messageId && settings.tgStorageChatId) {
        await deleteTelegramMessage(settings.tgStorageChatId, p.messageId)
      }
    } else if (ref.startsWith('local:')) {
      await unlink(localPath(ref)).catch(() => {})
    }
  } catch {
    // best effort
  }
}
