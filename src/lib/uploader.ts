'use client'

import { create } from 'zustand'

export type UploadStatus = 'queued' | 'initializing' | 'uploading' | 'finalizing' | 'done' | 'error' | 'canceled'

export interface UploadItem {
  key: string
  name: string
  size: number
  mimeType: string
  folderId?: string | null
  status: UploadStatus
  progress: number
  speed: number
  error?: string
  fileId?: string
}

interface UploadState {
  items: UploadItem[]
  addFiles: (files: File[], folderId?: string | null) => void
  cancel: (key: string) => void
  retry: (key: string) => void
  clearFinished: () => void
  removeItem: (key: string) => void
}

const controllers = new Map<string, AbortController>()
let activeCount = 0
const queue: string[] = []
const files = new Map<string, File>()
const folderTargets = new Map<string, string | null>()
let onFinished: ((item: UploadItem) => void) | null = null
let onFinishError: ((item: UploadItem) => void) | null = null
const PART_SIZE = 512 * 1024
const MULTIPART_THRESHOLD = PART_SIZE * 2
const MAX_PART_RETRIES = 3
const readStore = () => useUploadStore.getState()

function update(key: string, patch: Partial<UploadItem>) {
  useUploadStore.setState(state => ({ items: state.items.map(it => (it.key === key ? { ...it, ...patch } : it)) }))
}

function pump() {
  while (activeCount < 2 && queue.length > 0) {
    const key = queue.shift()
    if (!key) break
    const item = readStore().items.find(i => i.key === key)
    if (!item || item.status !== 'queued') continue
    activeCount++
    processFile(key).finally(() => { activeCount--; pump() })
  }
}

function xhrUploadStream(key: string, file: File, folderId: string | null, signal: AbortSignal): Promise<{ id: string; name: string; size: number }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/files/upload-stream')
    xhr.responseType = 'json'
    xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name))
    xhr.setRequestHeader('X-File-Size', String(file.size))
    if (folderId) xhr.setRequestHeader('X-Folder-Id', folderId)
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream')
    let lastLoaded = 0
    let lastTs = Date.now()
    let speedEma = 0
    xhr.upload.onprogress = e => {
      const now = Date.now(), dt = (now - lastTs) / 1000
      if (dt > 0.2) {
        const inst = (e.loaded - lastLoaded) / dt
        speedEma = speedEma === 0 ? inst : speedEma * 0.7 + inst * 0.3
        lastLoaded = e.loaded; lastTs = now; update(key, { speed: speedEma })
      }
      update(key, { progress: e.total > 0 ? Math.min(0.999, e.loaded / e.total) : 0 })
    }
    const cleanup = () => signal.removeEventListener('abort', onAbort)
    const onAbort = () => xhr.abort()
    signal.addEventListener('abort', onAbort)
    xhr.onload = () => {
      cleanup()
      if (xhr.status >= 200 && xhr.status < 300) {
        const res = xhr.response?.file || xhr.response
        update(key, { progress: 1 }); resolve(res)
      } else {
        let msg = `Upload failed (HTTP ${xhr.status})`
        try { const body = xhr.response || (xhr.responseText ? JSON.parse(xhr.responseText) : null); if (body?.error) msg = body.error } catch {}
        reject(new Error(msg))
      }
    }
    xhr.onerror = () => { cleanup(); reject(new Error('Koneksi terputus saat upload. Pilih Retry untuk melanjutkan upload yang tertunda.')) }
    xhr.onabort = () => { cleanup(); reject(new DOMException('Aborted', 'AbortError')) }
    xhr.send(file)
  })
}

async function getUploadTarget(signal: AbortSignal): Promise<{ backend: 'telegram' | 'local'; available: boolean }> {
  const response = await fetch('/api/files/upload-stream', { method: 'GET', signal })
  const body = await response.json().catch(() => ({}))
  return { backend: body?.storageBackend === 'local' ? 'local' : 'telegram', available: response.ok && !!body?.available }
}

async function requestJson<T>(url: string, init: RequestInit, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { ...init, signal, credentials: 'same-origin' })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body?.error || body?.detail || `Upload request failed (${response.status})`)
  return body as T
}

