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
  progress: number // 0..1
  speed: number // bytes/s
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

const MAX_FILE_CONCURRENCY = 2
const readStore = () => useUploadStore.getState()

function update(key: string, patch: Partial<UploadItem>) {
  useUploadStore.setState(state => ({
    items: state.items.map(it => (it.key === key ? { ...it, ...patch } : it)),
  }))
}

function pump() {
  while (activeCount < MAX_FILE_CONCURRENCY && queue.length > 0) {
    const key = queue.shift()
    if (!key) break
    const item = readStore().items.find(i => i.key === key)
    if (!item || item.status !== 'queued') continue
    activeCount++
    processFile(key).finally(() => {
      activeCount--
      pump()
    })
  }
}

function xhrUploadStream(
  key: string,
  file: File,
  folderId: string | null,
  signal: AbortSignal
): Promise<{ id: string; name: string; size: number }> {
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
      const now = Date.now()
      const dt = (now - lastTs) / 1000
      if (dt > 0.2) {
        const inst = (e.loaded - lastLoaded) / dt
        speedEma = speedEma === 0 ? inst : speedEma * 0.7 + inst * 0.3
        lastLoaded = e.loaded
        lastTs = now
        update(key, { speed: speedEma })
      }
      update(key, {
        progress: e.total > 0 ? Math.min(0.999, e.loaded / e.total) : 0,
      })
    }

    const cleanup = () => signal.removeEventListener('abort', onAbort)
    const onAbort = () => xhr.abort()
    signal.addEventListener('abort', onAbort)

    xhr.onload = () => {
      cleanup()
      if (xhr.status >= 200 && xhr.status < 300) {
        const res = xhr.response?.file || xhr.response
        update(key, { progress: 1 })
        resolve(res)
      } else {
        let msg = `Upload failed (HTTP ${xhr.status})`
        try {
          const body = xhr.response || (xhr.responseText ? JSON.parse(xhr.responseText) : null)
          if (body?.error) msg = body.error
        } catch {}
        reject(new Error(msg))
      }
    }
    xhr.onerror = () => {
      cleanup()
      reject(new Error('Network error during upload'))
    }
    xhr.onabort = () => {
      cleanup()
      reject(new DOMException('Aborted', 'AbortError'))
    }
    xhr.send(file)
  })
}

async function getUploadTarget(signal: AbortSignal): Promise<{ backend: 'telegram' | 'local'; available: boolean }> {
  const response = await fetch('/api/files/upload-stream', { method: 'GET', signal })
  const body = await response.json().catch(() => ({}))
  return {
    backend: body?.storageBackend === 'local' ? 'local' : 'telegram',
    available: response.ok && !!body?.available,
  }
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
    try {
      target = await getUploadTarget(controller.signal)
    } catch (error: any) {
      if (error?.name === 'AbortError') throw error
      throw new Error('Could not check Telegram upload service. No file was uploaded; please retry.')
    }

    if (target.backend !== 'telegram') {
      throw new Error('Storage backend is set to Local. Set Admin → Storage to Telegram to upload directly as one Telegram document.')
    }
    if (!target.available) {
      throw new Error('Telegram upload service is unavailable. No file was uploaded. Check Admin → Storage and the MTProto API credentials.')
    }

    update(key, { status: 'uploading' })
    const uploaded = await xhrUploadStream(key, file, folderId, controller.signal)
    if (typeof uploaded.size === 'number' && uploaded.size !== file.size) {
      throw new Error(`Integrity check failed: expected ${file.size} bytes, received ${uploaded.size} bytes`)
    }

    update(key, {
      status: 'done',
      progress: 1,
      speed: 0,
      fileId: uploaded.id,
    })
    onFinished?.(readStore().items.find(i => i.key === key)!)
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      update(key, { status: 'canceled', speed: 0 })
      const fileId = readStore().items.find(i => i.key === key)?.fileId
      if (fileId) fetch(`/api/files/${fileId}`, { method: 'DELETE' }).catch(() => {})
      onFinishError?.(readStore().items.find(i => i.key === key)!)
    } else {
      update(key, { status: 'error', error: err?.message || 'Upload failed', speed: 0 })
      onFinishError?.(readStore().items.find(i => i.key === key)!)
    }
  } finally {
    controllers.delete(key)
    const finalStatus = readStore().items.find(i => i.key === key)?.status
    if (finalStatus === 'done' || finalStatus === 'canceled') {
      files.delete(key)
      folderTargets.delete(key)
    }
  }
}

export const useUploadStore = create<UploadState>((set, get) => ({
  items: [],
  addFiles: (newFiles, folderId = null) => {
    const items = newFiles.map(f => ({
      key: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      name: f.name,
      size: f.size,
      mimeType: f.type || 'application/octet-stream',
      folderId,
      status: 'queued' as UploadStatus,
      progress: 0,
      speed: 0,
    }))
    newFiles.forEach((f, idx) => {
      files.set(items[idx].key, f)
      folderTargets.set(items[idx].key, folderId)
      queue.push(items[idx].key)
    })
    set(state => ({ items: [...items, ...state.items] }))
    pump()
  },
  cancel: key => controllers.get(key)?.abort(),
  retry: (key) => {
    const item = get().items.find(i => i.key === key)
    if (!item || !files.has(key)) return
    update(key, { status: 'queued', error: undefined, progress: 0, speed: 0 })
    queue.push(key)
    pump()
  },
  clearFinished: () => {
    set(state => ({ items: state.items.filter(i => !['done', 'canceled'].includes(i.status)) }))
  },
  removeItem: key => {
    set(state => ({ items: state.items.filter(i => i.key !== key) }))
  },
}))

export function setUploadCallbacks(cb: { onFinished?: (i: UploadItem) => void; onFinishError?: (i: UploadItem) => void }) {
  onFinished = cb.onFinished || null
  onFinishError = cb.onFinishError || null
}
