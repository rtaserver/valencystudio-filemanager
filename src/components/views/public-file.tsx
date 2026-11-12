'use client'

import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { api, downloadFile } from '@/lib/client-api'
import { onRealtimeChange, realtimeJoinSlug, realtimeLeaveSlug } from '@/lib/realtime'
import { formatBytes, formatDate, fileKind, isPreviewable, kindColor } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Logo } from '@/components/logo'
import { toast } from 'sonner'
import {
  Download,
  Lock,
  Loader2,
  FileX2,
  FileText,
  Image as ImageIcon,
  Film,
  Music,
  FileArchive,
  Code2,
  File as FileIcon,
  FileSpreadsheet,
  FileType2,
  Send,
  CalendarX2,
  Gauge,
  DownloadCloud,
  LockOpen,
  ShieldCheck,
} from 'lucide-react'
import { RealtimeBadge } from '@/components/realtime-badge'

/** Small dot that lights up when a live download counter increments */
function LiveCounterDot({ active }: { active: boolean }) {
  return (
    <span
      aria-hidden
      className={`size-1.5 rounded-full transition-all duration-500 ${
        active ? 'bg-primary scale-125 animate-pulse-dot' : 'bg-muted-foreground/30'
      }`}
    />
  )
}

const kindIcons: Record<string, any> = {
  image: ImageIcon,
  video: Film,
  audio: Music,
  pdf: FileType2,
  archive: FileArchive,
  code: Code2,
  text: FileText,
  doc: FileType2,
  sheet: FileSpreadsheet,
  other: FileIcon,
}

interface ShareInfo {
  name: string
  size: number
  mimeType: string
  createdAt: string
  downloads: number
  hasPassword: boolean
  remainingDownloads: number | null
  ownerName: string
}

