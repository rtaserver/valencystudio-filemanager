'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import { api } from '@/lib/client-api'
import { formatBytes, formatDate, timeAgo } from '@/lib/format'
import { AreaChart, Area, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { FileText, HardDrive, History, Send, Download, TrendingUp, Timer, Gauge, LinkIcon, Copy, Plus, XCircle, CheckCircle2, Zap } from 'lucide-react'
import { toast } from 'sonner'
import type { FileRow } from '@/components/views/files-view'

interface DetailsData {
  file: {
    id: string
    name: string
    mimeType: string
    size: number
    status: string
    downloads: number
    partCount: number
    shareEnabled: boolean
    shareHasPassword: boolean
    shareExpiresAt?: string | null
    shareMaxDownloads?: number | null
    shareDownloadCount?: number
    deletedAt: string | null
    createdAt: string
    updatedAt: string
  }
  parts: { index: number; size: number; backend: string; refPreview: string }[]
  downloads: { id: string; ip?: string; userAgent?: string; createdAt: string }[]
  totalDownloads: number
  downloadsPerDay: { date: string; count: number }[]
}

interface TokenLink {
  id: string
  prefix: string
  oneTime: boolean
  usedCount: number
  expiresAt: string
  revoked: boolean
  lastUsedAt: string | null
  createdAt: string
  active: boolean
  expired: boolean
  burnt: boolean
}

const LINK_TTL_OPTIONS = [
  { value: '60', label: '1 hour', minutes: 60 },
  { value: '1440', label: '24 hours', minutes: 1440 },
  { value: '10080', label: '7 days', minutes: 10080 },
  { value: '43200', label: '30 days', minutes: 43200 },
]

function timeLeft(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now()
  if (diff <= 0) return 'expired'
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return '<1 min left'
  if (mins < 60) return `${mins} min left`
  const hours = Math.floor(mins / 60)
  if (hours < 48) return `${hours}h ${mins % 60}m left`
  const days = Math.floor(hours / 24)
  return `${days} day${days !== 1 ? 's' : ''} left`
}

export function DetailsDialog({ file, onClose }: { file: FileRow | null; onClose: () => void }) {
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery<DetailsData>({
    queryKey: ['file-details', file?.id],
    queryFn: () => api(`/api/files/${file!.id}/details`),
    enabled: !!file,
  })

  if (!file) return null

  return (
    <Dialog open={!!file} onOpenChange={o => !o && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[15px]">
            <FileText className="size-4 text-primary" /> File details
          </DialogTitle>
          <DialogDescription className="break-all text-[13px]">{file.name}</DialogDescription>
        </DialogHeader>

        {isLoading || !data ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-12 rounded-lg" />
              ))}
            </div>
            <Skeleton className="h-28 rounded-lg" />
            <Skeleton className="h-24 rounded-lg" />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <Fact label="Size" value={formatBytes(data.file.size)} mono />
              <Fact label="Type" value={data.file.mimeType} mono />
              <Fact label="Uploaded" value={formatDate(data.file.createdAt)} mono />
              <Fact label="Modified" value={timeAgo(data.file.updatedAt)} mono />
              <Fact label="Status" value={data.file.status} ready={data.file.status === 'READY'} />
              <Fact label="Downloads" value={String(data.file.downloads)} mono />
            </div>

            {data.file.shareEnabled && (
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-2">
                <Send className="size-3.5" /> Public link active{data.file.shareHasPassword ? ' (password protected)' : ''}
                {data.file.shareExpiresAt && (
                  <span className={`ml-auto font-mono flex items-center gap-1 ${new Date(data.file.shareExpiresAt).getTime() <= Date.now() ? 'text-rose-500' : 'text-emerald-600 dark:text-emerald-400/90'}`}>
                    <Timer className="size-3" />
                    {new Date(data.file.shareExpiresAt).getTime() <= Date.now() ? 'link expired' : `until ${formatDate(data.file.shareExpiresAt)}`}
                  </span>
                )}
              </div>
            )}
            {data.file.shareEnabled && data.file.shareMaxDownloads != null && (
              <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-xs flex items-center gap-2">
                <Gauge className="size-3.5 text-muted-foreground" />
                Download limit
                <span className="ml-auto font-medium font-mono tnum">
                  {Math.max(0, data.file.shareMaxDownloads - (data.file.shareDownloadCount ?? 0))} of {data.file.shareMaxDownloads} left
                  <span className="text-muted-foreground font-normal"> · {(data.file.shareDownloadCount ?? 0)} used</span>
                </span>
              </div>
            )}
            {data.file.deletedAt && (
              <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-600 dark:text-rose-400">
                In trash — purged automatically after 30 days
              </div>
            )}

            <Separator />

            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <TrendingUp className="size-4 text-foreground/80" /> Downloads — last 14 days
                </div>
                <span className="text-xs text-muted-foreground tnum">peak {Math.max(0, ...data.downloadsPerDay.map(d => d.count))}/day</span>
              </div>
              <div className="h-28 -ml-2">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data.downloadsPerDay.map(d => ({ ...d, label: d.date.slice(5) }))} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
                    <defs>
                      <linearGradient id="dlGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.45} />
                        <stop offset="100%" stopColor="#f59e0b" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="label" tick={{ fontSize: 9 }} tickLine={false} axisLine={false} interval={3} stroke="oklch(0.58 0.006 90)" />
                    <YAxis tick={{ fontSize: 9 }} tickLine={false} axisLine={false} allowDecimals={false} width={22} stroke="oklch(0.58 0.006 90)" />
                    <Tooltip
                      contentStyle={{ background: 'oklch(0.205 0.006 90)', border: '1px solid oklch(1 0 0 / 12%)', borderRadius: 8, fontSize: 11, color: '#e4e4e7' }}
                      labelStyle={{ color: 'oklch(0.71 0.01 90)' }}
                      formatter={(v: any) => [`${v} download${v !== 1 ? 's' : ''}`, '']}
                    />
                    <Area type="monotone" dataKey="count" stroke="#f59e0b" strokeWidth={1.8} fill="url(#dlGrad)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            <Separator />

            <ExpiringLinksSection fileId={data.file.id} fileReady={data.file.status === 'READY' && !data.file.deletedAt} queryClient={queryClient} />

            <Separator />

            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <HardDrive className="size-4 text-foreground/80" />
                  {data.parts.length === 1
                    ? 'Encrypted Cloud Storage Object'
                    : `Storage objects (${data.parts.length})`}
                </div>
                {data.parts.length === 1 && (
                  <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/25">
                    Zero-spool stream
                  </Badge>
                )}
              </div>
              {data.parts.length === 0 ? (
                <p className="text-xs text-muted-foreground">No parts stored yet.</p>
              ) : (
                <div className="rounded-lg border border-border/60 max-h-36 overflow-y-auto">
                  {data.parts.map(p => (
                    <div key={p.index} className="flex items-center justify-between px-3 py-2 text-xs border-b border-border/40 last:border-0">
                      <span className="font-mono">#{String(p.index).padStart(3, '0')}</span>
                      <span className="text-muted-foreground font-mono tnum">{formatBytes(p.size)}</span>
                      <Badge variant="outline" className="text-[9px] capitalize">{p.backend}</Badge>
                      <span className="font-mono text-[10px] text-muted-foreground hidden sm:inline">{p.refPreview}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <Separator />

            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <History className="size-4 text-foreground/80" /> Recent downloads
                </div>
                <span className="text-xs text-muted-foreground">{data.totalDownloads} total</span>
              </div>
              {data.downloads.length === 0 ? (
                <p className="text-xs text-muted-foreground">No downloads yet.</p>
              ) : (
                <div className="space-y-1.5 max-h-40 overflow-y-auto">
                  {data.downloads.map(d => (
                    <div key={d.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Download className="size-3 text-muted-foreground shrink-0" />
                      <span className="font-mono">{d.ip || '—'}</span>
                      <span className="truncate flex-1">{(d.userAgent || '').slice(0, 44)}</span>
                      <span className="whitespace-nowrap">{timeAgo(d.createdAt)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** Create + manage expiring direct-download links (vd_… one-time or timed). */
function ExpiringLinksSection({ fileId, fileReady, queryClient }: { fileId: string; fileReady: boolean; queryClient: ReturnType<typeof useQueryClient> }) {
  const { data, isLoading, refetch } = useQuery<{ links: TokenLink[] }>({
    queryKey: ['file-links', fileId],
    queryFn: () => api(`/api/files/${fileId}/links`),
    enabled: fileReady,
  })
  const [ttl, setTtl] = useState('1440')
  const [oneTime, setOneTime] = useState(false)
  const [creating, setCreating] = useState(false)
  const [secretUrl, setSecretUrl] = useState<string | null>(null)

  const links = data?.links || []

  const create = async () => {
    setCreating(true)
    try {
      const res = await api<{ link: TokenLink & { url: string } }>(`/api/files/${fileId}/links`, {
        method: 'POST',
        body: { ttlMinutes: Number(ttl), oneTime },
      })
      setSecretUrl(res.link.url)
      await refetch()
      toast.success(oneTime ? 'One-time link created' : 'Expiring link created')
    } catch (e: any) {
      toast.error(e?.message || 'Could not create link')
    } finally {
      setCreating(false)
    }
  }

  const revoke = async (id: string) => {
    try {
      await api(`/api/file-links/${id}`, { method: 'DELETE' })
      await refetch()
      toast.success('Link revoked')
      queryClient.invalidateQueries({ queryKey: ['file-details', fileId] })
    } catch (e: any) {
      toast.error(e?.message || 'Revoke failed')
    }
  }

  const copySecret = () => {
    if (!secretUrl) return
    navigator.clipboard.writeText(secretUrl).then(
      () => toast.success('Direct link copied'),
      () => toast.error('Could not copy')
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <LinkIcon className="size-4 text-foreground/80" /> Expiring download links
        </div>
        <span className="micro-label">direct · no login</span>
      </div>
      <p className="text-[11px] text-muted-foreground mb-3">
        Self-destructing direct URLs that download the file without opening the app.
      </p>

      {!fileReady ? (
        <p className="text-xs text-muted-foreground rounded-lg border border-dashed border-border p-3 text-center">
          Links become available once the file is ready.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-muted/10 p-2.5">
            <Select value={ttl} onValueChange={setTtl}>
              <SelectTrigger className="h-8 w-[110px] text-xs" aria-label="Link expiry">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LINK_TTL_OPTIONS.map(o => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none" title="The link dies right after the first download">
              <Switch checked={oneTime} onCheckedChange={setOneTime} className="scale-90" />
              <Zap className={`size-3.5 ${oneTime ? 'text-amber-500' : ''}`} />
              One-time
            </label>
            <Button size="sm" className="ml-auto gap-1.5 h-8 text-xs" onClick={create} disabled={creating}>
              <Plus className="size-3.5" /> {creating ? 'Creating…' : 'Create link'}
            </Button>
          </div>

          {secretUrl && (
            <div className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 space-y-2">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="size-3.5" /> Link created — copy it now, it is shown only once
              </div>
              <div className="flex items-center gap-2">
                <Input readOnly value={secretUrl} className="text-[11px] font-mono h-8" onFocus={e => e.target.select()} aria-label="Expiring download URL" />
                <Button size="icon" variant="outline" className="size-8 shrink-0" onClick={copySecret} aria-label="Copy link">
                  <Copy className="size-3.5" />
                </Button>
                <Button size="icon" variant="ghost" className="size-8 shrink-0" onClick={() => setSecretUrl(null)} aria-label="Dismiss">
                  <XCircle className="size-3.5" />
                </Button>
              </div>
            </div>
          )}

          <div className="mt-3 space-y-1.5 max-h-44 overflow-y-auto">
            {isLoading ? (
              <>
                <Skeleton className="h-9 rounded-md" />
                <Skeleton className="h-9 rounded-md" />
              </>
            ) : links.length === 0 ? (
              <p className="text-[11px] text-muted-foreground text-center py-2">No expiring links yet.</p>
            ) : (
              links.map(l => {
                const stateBadge = l.revoked
                  ? <Badge variant="outline" className="text-[9px] border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400">revoked</Badge>
                  : l.burnt
                    ? <Badge variant="outline" className="text-[9px] border-border/60 bg-muted/30 text-muted-foreground">used up</Badge>
                    : l.expired
                      ? <Badge variant="outline" className="text-[9px] border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400">expired</Badge>
                      : <Badge variant="outline" className="text-[9px] border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">{timeLeft(l.expiresAt)}</Badge>
                return (
                  <div key={l.id} className={`flex items-center gap-2 rounded-md border border-border/40 px-2.5 py-1.5 text-xs ${l.active ? 'bg-card' : 'opacity-60'}`}>
                    <span className="font-mono text-[11px]">{l.prefix}…</span>
                    {l.oneTime && (
                      <Badge variant="outline" className="text-[9px] border-border/60 bg-muted/30 text-foreground gap-0.5">
                        <Zap className="size-2.5 text-amber-500" /> one-time
                      </Badge>
                    )}
                    {stateBadge}
                    <span className="text-[10px] text-muted-foreground font-mono ml-auto whitespace-nowrap" title={l.lastUsedAt ? `last used ${timeAgo(l.lastUsedAt)}` : 'never used'}>
                      {l.usedCount > 0 ? `${l.usedCount}× used` : 'never used'}
                    </span>
                    {l.active && (
                      <Button size="icon" variant="ghost" className="size-6 shrink-0 text-rose-500 hover:text-rose-600" onClick={() => revoke(l.id)} aria-label="Revoke link" title="Revoke">
                        <XCircle className="size-3.5" />
                      </Button>
                    )}
                  </div>
                )
              })
            )}
          </div>
        </>
      )}
    </div>
  )
}

function Fact({ label, value, mono, ready }: { label: string; value: string; mono?: boolean; ready?: boolean }) {
  return (
    <div className="rounded-lg border border-border/50 bg-muted/20 px-3 py-2">
      <div className="micro-label">{label}</div>
      <div
        className={`text-[13px] font-medium truncate mt-1 tnum ${mono ? 'font-mono' : ''} ${ready ? 'text-emerald-600 dark:text-emerald-400' : ''}`}
        title={value}
      >
        {value}
      </div>
    </div>
  )
}
