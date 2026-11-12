/**
 * ValencyStudio — Realtime fan-out service (socket.io, port 3003)
 *
 * Purpose: push "data changed" signals to every connected web client so the UI
 * updates WITHOUT a page refresh (storage meter, file lists, admin panels,
 * public share counters …).
 *
 * Two signal sources:
 *  1. Precise events: Next.js API routes POST /broadcast right after a mutation
 *     (authenticated with x-internal-key — never reachable from browsers).
 *  2. Safety net: a SQLite fingerprint poller detects ANY data change that was
 *     not instrumented (scripts, future routes) and broadcasts a generic sync.
 *
 * Events sent to clients (payload carries NO sensitive data — only domains):
 *   'changed' -> { domains: string[], at: number, source: 'api' | 'db' }
 *
 * Rooms:
 *   user:<id>   — one user's devices/tabs
 *   admins      — all OWNER/ADMIN sessions
 *   slug:<slug> — visitors of a public share page
 */
import { createServer } from 'http'
import { join, isAbsolute } from 'path'
import { Server } from 'socket.io'
import { Database } from 'bun:sqlite'

const PORT = 3003 // browser-facing socket.io endpoint (via gateway ?XTransformPort=3003)
const INTERNAL_PORT = 3004 // loopback-only broadcast API for the Next.js server
const APP_PORT = process.env.APP_PORT || process.env.PORT || 3000
const INTERNAL_KEY = process.env.REALTIME_INTERNAL_KEY || 'vs-internal-key'
const DB_PATH = process.env.REALTIME_DB_PATH
  ? isAbsolute(process.env.REALTIME_DB_PATH)
    ? process.env.REALTIME_DB_PATH
    : join(process.cwd(), process.env.REALTIME_DB_PATH)
  : join(import.meta.dir, '../../db/custom.db')

interface BroadcastBody {
  domains: string[]
  rooms?: string[]
  all?: boolean
  source?: 'api' | 'db'
}

let io!: Server // assigned right after creation, used by the internal broadcaster

// ---------------------------------------------------------------------------
// Internal broadcast API — plain HTTP on a loopback-only port (never exposed
// through the gateway). socket.io owns port 3003 exclusively (path '/' would
// otherwise swallow every REST request).
// ---------------------------------------------------------------------------
const internalServer = createServer((req, res) => {
  const send = (code: number, body: unknown) => {
    res.writeHead(code, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(body))
  }

  if (req.method === 'GET' && (req.url === '/health' || req.url?.startsWith('/health?'))) {
    return send(200, { ok: true, clients: io?.engine.clientsCount ?? 0, uptime: process.uptime() })
  }

  if (req.method === 'POST' && (req.url === '/broadcast' || req.url?.startsWith('/broadcast?'))) {
    // internal-only endpoint (Next.js server side); browsers can never forge the key
    if (req.headers['x-internal-key'] !== INTERNAL_KEY) {
      return send(403, { error: 'Forbidden' })
    }
    let raw = ''
    req.on('data', c => {
      raw += c
      if (raw.length > 64 * 1024) req.destroy() // abuse guard
    })
    req.on('end', () => {
      try {
        const body = JSON.parse(raw || '{}') as BroadcastBody
        const domains = Array.isArray(body.domains) ? body.domains.slice(0, 12) : []
        if (domains.length === 0) return send(400, { error: 'domains required' })
        const event = { domains, at: Date.now(), source: body.source || 'api' }
        const rooms = (body.rooms || []).filter(r => typeof r === 'string' && r.length < 128).slice(0, 24)
        if (body.all || rooms.length === 0) {
          io.emit('changed', event)
        } else {
          for (const room of rooms) io.to(room).emit('changed', event)
        }
        return send(200, { ok: true, clients: io.engine.clientsCount })
      } catch {
        return send(400, { error: 'bad json' })
      }
    })
    return
  }

  send(404, { error: 'Not found' })
})

io = new Server(createServer(), {
  // DO NOT change the path — Caddy forwards it via ?XTransformPort=3003
  path: '/',
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 60000,
  pingInterval: 25000,
})

io.on('connection', socket => {
  socket.on('subscribe', (data: { userId?: string; privileged?: boolean; slug?: string }) => {
    try {
      if (typeof data?.userId === 'string' && data.userId.length < 64) socket.join(`user:${data.userId}`)
      if (data?.privileged === true) socket.join('admins')
      if (typeof data?.slug === 'string' && /^[a-z0-9-]{4,64}$/i.test(data.slug)) socket.join(`slug:${data.slug}`)
    } catch {}
  })
  socket.on('unsubscribe-slug', (slug: string) => {
    if (typeof slug === 'string' && /^[a-z0-9-]{4,64}$/i.test(slug)) socket.leave(`slug:${slug}`)
  })
})

// ---------------------------------------------------------------------------
// Safety net: SQLite fingerprint poller (readonly, ~every 2.5s).
// Uses COUNT/SUM only (not updatedAt) so per-part upload churn stays quiet —
 // precise route events handle those; this catches anything uninstrumented.
// ---------------------------------------------------------------------------
let lastFingerprint = ''
try {
  const db = new Database(DB_PATH, { readonly: true, safeIntegers: false })
  db.exec('PRAGMA busy_timeout = 1500')
  const fpStmt = db.query(`
    SELECT
      (SELECT count(*) FROM User) AS users,
      (SELECT count(*) FROM File) AS files,
      (SELECT count(*) FROM File WHERE deletedAt IS NOT NULL) AS trashed,
      (SELECT coalesce(sum(size), 0) FROM File) AS bytes,
      (SELECT count(*) FROM Folder) AS folders,
      (SELECT count(*) FROM ActivityLog) AS logs,
      (SELECT count(*) FROM DownloadLog) AS dlogs,
      (SELECT count(*) FROM ApiToken) AS tokens,
      (SELECT count(*) FROM DownloadToken) AS dtokens,
      (SELECT count(*) FROM Setting) AS settings
  `)
  setInterval(() => {
    try {
      const row = fpStmt.get() as Record<string, number>
      const fp = Object.values(row).join('|')
      if (lastFingerprint !== '' && fp !== lastFingerprint) {
        const payload = {
          domains: ['files', 'folders', 'users', 'activity', 'downloads', 'settings', 'tokens'],
          at: Date.now(),
          source: 'db' as const,
        }
        io.emit('changed', payload)
        fetch(`http://127.0.0.1:${APP_PORT}/api/realtime`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-internal-key': INTERNAL_KEY },
          body: JSON.stringify({ ...payload, all: true }),
        }).catch(() => {})
      }
      lastFingerprint = fp
    } catch {
      /* DB locked or mid-write — skip this tick */
    }
  }, 2500)
  console.log(`[realtime] db fingerprint poller armed on ${DB_PATH}`)
} catch (err) {
  console.error('[realtime] fingerprint poller unavailable:', err)
}

internalServer.listen(INTERNAL_PORT, '127.0.0.1', () => {
  console.log(`Realtime internal broadcast API on 127.0.0.1:${INTERNAL_PORT}`)
})

io.httpServer?.listen(PORT, () => {
  console.log(`Realtime service (socket.io) listening on port ${PORT}`)
})

process.on('SIGTERM', () => {
  io.close(() => {
    internalServer.close(() => process.exit(0))
  })
})
process.on('SIGINT', () => {
  io.close(() => {
    internalServer.close(() => process.exit(0))
  })
})
