'use client'

import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/lib/auth-context'
import {
  onRealtimeChange,
  realtimeSetIdentity,
  type RealtimeChangeEvent,
} from '@/lib/realtime'

/**
 * Realtime → Query invalidation bridge.
 *
 * The socket hub emits coarse domain signals ("files changed"). This component
 * maps them to every TanStack Query cache that renders that domain and
 * invalidates them (active queries refetch immediately) — that is what makes
 * the storage meter, file lists, admin panels and profile stats update live
 * without a page refresh. Bursts are coalesced in a 120 ms window.
 */
const DOMAIN_QUERY_KEYS: Record<string, readonly (readonly unknown[])[]> = {
  files: [
    ['files'],
    ['folders'],
    ['folders-tree'],
    ['me'], // ← powers the sidebar STORAGE widget (usedBytes / fileCount)
    ['admin-overview'],
    ['admin-files'],
    ['admin-user-files'],
    ['palette-files'],
    ['file-details'],
    ['file-links'],
    ['share-stats'],
  ],
  folders: [['folders'], ['folders-tree'], ['palette-files']],
  users: [['admin-users'], ['admin-overview'], ['me'], ['user-stats']],
  activity: [['admin-logs'], ['admin-overview']],
  downloads: [['share-stats'], ['file-details'], ['admin-logs'], ['admin-overview'], ['user-stats']],
  settings: [['me'], ['admin-settings'], ['admin-overview']],
  tokens: [['api-tokens'], ['user-stats']],
}

export function RealtimeBridge() {
  const { user, privileged } = useAuth()
  const queryClient = useQueryClient()
  const pending = useRef<Set<string>>(new Set())
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // identity → socket rooms (user / admins)
  useEffect(() => {
    realtimeSetIdentity(user?.id, privileged)
  }, [user?.id, privileged])

  // domain signals → coalesced cache invalidation
  useEffect(() => {
    const flush = () => {
      timer.current = null
      const keys = new Set<readonly unknown[]>()
      pending.current.forEach(domain => {
        DOMAIN_QUERY_KEYS[domain]?.forEach(k => keys.add(k))
      })
      pending.current.clear()
      keys.forEach(key => queryClient.invalidateQueries({ queryKey: [...key], refetchType: 'active' }))
    }
    const unsub = onRealtimeChange((event: RealtimeChangeEvent) => {
      event.domains.forEach(d => pending.current.add(d))
      if (!timer.current) timer.current = setTimeout(flush, 120)
    })
    return () => {
      unsub()
      if (timer.current) {
        clearTimeout(timer.current)
        timer.current = null
      }
    }
  }, [queryClient])

  return null
}
