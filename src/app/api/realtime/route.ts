import { NextRequest } from 'next/server'
import { realtimeHub, type SseClient } from '@/lib/realtime-hub'
import { getSessionUser, isPrivileged } from '@/lib/auth'

export const dynamic = 'force-dynamic'

const INTERNAL_KEY = process.env.REALTIME_INTERNAL_KEY

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const slug = url.searchParams.get('slug') || undefined

  // Room membership is derived only from a verified session. The slug room is
  // retained for public-share counters; it never grants user/admin membership.
  const sessionUser = await getSessionUser(req).catch(() => null)
  const userId = sessionUser?.id
  const privileged = sessionUser ? isPrivileged(sessionUser) : false

  const clientId = crypto.randomUUID()
  const encoder = new TextEncoder()
  let cleanupHub: (() => void) | null = null
  let pingTimer: ReturnType<typeof setInterval> | null = null
  let cleanedUp = false
  const cleanup = () => {
    if (cleanedUp) return
    cleanedUp = true
    if (pingTimer) clearInterval(pingTimer)
    if (cleanupHub) cleanupHub()
  }

  const stream = new ReadableStream({
    start(controller) {
      // 1) Send initial connected event
      controller.enqueue(
        encoder.encode(`event: connected\ndata: ${JSON.stringify({ status: 'live', at: Date.now() })}\n\n`)
      )

      // 2) Register SSE client in hub
      const client: SseClient = {
        id: clientId,
        userId,
        privileged,
        slug,
        send: (event, data) => {
          try {
            controller.enqueue(
              encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
            )
          } catch {
            // Controller closed
          }
        },
        close: () => {
          try {
            controller.close()
          } catch {}
        },
      }

      cleanupHub = realtimeHub.addClient(client)

      // 3) Keepalive ping every 15 seconds (prevents proxy timeouts)
      pingTimer = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': ping\n\n'))
        } catch {
          if (pingTimer) clearInterval(pingTimer)
        }
      }, 15000)
    },
    cancel() {
      cleanup()
    },
  })

  req.signal.addEventListener('abort', cleanup, { once: true })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform, no-store',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}

export async function POST(req: NextRequest) {
  const internalKey = process.env.REALTIME_INTERNAL_KEY
  if (!internalKey || req.headers.get('x-internal-key') !== internalKey) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const body = await req.json()
    const domains = Array.isArray(body.domains) ? body.domains.slice(0, 12) : []
    if (domains.length === 0) {
      return Response.json({ error: 'domains required' }, { status: 400 })
    }

    const event = {
      domains,
      at: Date.now(),
      source: body.source || 'db',
    }

    const delivered = realtimeHub.broadcast(event, {
      rooms: body.rooms,
      all: body.all ?? (!body.rooms || body.rooms.length === 0),
    })

    return Response.json({ ok: true, delivered, clients: realtimeHub.clientCount() })
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }
}