async function sendPartWithRetry(sessionId: string, index: number, chunk: Blob, signal: AbortSignal): Promise<void> {
  let lastError: unknown
  for (let attempt = 0; attempt < MAX_PART_RETRIES; attempt++) {
    try {
      const response = await fetch(`/api/uploads/${sessionId}/parts/${index}`, {
        method: 'PUT', body: chunk, signal, credentials: 'same-origin', headers: { 'Content-Type': 'application/octet-stream' },
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body?.error || `Part upload failed (${response.status})`)
      return
    } catch (error) {
      if (signal.aborted) throw error
      lastError = error
      if (attempt < MAX_PART_RETRIES - 1) await new Promise<void>((resolve, reject) => {
        const onAbort = () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')) }
        const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve() }, 350 * (attempt + 1))
        signal.addEventListener('abort', onAbort, { once: true })
      })
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Part upload failed')
}

async function uploadMultipart(key: string, file: File, folderId: string | null, signal: AbortSignal): Promise<{ id: string; name: string; size: number }> {
  const listed = await requestJson<{ uploads: Array<{ id: string; name: string; size: number; mimeType: string; folderId: string | null; totalParts: number; partSize: number; parts: Array<{ index: number; size: number; sha256: string }> }> }>('/api/uploads', { method: 'GET' }, signal)
  type ResumeSession = { id: string; totalParts: number; partSize: number; parts: Array<{ index: number; size: number; sha256: string }> }
  let session: ResumeSession | undefined = listed.uploads.find(upload => upload.name === file.name && upload.size === file.size && upload.mimeType === (file.type || 'application/octet-stream') && upload.folderId === folderId)
  if (session) {
    for (const part of session.parts) {
      const start = part.index * session.partSize
      const buffer = await file.slice(start, start + part.size).arrayBuffer()
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buffer)), byte => byte.toString(16).padStart(2, '0')).join('')
      if (hash !== part.sha256) { session = undefined; break }
    }
  }
  if (!session) {
    const created = await requestJson<{ id: string; totalParts: number; partSize: number }>('/api/uploads', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: file.name, size: file.size, mimeType: file.type || 'application/octet-stream', folderId }),
    }, signal)
    session = { ...created, parts: [] }
  }
  if (!session) throw new Error('Could not initialize multipart upload session.')
  let uploadedBytes = session.parts.reduce((sum, part) => sum + part.size, 0)
  const completed = new Set(session.parts.map(part => part.index))
  update(key, { progress: Math.min(0.99, uploadedBytes / file.size) })
  const indices = Array.from({ length: session.totalParts }, (_, index) => index).filter(index => !completed.has(index))
  for (let cursor = 0; cursor < indices.length; cursor += 3) {
    const batch = indices.slice(cursor, cursor + 3)
    await Promise.all(batch.map(async index => {
      const start = index * session!.partSize
      const chunk = file.slice(start, Math.min(file.size, start + session!.partSize))
      await sendPartWithRetry(session!.id, index, chunk, signal)
      uploadedBytes += chunk.size
      update(key, { progress: Math.min(0.99, uploadedBytes / file.size), speed: 0 })
    }))
  }
  update(key, { status: 'finalizing', progress: 0.995 })
  const result = await requestJson<{ file: { id: string; name: string; size: number } }>(`/api/uploads/${session.id}`, { method: 'POST' }, signal)
  return result.file
}

async function processFile(key: string) {
  const file = files.get(key)
  if (!file) return
  const controller = new AbortController()
  controllers.set(key, controller)
  try {
    const folderId = folderTargets.get(key) ?? null
    update(key, { status: 'initializing', progress: 0 })
    let target: { backend: 'telegram' | 'local'; available: boolean }
    try { target = await getUploadTarget(controller.signal) } catch (error: any) {
      if (error?.name === 'AbortError') throw error
      throw new Error('Could not check Telegram upload service. No file was uploaded; please retry.')
    }
    if (target.backend !== 'telegram') throw new Error('Multipart upload requires Telegram storage. Set Admin → Storage to Telegram.')
    if (!target.available) throw new Error('Telegram upload service is unavailable. Check Admin → Storage and the MTProto API credentials.')
    update(key, { status: 'uploading' })
    const uploaded = file.size > MULTIPART_THRESHOLD
      ? await uploadMultipart(key, file, folderId, controller.signal)
      : await xhrUploadStream(key, file, folderId, controller.signal)
    if (typeof uploaded.size === 'number' && uploaded.size !== file.size) throw new Error(`Integrity check failed: expected ${file.size} bytes, received ${uploaded.size} bytes`)
    update(key, { status: 'done', progress: 1, speed: 0, fileId: uploaded.id })
    onFinished?.(readStore().items.find(i => i.key === key)!)
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      update(key, { status: 'canceled', speed: 0 })
      onFinishError?.(readStore().items.find(i => i.key === key)!)
    } else {
      update(key, { status: 'error', error: err?.message || 'Upload failed', speed: 0 })
      onFinishError?.(readStore().items.find(i => i.key === key)!)
    }
  } finally {
    controllers.delete(key)
    const status = readStore().items.find(i => i.key === key)?.status
    if (status === 'done' || status === 'canceled') { files.delete(key); folderTargets.delete(key) }
  }
}

export const useUploadStore = create<UploadState>((set, get) => ({
  items: [],
  addFiles: (newFiles, folderId = null) => {
    const items = newFiles.map(f => ({ key: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`, name: f.name, size: f.size, mimeType: f.type || 'application/octet-stream', folderId, status: 'queued' as UploadStatus, progress: 0, speed: 0 }))
    newFiles.forEach((file, index) => { files.set(items[index].key, file); folderTargets.set(items[index].key, folderId); queue.push(items[index].key) })
    set(state => ({ items: [...items, ...state.items] })); pump()
  },
  cancel: key => controllers.get(key)?.abort(),
  retry: key => {
    const item = get().items.find(i => i.key === key)
    if (!item || !files.has(key)) return
    update(key, { status: 'queued', error: undefined, progress: 0, speed: 0 }); queue.push(key); pump()
  },
  clearFinished: () => set(state => ({ items: state.items.filter(item => !['done', 'canceled'].includes(item.status)) })),
  removeItem: key => set(state => ({ items: state.items.filter(item => item.key !== key) })),
}))

export function setUploadCallbacks(cb: { onFinished?: (item: UploadItem) => void; onFinishError?: (item: UploadItem) => void }) {
  onFinished = cb.onFinished || null
  onFinishError = cb.onFinishError || null
}
