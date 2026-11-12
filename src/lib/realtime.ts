'use client'

/**
 * Client realtime hub — Server-Sent Events (SSE) connection for the whole app.
 *
 * - Direct connection to `/api/realtime` on the same host & port (no proxy or extra port needed).
 * - Identity-aware rooms: after login the client joins `user:<id>` (+ `admins`
 *   for OWNER/ADMIN sessions) so it only receives relevant change signals.
 * - Public share pages join `slug:<slug>` rooms for live download counters.
 * - Status is exposed via useSyncExternalStore (no re-render storms).
 * - Change events are consumed by <RealtimeBridge /> which coalesces domains
 *   and invalidates the matching TanStack Query caches → UI updates instantly,
 *   no page refresh needed. Polling intervals remain only as a backstop.
 */
import { useSyncExternalStore } from 'react'

export type RealtimeStatus = 'connecting' | 'live' | 'offline'

export interface RealtimeChangeEvent {
  domains: string[]
  at?: number
  source?: 'api' | 'db'
}

let eventSource: EventSource | null = null
let status: RealtimeStatus = 'connecting'
let identity: { userId: string; privileged: boolean; slug: string | null } = {
  userId: '',
  privileged: false,
  slug: null,
}

const statusListeners = new Set<() => void>()
const changeListeners = new Set<(e: RealtimeChangeEvent) => void>()

function setStatus(next: RealtimeStatus) {
  if (status === next) return
  status = next
  statusListeners.forEach((fn) => {
    try {
      fn()
    } catch {}
  })
}

function buildUrl(): string {
  const params = new URLSearchParams()
  if (identity.userId) params.set('userId', identity.userId)
  if (identity.privileged) params.set('privileged', '1')
  if (identity.slug) params.set('slug', identity.slug)
  const qs = params.toString()
  return '/api/realtime' + (qs ? `?${qs}` : '')
}

function connect(): void {
  if (typeof window === 'undefined' || typeof EventSource === 'undefined') return

  if (eventSource) {
    eventSource.close()
    eventSource = null
  }

  setStatus('connecting')
  const es = new EventSource(buildUrl())
  eventSource = es

  es.onopen = () => {
    setStatus('live')
  }

  es.addEventListener('connected', () => {
    setStatus('live')
  })

  es.addEventListener('changed', (e: MessageEvent) => {
    try {
      const data = JSON.parse(e.data) as RealtimeChangeEvent
      if (!data || !Array.isArray(data.domains)) return
      changeListeners.forEach((fn) => {
        try {
          fn(data)
        } catch {}
      })
    } catch {}
  })

  es.onerror = () => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setStatus('offline')
      return
    }
    // EventSource automatically attempts reconnection in background
    if (es.readyState === EventSource.CONNECTING) {
      setStatus('connecting')
    } else {
      setStatus('offline')
    }
  }
}

function ensureConnection(): void {
  if (typeof window === 'undefined') return
  if (!eventSource || eventSource.readyState === EventSource.CLOSED) {
    connect()
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    connect()
  })
  window.addEventListener('offline', () => {
    setStatus('offline')
  })
}

/** Subscribe the channel to identity rooms (call whenever auth state changes). */
export function realtimeSetIdentity(userId: string | null | undefined, privileged: boolean) {
  const newUserId = userId || ''
  const newPrivileged = !!privileged
  if (identity.userId === newUserId && identity.privileged === newPrivileged) return
  identity.userId = newUserId
  identity.privileged = newPrivileged
  if (eventSource) {
    connect()
  } else {
    ensureConnection()
  }
}

/** Public share pages: live download counters via a slug room. */
export function realtimeJoinSlug(slug: string) {
  if (identity.slug === slug) return
  identity.slug = slug
  if (eventSource) {
    connect()
  } else {
    ensureConnection()
  }
}

export function realtimeLeaveSlug() {
  if (!identity.slug) return
  identity.slug = null
  if (eventSource) {
    connect()
  }
}

/** Register a change handler. Returns unsubscribe. */
export function onRealtimeChange(fn: (e: RealtimeChangeEvent) => void): () => void {
  changeListeners.add(fn)
  ensureConnection()
  return () => changeListeners.delete(fn)
}

/** Status subscription primitives for useSyncExternalStore. */
function subscribeStatus(fn: () => void) {
  statusListeners.add(fn)
  ensureConnection()
  return () => statusListeners.delete(fn)
}

export function useRealtimeStatus(): RealtimeStatus {
  return useSyncExternalStore(
    subscribeStatus,
    () => status,
    () => 'connecting'
  )
}