export function PublicFileView({ slug }: { slug: string }) {
  const [info, setInfo] = useState<ShareInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [unlocked, setUnlocked] = useState(false)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [counterFlash, setCounterFlash] = useState(false)

  const loadInfo = useCallback(
    (silent = false) => {
      api<{ file: ShareInfo }>(`/api/share/${slug}`)
        .then(r => {
          if (!silent) setError(null)
          setInfo(prev => {
            // nudge the counter with a subtle flash when a live download arrives
            if (prev && r.file.downloads > prev.downloads) {
              setCounterFlash(true)
              setTimeout(() => setCounterFlash(false), 1200)
            }
            return r.file
          })
        })
        .catch(e => {
          if (!silent) setError(e?.message || 'File not found')
        })
    },
    [slug]
  )

  useEffect(() => {
    loadInfo()
  }, [loadInfo])

  // Live counters: join the slug room; any download anywhere refreshes this page
  useEffect(() => {
    realtimeJoinSlug(slug)
    const unsub = onRealtimeChange(e => {
      if (e.domains.includes('downloads') || e.domains.includes('files')) loadInfo(true)
    })
    return () => {
      unsub()
      realtimeLeaveSlug()
    }
  }, [slug, loadInfo])

  const unlock = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      await api(`/api/share/${slug}/unlock`, { method: 'POST', body: { password } })
      setUnlocked(true)
      toast.success('Unlocked — enjoy your download')
    } catch (err: any) {
      toast.error(err?.message || 'Wrong password')
    } finally {
      setBusy(false)
    }
  }

  const kind = info ? fileKind(info.mimeType, info.name) : 'other'
  const Icon = kindIcons[kind] || FileIcon
  const rawUrl = `/api/share/${slug}/raw`

  return (
    <div className="min-h-screen flex flex-col">
      <header className="h-14 shrink-0 flex items-center justify-between px-4 sm:px-6 border-b border-border/60">
        <button onClick={() => { window.location.hash = '/' }} className="cursor-pointer"><Logo /></button>
        <span className="hidden sm:flex items-center gap-1.5 micro-label">
          <ShieldCheck className="size-3 text-emerald-500" /> Secure Cloud Vault
        </span>
        <span className="sm:hidden flex-1" />
        <RealtimeBadge />
      </header>

      <main className="flex-1 flex items-center justify-center px-4 py-10">
        {error ? (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md rounded-lg border border-border/70 bg-card p-10 text-center">
            <span className="inline-grid size-14 place-items-center rounded-md bg-amber-500/10 text-amber-500">
              {error.toLowerCase().includes('expired') ? <CalendarX2 className="size-7" strokeWidth={1.5} /> : error.toLowerCase().includes('limit') ? <Gauge className="size-7" strokeWidth={1.5} /> : <FileX2 className="size-7" strokeWidth={1.5} />}
            </span>
            <h1 className="mt-4 font-semibold text-lg">
              {error.toLowerCase().includes('expired')
                ? 'This link has expired'
                : error.toLowerCase().includes('limit')
                  ? 'Download limit reached'
                  : 'File not available'}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {error.toLowerCase().includes('expired')
                ? 'The sender set an expiry date on this link and it has now passed. Ask them for a fresh link.'
                : error.toLowerCase().includes('limit')
                  ? 'The sender limited how many times this file can be downloaded, and all downloads have been used. Ask them to raise the limit or send a fresh link.'
                  : error}
            </p>
            <Button variant="outline" className="mt-6" onClick={() => { window.location.hash = '/' }}>
              Go to homepage
            </Button>
          </motion.div>
        ) : !info ? (
          <div className="flex flex-col items-center gap-3 text-muted-foreground">
            <Loader2 className="size-6 animate-spin text-amber-500" />
            <span className="text-sm">Fetching file info…</span>
          </div>
        ) : info.hasPassword && !unlocked ? (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md rounded-lg border border-border/70 bg-card p-8">
            <div className="text-center">
              <span className="inline-grid size-12 place-items-center rounded-md bg-amber-500/10 text-amber-500">
                <Lock className="size-5" strokeWidth={1.5} />
              </span>
              <h1 className="mt-4 font-semibold text-lg">Password required</h1>
              <p className="mt-1.5 text-sm text-muted-foreground">This shared file is protected. Enter the password to continue.</p>
            </div>
            <form onSubmit={unlock} className="mt-6 space-y-3">
              <Input
                type="password"
                placeholder="Password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoFocus
              />
              <Button type="submit" className="w-full gap-2" disabled={busy || !password}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : <LockOpen className="size-4" strokeWidth={1.9} />} Unlock file
              </Button>
            </form>
            <div className="mt-5 text-center text-xs text-muted-foreground font-mono tnum truncate">
              {info.name} · {formatBytes(info.size)}
            </div>
          </motion.div>
        ) : (
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="w-full max-w-2xl">
            <div className="rounded-lg border border-border/70 bg-card overflow-hidden shadow-md">
              <div className="p-6 sm:p-7 border-b border-border/60">
                <div className="flex items-start gap-4">
                  <span className={`size-12 rounded-md grid place-items-center shrink-0 ${kindColor(kind)}`}>
                    <Icon className="size-6" strokeWidth={1.5} />
                  </span>
                  <div className="min-w-0">
                    <div className="micro-label mb-1.5">Shared file</div>
                    <h1 className="font-semibold text-lg leading-snug break-all" title={info.name}>{info.name}</h1>
                  </div>
                </div>
                <dl className="mt-6 divide-y divide-border/60 border-y border-border/60">
                  {[
                    ['Size', formatBytes(info.size)],
                    ['Owner', info.ownerName],
                    ['Uploaded', formatDate(info.createdAt)],
                    ['Downloads', `${info.downloads} download${info.downloads !== 1 ? 's' : ''}`],
                  ].map(([k, v]) => (
                    <div key={k} className="flex items-center justify-between py-2.5 gap-4">
                      <dt className="micro-label flex items-center gap-1.5">
                        {k}
                        {k === 'Downloads' && <LiveCounterDot active={counterFlash} />}
                      </dt>
                      <dd
                        className={`font-mono text-[11px] tnum text-right truncate transition-colors duration-700 ${
                          k === 'Downloads' && counterFlash ? 'text-primary' : 'text-foreground/80'
                        }`}
                      >
                        {v}
                      </dd>
                    </div>
                  ))}
                </dl>
                {info.remainingDownloads != null && (
                  <div
                    className={`mt-4 inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-medium tnum ${
                      info.remainingDownloads <= 0
                        ? 'border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400'
                        : info.remainingDownloads <= 3
                          ? 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400'
                          : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                    }`}
                  >
                    <DownloadCloud className="size-3" />
                    {info.remainingDownloads <= 0 ? 'Download limit reached' : `${info.remainingDownloads} download${info.remainingDownloads !== 1 ? 's' : ''} left`}
                  </div>
                )}
              </div>

              {isPreviewable(info.mimeType, info.name) && kind !== 'text' && kind !== 'code' && (
                <div className="bg-muted/30 grid place-items-center p-4 border-b border-border/60">
                  {kind === 'image' && <img src={rawUrl} alt={info.name} className="max-h-[52vh] rounded-lg object-contain" />}
                  {kind === 'video' && <video src={rawUrl} controls preload="metadata" className="max-h-[52vh] w-full rounded-lg" />}
                  {kind === 'audio' && <audio src={rawUrl} controls className="w-full max-w-md" />}
                  {kind === 'pdf' && <iframe src={rawUrl} title={info.name} className="w-full h-[52vh] rounded-lg border-0 bg-white" />}
                </div>
              )}

              <div className="p-6 flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground font-mono text-[11px]">
                  Shared via ValencyStudio · Encrypted Cloud Vault
                </p>
                <Button size="lg" className="gap-2" onClick={() => downloadFile(`/api/share/${slug}/download`)}>
                  <Download className="size-4.5" strokeWidth={1.9} /> Download file
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </main>

      <footer className="shrink-0 border-t border-border/60 px-6 py-4 text-center text-xs text-muted-foreground pb-[env(safe-area-inset-bottom)]">
        <Logo size={24} textClass="opacity-70 scale-90" />
      </footer>
    </div>
  )
}
