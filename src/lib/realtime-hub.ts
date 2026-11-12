/**
 * In-process Realtime Hub for Server-Sent Events (SSE).
 *
 * Dispatches domain change signals directly to connected browser clients on the same
 * host/port without requiring an external proxy or second port.
 *
 * ponytail: in-memory SSE room matching is simple O(N clients) with Map; upgrade to Redis pub/sub if scaling across multiple multi-core cluster nodes.
 */

export interface RealtimeChangeEvent {
  domains: string[]
  at?: number
  source?: 'api' | 'db'
}

export interface SseClient {
  id: string
  userId?: string
  privileged?: boolean
  slug?: string
  send: (event: string, data: unknown) => void
  close: () => void
}

export interface BroadcastOptions {
  rooms?: string[]
  all?: boolean
}

class RealtimeHub {
  private clients = new Map<string, SseClient>()

  addClient(client: SseClient): () => void {
    this.clients.set(client.id, client)
    return () => {
      this.clients.delete(client.id)
    }
  }

  removeClient(id: string): void {
    this.clients.delete(id)
  }

  clientCount(): number {
    return this.clients.size
  }

  broadcast(event: RealtimeChangeEvent, opts?: BroadcastOptions): number {
    if (!event || !Array.isArray(event.domains) || event.domains.length === 0) return 0
    let delivered = 0
    const all = opts?.all ?? (!opts?.rooms || opts.rooms.length === 0)
    const rooms = opts?.rooms ?? []

    for (const client of this.clients.values()) {
      let match = all
      if (!match) {
        for (const room of rooms) {
          if (room === 'admins' && client.privileged) {
            match = true
            break
          }
          if (client.userId && room === `user:${client.userId}`) {
            match = true
            break
          }
          if (client.slug && room === `slug:${client.slug}`) {
            match = true
            break
          }
        }
      }

      if (match) {
        try {
          client.send('changed', event)
          delivered++
        } catch {
          this.clients.delete(client.id)
        }
      }
    }

    return delivered
  }
}

const globalForHub = globalThis as unknown as {
  __realtimeHub?: RealtimeHub
}

export const realtimeHub = globalForHub.__realtimeHub ?? new RealtimeHub()
globalForHub.__realtimeHub = realtimeHub
