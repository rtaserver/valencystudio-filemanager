import { PrismaClient } from '@prisma/client'
import path from 'path'
import fs from 'fs'

/**
 * Normalize DATABASE_URL to an absolute file: path before PrismaClient reads it.
 *
 * Why: `file:../db/custom.db` is schema-relative (prisma/../db) in dev, but the
 * standalone server runs from `.next/standalone/` where the same relative string
 * points at `.next/db/...` (missing) → Error 14. Docker already uses an absolute
 * `file:/app/db/custom.db` which passes through untouched.
 */
function resolveDatabaseUrl(): string {
  const raw = process.env.DATABASE_URL || 'file:./db/custom.db'
  if (!raw.startsWith('file:')) return raw
  const q = raw.indexOf('?')
  const filePart = q === -1 ? raw.slice(5) : raw.slice(5, q)
  const suffix = q === -1 ? '' : raw.slice(q)
  if (/^\/|^[A-Za-z]:|^\\\\/.test(filePart)) return raw // already absolute

  // find project root = nearest ancestor of cwd containing prisma/schema.prisma
  let root = process.cwd()
  for (let i = 0; i < 5; i++) {
    if (fs.existsSync(path.join(root, 'prisma', 'schema.prisma'))) break
    const parent = path.dirname(root)
    if (parent === root) break
    root = parent
  }
  const candidates = [
    path.resolve(root, 'prisma', filePart), // Prisma schema-relative semantics (dev: ../db → <root>/db)
    path.resolve(root, filePart), // cwd-relative fallback
    path.resolve(process.cwd(), filePart),
  ]
  for (const abs of candidates) {
    if (fs.existsSync(abs)) {
      process.env.DATABASE_URL = `file:${abs}${suffix}`
      return process.env.DATABASE_URL
    }
  }
  // nothing exists yet (fresh clone) — point at the canonical location and create the dir
  const abs = candidates[0]
  try { fs.mkdirSync(path.dirname(abs), { recursive: true }) } catch {}
  process.env.DATABASE_URL = `file:${abs}${suffix}`
  return process.env.DATABASE_URL
}

resolveDatabaseUrl()

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ['error'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db