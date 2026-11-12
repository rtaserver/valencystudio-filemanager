'use client'

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import QRCode from 'qrcode'
import { BarChart, Bar, ResponsiveContainer, Tooltip, XAxis } from 'recharts'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { api } from '@/lib/client-api'
import { formatBytes } from '@/lib/format'
import type { FileRow } from '@/components/views/files-view'
import { toast } from 'sonner'
import { Copy, Link2, Lock, Loader2, ShieldOff, QrCode, Download, Timer, CalendarClock, Gauge, Infinity as InfinityIcon, TrendingUp } from 'lucide-react'

const EXPIRY_OPTIONS = [
  { value: 'never', label: 'Never expires', minutes: null },
  { value: '60', label: '1 hour', minutes: 60 },
  { value: '1440', label: '1 day', minutes: 1440 },
  { value: '10080', label: '7 days', minutes: 10080 },
  { value: '43200', label: '30 days', minutes: 43200 },
]

const LIMIT_OPTIONS = [
  { value: 'unlimited', label: 'Unlimited downloads', n: null as number | null },
  { value: '1', label: '1 download', n: 1 },
  { value: '5', label: '5 downloads', n: 5 },
  { value: '10', label: '10 downloads', n: 10 },
  { value: '25', label: '25 downloads', n: 25 },
  { value: '100', label: '100 downloads', n: 100 },
]

function expiryLabel(iso: string | null | undefined): string {
  if (!iso) return 'Never expires'
  const t = new Date(iso).getTime()
  if (t <= Date.now()) return 'Expired'
  const diff = t - Date.now()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `Expires in ${mins} min`
  const hours = Math.floor(mins / 60)
  if (hours < 48) return `Expires in ${hours}h ${mins % 60}m`
  const days = Math.floor(hours / 24)
  return `Expires in ${days} day${days !== 1 ? 's' : ''}`
}

