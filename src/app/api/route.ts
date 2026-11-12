import { db } from '@/lib/db'
import { getSettings } from '@/lib/settings'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api — production health probe.
 * Verifies the process is up AND the database answers; reports the active storage
 * backend. Returns 503 when the DB is unreachable so orchestrators/monitors can
 * react. Deliberately leaks no identifiers (no chat ids, no counts, no emails).
 */
export async function GET() {
  const started = Date.now()
  let dbOk = false
  try {
    await db.$queryRaw`SELECT 1`
    dbOk = true
  } catch {}
  let storageBackend = 'unknown'
  try {
    storageBackend = (await getSettings()).storageBackend || 'unknown'
  } catch {}
  return Response.json(
    {
      ok: dbOk,
      db: dbOk ? 'up' : 'down',
      storageBackend,
      uptimeSec: Math.round(process.uptime()),
      latencyMs: Date.now() - started,
      timestamp: new Date().toISOString(),
    },
    { status: dbOk ? 200 : 503 }
  )
}
