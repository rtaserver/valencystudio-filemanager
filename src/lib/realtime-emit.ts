/**
 * Server-side realtime emit — fire-and-forget POST to the socket.io fan-out
 * service (mini-services/realtime-service, port 3003). Never throws, never
 * blocks the API response: if the service is down the client falls back to
 * its polling intervals.
 *
 * Event contract with the client hub (src/lib/realtime.ts):
 *   'changed' -> { domains: RtDomain[], at, source: 'api' }
 */
import { realtimeHub } from '@/lib/realtime-hub'

const RT_URL = process.env.REALTIME_URL || 'http://127.0.0.1:3004'
const INTERNAL_KEY = process.env.REALTIME_INTERNAL_KEY || 'vs-internal-key'

export type RtDomain =
  | 'files'
  | 'folders'
  | 'users'
  | 'activity'
  | 'downloads'
  | 'settings'
  | 'tokens'

export const ROOM = {
  admins: 'admins',
  user: (id: string) => `user:${id}`,
  slug: (slug: string) => `slug:${slug}`,
}

export function emitChanged(
  domains: RtDomain[],
  opts?: { rooms?: string[]; all?: boolean }
): void {
  try {
    const event = {
      domains,
      at: Date.now(),
      source: 'api' as const,
    }
    // 1) Direct in-memory broadcast to connected SSE clients
    realtimeHub.broadcast(event, opts)

    // 2) Best-effort broadcast to loopback service if running
    const rooms = opts?.rooms?.filter(Boolean) ?? []
    const body = JSON.stringify({
      domains,
      rooms: rooms.length > 0 ? rooms : undefined,
      all: opts?.all ?? rooms.length === 0,
      source: 'api',
    })
    fetch(`${RT_URL}/broadcast`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-key': INTERNAL_KEY },
      body,
      signal: AbortSignal.timeout(1500),
    }).catch(() => {})
  } catch {
    /* realtime is best-effort by design */
  }
}
