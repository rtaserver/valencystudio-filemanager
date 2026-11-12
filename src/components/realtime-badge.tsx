'use client'

import { useRealtimeStatus } from '@/lib/realtime'

/**
 * Compact live-connection indicator (LIVE / SYNC / OFFLINE).
 * Shows visitors and users that the UI updates itself without a page refresh.
 */
export function RealtimeBadge({ className = '' }: { className?: string }) {
  const status = useRealtimeStatus()
  const label = status === 'live' ? 'LIVE' : status === 'connecting' ? 'SYNC' : 'OFFLINE'
  const dot =
    status === 'live'
      ? 'bg-primary animate-pulse-dot'
      : status === 'connecting'
        ? 'bg-muted-foreground/70 animate-pulse'
        : 'bg-red-500'
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-muted/30 px-2 py-0.5 font-mono text-[10px] tracking-[0.14em] text-muted-foreground ${className}`}
      title={
        status === 'live'
          ? 'Realtime SYNC active — changes stream in without refresh'
          : status === 'connecting'
            ? 'Connecting to realtime channel…'
            : 'Realtime channel offline — falling back to periodic polling'
      }
      role="status"
      aria-live="polite"
    >
      <span className={`size-1.5 rounded-full shrink-0 ${dot}`} />
      {label}
    </span>
  )
}