export function ShareDialog({ file, onClose }: { file: FileRow | null; onClose: () => void }) {
  const [enabled, setEnabled] = useState(false)
  const [hasPassword, setHasPassword] = useState(false)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [link, setLink] = useState('')
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [showQr, setShowQr] = useState(false)
  const [expiry, setExpiry] = useState('never')
  const [currentExpiry, setCurrentExpiry] = useState<string | null>(null)
  const [limit, setLimit] = useState('unlimited')
  const [currentLimit, setCurrentLimit] = useState<number | null>(null)
  const [usedCount, setUsedCount] = useState(0)
  const [, forceTick] = useState(0)

  // 14-day download analytics for this file (fetched while the dialog is open)
  const { data: analytics, isLoading: analyticsLoading } = useQuery<{
    analytics: { total: number; shareTotal: number; byDay: { date: string; count: number }[] }
  }>({
    queryKey: ['share-stats', file?.id],
    queryFn: () => api(`/api/files/${file!.id}/share`),
    enabled: !!file,
    refetchInterval: 60_000,
  })

  useEffect(() => {
    if (file) {
      setEnabled(file.shareEnabled)
      setHasPassword(file.shareHasPassword)
      setPassword('')
      setQrDataUrl(null)
      setShowQr(false)
      setLink(`${window.location.origin}/#/f/${file.shareSlug}`)
      const exp = file.shareExpiresAt || null
      setCurrentExpiry(exp)
      if (exp && new Date(exp).getTime() > Date.now()) {
        // pick the closest matching option for display
        const minsLeft = (new Date(exp).getTime() - Date.now()) / 60000
        const match = [...EXPIRY_OPTIONS].reverse().find(o => o.minutes && minsLeft <= o.minutes * 1.02)
        setExpiry(match?.value || 'never')
      } else {
        setExpiry('never')
      }
      const lim = (file as any).shareMaxDownloads ?? null
      setCurrentLimit(lim)
      setLimit(lim == null ? 'unlimited' : String(lim))
      setUsedCount((file as any).shareDownloadCount ?? file.downloads ?? 0)
    }
  }, [file])

  // keep the countdown fresh
  useEffect(() => {
    if (!file || !currentExpiry) return
    const t = setInterval(() => forceTick(v => v + 1), 30_000)
    return () => clearInterval(t)
  }, [file, currentExpiry])

  useEffect(() => {
    if (enabled && link) {
      QRCode.toDataURL(link, { width: 220, margin: 1, color: { dark: '#18181b', light: '#ffffff' } })
        .then(setQrDataUrl)
        .catch(() => {})
    }
  }, [enabled, link])

  if (!file) return null

  const save = async (body: Record<string, unknown>, successMsg: string) => {
    setBusy(true)
    try {
      await api(`/api/files/${file.id}/share`, { method: 'PUT', body })
      toast.success(successMsg)
      window.dispatchEvent(new CustomEvent('vs:files-changed'))
    } catch (e: any) {
      toast.error(e?.message || 'Update failed')
    } finally {
      setBusy(false)
    }
  }

  const toggle = async (on: boolean) => {
    setEnabled(on)
    await save({ enabled: on }, on ? 'Share link enabled' : 'Share link revoked')
  }

  const applyPassword = async () => {
    if (password && password.length < 4) {
      toast.error('Password must be at least 4 characters.')
      return
    }
    if (password) {
      await save({ password }, 'Password protection enabled')
      setHasPassword(true)
      setPassword('')
    }
  }

  const removePassword = async () => {
    await save({ removePassword: true }, 'Password protection removed')
    setHasPassword(false)
    setPassword('')
  }

  const changeExpiry = async (value: string) => {
    setExpiry(value)
    const opt = EXPIRY_OPTIONS.find(o => o.value === value)
    try {
      await api(`/api/files/${file.id}/share`, {
        method: 'PUT',
        body: { expiresInMinutes: opt?.minutes ?? null },
      })
      setCurrentExpiry(opt?.minutes ? new Date(Date.now() + opt.minutes * 60000).toISOString() : null)
      toast.success(opt?.minutes ? `Link will expire in ${opt.label}` : 'Link will never expire')
      window.dispatchEvent(new CustomEvent('vs:files-changed'))
    } catch (e: any) {
      toast.error(e?.message || 'Update failed')
    }
  }

  const copy = () => {
    navigator.clipboard.writeText(link).then(
      () => toast.success('Link copied to clipboard'),
      () => toast.error('Could not copy')
    )
  }

  const changeLimit = async (value: string) => {
    setLimit(value)
    const opt = LIMIT_OPTIONS.find(o => o.value === value)
    try {
      await api(`/api/files/${file.id}/share`, { method: 'PUT', body: { maxDownloads: opt?.n ?? null } })
      setCurrentLimit(opt?.n ?? null)
      toast.success(opt?.n == null ? 'Download limit removed' : `Link limited to ${opt.n} download${opt.n !== 1 ? 's' : ''}`)
      window.dispatchEvent(new CustomEvent('vs:files-changed'))
    } catch (e: any) {
      toast.error(e?.message || 'Update failed')
    }
  }

  return (
    <Dialog open={!!file} onOpenChange={o => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[15px]">
            <Link2 className="size-4.5 text-amber-500" /> Share “{file.name}”
          </DialogTitle>
          <DialogDescription className="text-[13px] tnum">
            {formatBytes(file.size)} · {file.downloads} downloads so far
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label className="text-sm">Public link</Label>
              <p className="text-xs text-muted-foreground mt-0.5">Anyone with the link can view and download.</p>
            </div>
            <Switch checked={enabled} onCheckedChange={toggle} disabled={busy} />
          </div>

          {enabled && (
            <>
              <div className="flex items-center gap-2">
                <Input readOnly value={link} className="text-xs font-mono" onFocus={e => e.target.select()} />
                <Button size="icon" variant="outline" onClick={copy} aria-label="Copy link">
                  <Copy className="size-4" />
                </Button>
                <Button
                  size="icon"
                  variant="outline"
                  onClick={() => setShowQr(v => !v)}
                  aria-label="Toggle QR code"
                  title="Show QR code"
                >
                  <QrCode className="size-4" />
                </Button>
              </div>

              {showQr && qrDataUrl && (
                <div className="flex flex-col items-center gap-2 rounded-lg border border-border/60 bg-muted/20 p-4">
                  <img src={qrDataUrl} alt="Share link QR code" className="rounded-lg border border-border/50" width={180} height={180} />
                  <p className="text-[11px] text-muted-foreground">Scan to open on a phone</p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5 text-xs"
                    onClick={() => {
                      const a = document.createElement('a')
                      a.href = qrDataUrl
                      a.download = `valencystudio-qr-${file.shareSlug.slice(0, 8)}.png`
                      a.click()
                    }}
                  >
                    <Download className="size-3" /> Download QR
                  </Button>
                </div>
              )}

              <Separator />

              <div>
                <div className="flex items-center gap-2 mb-2.5">
                  <Timer className="size-4 text-muted-foreground" />
                  <Label className="text-sm">Link expiry</Label>
                  {currentExpiry && (
                    <span className={`ml-auto text-[11px] font-mono flex items-center gap-1 ${new Date(currentExpiry).getTime() <= Date.now() ? 'text-rose-500' : 'text-muted-foreground'}`}>
                      <CalendarClock className="size-3" /> {expiryLabel(currentExpiry)}
                    </span>
                  )}
                </div>
                <Select value={expiry} onValueChange={changeExpiry} disabled={busy}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Choose expiry" />
                  </SelectTrigger>
                  <SelectContent>
                    {EXPIRY_OPTIONS.map(o => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground mt-1.5">
                  After expiry the link stops working for everyone — you can re-enable it anytime.
                </p>
              </div>

              <Separator />

              <div>
                <div className="flex items-center gap-2 mb-2.5">
                  <Gauge className="size-4 text-muted-foreground" />
                  <Label className="text-sm">Download limit</Label>
                  {currentLimit != null && (
                    <span className={`ml-auto text-[11px] font-mono tnum flex items-center gap-1 ${currentLimit - usedCount <= 0 ? 'text-rose-500' : 'text-muted-foreground'}`}>
                      <InfinityIcon className="size-3 opacity-0" />
                      {Math.max(0, currentLimit - usedCount)} of {currentLimit} left
                    </span>
                  )}
                </div>
                <Select value={limit} onValueChange={changeLimit} disabled={busy}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Choose limit" />
                  </SelectTrigger>
                  <SelectContent>
                    {LIMIT_OPTIONS.map(o => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground mt-1.5">
                  Once the limit is hit the link stops working. Only public link downloads count.
                </p>
              </div>

              <Separator />

              <div>
                <div className="flex items-center justify-between gap-4 mb-2.5">
                  <div className="flex items-center gap-2">
                    <Lock className="size-4 text-muted-foreground" />
                    <Label className="text-sm">Password protection</Label>
                  </div>
                  {hasPassword && (
                    <Button variant="ghost" size="sm" className="text-xs text-red-500 hover:text-red-500 gap-1" onClick={removePassword} disabled={busy}>
                      <ShieldOff className="size-3.5" /> Remove
                    </Button>
                  )}
                </div>
                {hasPassword ? (
                  <p className="text-xs text-muted-foreground">This link requires a password to download.</p>
                ) : (
                  <div className="flex items-center gap-2">
                    <Input
                      type="text"
                      placeholder="Set a password…"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && applyPassword()}
                    />
                    <Button size="sm" onClick={applyPassword} disabled={busy || !password}>
                      {busy ? <Loader2 className="size-4 animate-spin" /> : 'Apply'}
                    </Button>
                  </div>
                )}
              </div>
            </>
          )}

          {!enabled && (
            <p className="text-xs text-muted-foreground rounded-lg border border-dashed border-border p-3 text-center">
              Turn on the switch to publish a share link.
            </p>
          )}

          {/* Download analytics — 14-day trend + totals */}
          <div>
            <div className="flex items-center gap-2 mb-2.5">
              <TrendingUp className="size-4 text-muted-foreground" />
              <Label className="text-sm">Download analytics</Label>
              <span className="ml-auto text-[11px] text-muted-foreground">last 14 days</span>
            </div>
            {analyticsLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-14 w-full rounded-lg" />
                <Skeleton className="h-4 w-2/3" />
              </div>
            ) : analytics ? (
              <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
                <div className="h-14">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={analytics.analytics.byDay.map(d => ({ ...d, label: d.date.slice(5) }))} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
                      <XAxis dataKey="label" tick={{ fontSize: 9 }} tickLine={false} axisLine={false} interval={3} />
                      <Tooltip
                        cursor={{ fill: 'oklch(0.5 0 0 / 0.08)' }}
                        contentStyle={{ background: 'oklch(0.205 0.006 90)', border: '1px solid oklch(1 0 0 / 12%)', borderRadius: 8, fontSize: 11 }}
                        labelStyle={{ color: 'oklch(0.71 0.01 90)' }}
                        formatter={(v: any) => [`${v} download${Number(v) !== 1 ? 's' : ''}`, '']}
                      />
                      <Bar dataKey="count" fill="#f59e0b" radius={[3, 3, 0, 0]} maxBarSize={18} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-2 flex items-center gap-4 text-[11px] text-muted-foreground tnum">
                  <span>
                    <span className="font-semibold text-foreground font-mono">{analytics.analytics.total}</span> total download{analytics.analytics.total !== 1 ? 's' : ''}
                  </span>
                  <span className="text-border">·</span>
                  <span>
                    <span className="font-semibold text-amber-600 dark:text-amber-400 font-mono">{analytics.analytics.shareTotal}</span> via this link
                  </span>
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Analytics unavailable.</p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
