import { db } from '@/lib/db'
import { randomBytes } from 'crypto'

export interface AppSettings {
  siteName: string
  siteDescription: string
  announcement: string
  allowRegistration: boolean
  defaultQuota: number // bytes
  maxFileSize: number // bytes
  storageBackend: 'telegram' | 'local'
  tgBotToken: string
  tgApiId: string
  tgApiHash: string
  tgAdminIds: string
  tgStorageChatId: string
  telethonCoreUrl: string
  telethonInternalKey: string
}

const DEFAULTS: Record<string, string> = {
  siteName: 'ValencyStudio File Manager',
  siteDescription: 'Enterprise-grade private cloud storage — fast, secure, and encrypted.',
  announcement: '',
  allowRegistration: 'true',
  defaultQuota: String(1000 * 1024 * 1024 * 1024),
  maxFileSize: String(2_147_483_648), // 2 GiB MTProto limit
  storageBackend: 'telegram',
  tgBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
  tgApiId: process.env.TELEGRAM_API_ID || process.env.TELETHON_API_ID || '',
  tgApiHash: process.env.TELEGRAM_API_HASH || process.env.TELETHON_API_HASH || '',
  tgAdminIds: process.env.TELEGRAM_ADMIN_IDS || '',
  tgStorageChatId: process.env.TELEGRAM_STORAGE_CHAT_ID || process.env.TELETHON_STORAGE_CHAT_ID || '',
  telethonCoreUrl: process.env.TELETHON_CORE_URL || 'http://127.0.0.1:3005',
  telethonInternalKey: process.env.TELETHON_INTERNAL_KEY || 'vs-telethon-internal-key',
}

export const SECRET_KEYS = ['tgBotToken', 'tgApiHash', 'jwtSecret', 'sharePasswordSalt']

let cache: { data: Record<string, string>; ts: number } | null = null
const CACHE_TTL = 8_000

export async function getSettingsRaw(): Promise<Record<string, string>> {
  if (cache && Date.now() - cache.ts < CACHE_TTL) return cache.data
  const rows = await db.setting.findMany()
  const data: Record<string, string> = { ...DEFAULTS, ...Object.fromEntries(rows.map(r => [r.key, r.value])) }
  cache = { data, ts: Date.now() }
  return data
}

export function invalidateSettingsCache() {
  cache = null
}

export async function getSettings(): Promise<AppSettings> {
  const raw = await getSettingsRaw()
  const rawMax = parseInt(raw.maxFileSize) || 0
  const maxFileSize = (!rawMax || rawMax <= 2_000_000_000) ? 2_147_483_648 : Math.min(rawMax, 2_147_483_648)
  if (rawMax > 0 && rawMax <= 2_000_000_000) {
    db.setting.upsert({ where: { key: 'maxFileSize' }, update: { value: '2147483648' }, create: { key: 'maxFileSize', value: '2147483648' } }).catch(() => {})
  }
  return {
    siteName: raw.siteName,
    siteDescription: raw.siteDescription,
    announcement: raw.announcement || '',
    allowRegistration: raw.allowRegistration === 'true',
    defaultQuota: (!parseFloat(raw.defaultQuota) || parseFloat(raw.defaultQuota) === 1073741824) ? 1000 * 1024 * 1024 * 1024 : parseFloat(raw.defaultQuota),
    maxFileSize,
    storageBackend: (raw.storageBackend === 'local' ? 'local' : 'telegram') as AppSettings['storageBackend'],
    tgBotToken: raw.tgBotToken || '',
    tgApiId: raw.tgApiId || '',
    tgApiHash: raw.tgApiHash || '',
    tgAdminIds: raw.tgAdminIds || '',
    tgStorageChatId: raw.tgStorageChatId || '',
    telethonCoreUrl: raw.telethonCoreUrl || 'http://127.0.0.1:3005',
    telethonInternalKey: raw.telethonInternalKey || 'vs-telethon-internal-key',
  }
}

export async function setSettings(patch: Record<string, string>) {
  for (const [key, value] of Object.entries(patch)) {
    await db.setting.upsert({ where: { key }, update: { value }, create: { key, value } })
  }
  invalidateSettingsCache()
}

export async function getJwtSecret(): Promise<string> {
  const raw = await getSettingsRaw()
  if (raw.jwtSecret) return raw.jwtSecret
  const secret = randomBytes(32).toString('hex')
  await db.setting.upsert({ where: { key: 'jwtSecret' }, update: { value: secret }, create: { key: 'jwtSecret', value: secret } })
  invalidateSettingsCache()
  return secret
}

let bootstrapPromise: Promise<void> | null = null

export function ensureBootstrap(): Promise<void> {
  if (!bootstrapPromise) bootstrapPromise = doBootstrap().catch(e => { bootstrapPromise = null; throw e })
  return bootstrapPromise
}

async function doBootstrap() {
  const rows = await db.setting.findMany({ where: { key: 'bootstrapped' } })
  if (rows.length > 0) return
  for (const [key, value] of Object.entries(DEFAULTS)) {
    await db.setting.upsert({ where: { key }, update: {}, create: { key, value } })
  }
  const secret = randomBytes(32).toString('hex')
  await db.setting.upsert({ where: { key: 'jwtSecret' }, update: {}, create: { key: 'jwtSecret', value: secret } })
  await db.setting.upsert({ where: { key: 'sharePasswordSalt' }, update: {}, create: { key: 'sharePasswordSalt', value: randomBytes(16).toString('hex') } })

  const configuredEmail = process.env.WEB_DEFAULT_ADMIN_EMAIL?.trim()
  const configuredPassword = process.env.WEB_DEFAULT_ADMIN_PASSWORD
  if (!configuredEmail || !configuredPassword || configuredPassword.length < 12) {
    throw new Error('Set WEB_DEFAULT_ADMIN_EMAIL and WEB_DEFAULT_ADMIN_PASSWORD (at least 12 characters) before first startup.')
  }
  const ownerEmail = configuredEmail.toLowerCase()
  const ownerPassword = configuredPassword
  const existing = await db.user.findUnique({ where: { email: ownerEmail } })
  if (!existing) {
    const { hashPassword } = await import('@/lib/auth')
    await db.user.create({
      data: {
        email: ownerEmail,
        passwordHash: hashPassword(ownerPassword),
        name: 'Owner',
        role: 'OWNER',
        quota: -1,
      },
    })
  }
  await db.setting.upsert({ where: { key: 'bootstrapped' }, update: {}, create: { key: 'bootstrapped', value: new Date().toISOString() } })
  invalidateSettingsCache()
}
