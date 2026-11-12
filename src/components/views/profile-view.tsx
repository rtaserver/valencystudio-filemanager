'use client'

import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { api } from '@/lib/client-api'
import { useAuth } from '@/lib/auth-context'
import { formatBytes, formatDate, timeAgo } from '@/lib/format'
import { useTheme } from 'next-themes'
import { toast } from 'sonner'
import { Loader2, Save, User, KeyRound, Palette, Sun, Moon, Laptop, Cloud, PieChart as PieIcon, Terminal, Copy, Plus, ShieldCheck, ShieldOff, Code2, MonitorSmartphone } from 'lucide-react'

// Monochrome type ramp — amber leads, zinc shades differentiate. No rainbow.
const DONUT_COLORS: Record<string, string> = {
  image: '#f59e0b',
  video: '#d4d4d8',
  audio: '#a1a1aa',
  pdf: '#71717a',
  archive: '#52525b',
  code: '#fbbf24',
  text: '#3f3f46',
  doc: '#e4e4e7',
  sheet: '#fcd34d',
  other: '#8b8b94',
}

function StorageDonut() {
  const { data } = useQuery<{ byType: { type: string; count: number; size: number }[]; totalSize: number; totalCount: number }>({
    queryKey: ['user-stats'],
    queryFn: () => fetch('/api/user/stats').then(r => r.json()),
  })

  if (!data || data.byType.length === 0) return null
  const chartData = data.byType.map(g => ({ name: g.type, value: g.size, count: g.count }))

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <PieIcon className="size-4.5 text-amber-500" /> Storage by type
        </CardTitle>
        <CardDescription className="tnum">
          {data.totalCount} files · {formatBytes(data.totalSize)} total
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col sm:flex-row items-center gap-6">
          <div className="h-44 w-44 shrink-0 relative">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={chartData}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={52}
                  outerRadius={80}
                  paddingAngle={3}
                  strokeWidth={0}
                >
                  {chartData.map((entry, i) => (
                    <Cell key={entry.name} fill={DONUT_COLORS[entry.name] || '#a1a1aa'} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value: any, name: any) => [formatBytes(Number(value)), String(name)]}
                  contentStyle={{ background: 'oklch(0.205 0.006 90)', border: '1px solid oklch(1 0 0 / 12%)', borderRadius: 8, fontSize: 12 }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 grid place-items-center pointer-events-none">
              <div className="text-center">
                <div className="text-sm font-bold font-mono tnum">{formatBytes(data.totalSize, 0)}</div>
                <div className="text-[10px] text-muted-foreground">used</div>
              </div>
            </div>
          </div>
          <div className="flex-1 space-y-2 min-w-0">
            {data.byType.map(g => (
              <div key={g.type} className="flex items-center gap-2.5 text-sm">
                <span className="size-2.5 rounded-full shrink-0" style={{ background: DONUT_COLORS[g.type] || '#a1a1aa' }} />
                <span className="capitalize flex-1">{g.type}</span>
                <span className="text-xs text-muted-foreground font-mono tnum">{g.count}×</span>
                <span className="text-xs font-medium font-mono tnum w-16 text-right">{formatBytes(g.size)}</span>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

interface ApiTokenRow {
  id: string
  name: string
  prefix: string
  createdAt: string
  lastUsedAt: string | null
  revoked: boolean
}

function ApiTokensCard() {
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery<{ tokens: ApiTokenRow[] }>({
    queryKey: ['api-tokens'],
    queryFn: () => api('/api/user/tokens'),
  })
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const [newSecret, setNewSecret] = useState<{ token: ApiTokenRow; secret: string } | null>(null)
  const [copied, setCopied] = useState(false)

  const tokens = data?.tokens || []
  const active = tokens.filter(t => !t.revoked)

  const create = async () => {
    if (!name.trim()) return
    setCreating(true)
    try {
      const r = await api<{ token: ApiTokenRow; secret: string }>('/api/user/tokens', {
        method: 'POST',
        body: { name: name.trim().slice(0, 60) },
      })
      setNewSecret(r)
      setName('')
      queryClient.invalidateQueries({ queryKey: ['api-tokens'] })
    } catch (e: any) {
      toast.error(e?.message || 'Token creation failed')
    } finally {
      setCreating(false)
    }
  }

  const revoke = async (t: ApiTokenRow) => {
    try {
      await api(`/api/user/tokens/${t.id}`, { method: 'DELETE' })
      toast.success(`Token "${t.name}" revoked`)
      queryClient.invalidateQueries({ queryKey: ['api-tokens'] })
    } catch (e: any) {
      toast.error(e?.message || 'Revoke failed')
    }
  }

  const copySecret = async () => {
    if (!newSecret) return
    try {
      await navigator.clipboard.writeText(newSecret.secret)
      setCopied(true)
      toast.success('Token copied to clipboard')
    } catch {
      toast.error('Copy failed — select the token manually')
    }
  }

  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const curlExample = newSecret
    ? `curl -H "Authorization: Bearer ${newSecret.secret}" \\\n  "${origin}/api/files?folder=root"`
    : ''

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Terminal className="size-4.5 text-amber-500" /> API tokens
        </CardTitle>
        <CardDescription>
          Personal access tokens for scripts &amp; CLI. Send them as{' '}
          <code className="text-[11px] px-1 py-0.5 rounded bg-muted font-mono">Authorization: Bearer vs_…</code>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Token name (e.g. &ldquo;backup script&rdquo;)"
            maxLength={60}
            onKeyDown={e => e.key === 'Enter' && create()}
          />
          <Button onClick={create} disabled={creating || !name.trim()} className="gap-1.5 shrink-0">
            {creating ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} Create token
          </Button>
        </div>

        {isLoading ? (
          <Skeleton className="h-16 rounded-lg" />
        ) : tokens.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/60 px-4 py-5 text-center text-xs text-muted-foreground">
            No tokens yet. Create one to call the API from scripts.
          </div>
        ) : (
          <div className="space-y-2">
            {tokens.map(t => (
              <div
                key={t.id}
                className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors ${
                  t.revoked ? 'border-border/40 bg-muted/10 opacity-60' : 'border-border/60 bg-card'
                }`}
              >
                <span className={`size-8 rounded-md grid place-items-center shrink-0 border ${t.revoked ? 'bg-muted/30 border-border/40' : 'bg-amber-500/12 border-amber-500/20'}`}>
                  {t.revoked ? <ShieldOff className="size-4 text-muted-foreground" /> : <KeyRound className="size-4 text-amber-500" />}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate flex items-center gap-2">
                    {t.name}
                    {t.revoked && <Badge variant="outline" className="text-[9px] text-red-500 border-red-500/40">revoked</Badge>}
                  </div>
                  <div className="text-[11px] text-muted-foreground font-mono truncate">
                    {t.prefix}…&ensp;·&ensp;created {timeAgo(t.createdAt)}
                    {t.lastUsedAt ? ` · used ${timeAgo(t.lastUsedAt)}` : ' · never used'}
                  </div>
                </div>
                {!t.revoked && (
                  <Button size="sm" variant="outline" className="gap-1 text-red-500 hover:text-red-500 shrink-0" onClick={() => revoke(t)}>
                    <ShieldOff className="size-3.5" /> Revoke
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5 text-[11px] text-muted-foreground leading-relaxed">
          <span className="font-medium text-foreground/80">Works with:</span>{' '}
          <code className="font-mono">GET /api/files</code>,{' '}
          <code className="font-mono">GET /api/folders</code>,{' '}
          <code className="font-mono">GET /api/files/&lt;id&gt;/download</code>,{' '}
          <code className="font-mono">GET /api/user/stats</code>{' '}
          — the same endpoints your browser uses, with <code className="font-mono">Bearer</code> auth instead of cookies.
        </div>
      </CardContent>

      {/* show-once secret dialog */}
      <Dialog open={!!newSecret} onOpenChange={o => !o && setNewSecret(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-[15px]">
              <ShieldCheck className="size-4 text-amber-500" /> Token created
            </DialogTitle>
            <DialogDescription className="text-[13px]">
              Copy it now — <span className="text-foreground font-medium">this is the only time</span> the full token is shown. Only a sha-256 hash is stored.
            </DialogDescription>
          </DialogHeader>
          {newSecret && (
            <div className="space-y-3">
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                <div className="micro-label mb-1.5">
                  {newSecret.token.name} · {newSecret.token.prefix}…
                </div>
                <span className="font-mono text-xs break-all leading-relaxed text-amber-600 dark:text-amber-400 select-all">
                  {newSecret.secret}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" className="gap-1.5" onClick={copySecret}>
                  {copied ? <ShieldCheck className="size-3.5 text-amber-500" /> : <Copy className="size-3.5" />} {copied ? 'Copied' : 'Copy token'}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  onClick={() => {
                    navigator.clipboard.writeText(curlExample).then(
                      () => toast.success('curl example copied'),
                      () => toast.error('Copy failed')
                    )
                  }}
                >
                  <Code2 className="size-3.5" /> Copy curl example
                </Button>
              </div>
              <pre className="text-[10.5px] leading-relaxed bg-muted/50 border border-border/60 rounded-md p-2.5 overflow-x-auto font-mono text-muted-foreground whitespace-pre-wrap break-all">{curlExample}</pre>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  )
}

export function ProfileView() {
  const { user, stats, refresh } = useAuth()
  const { theme, setTheme } = useTheme()
  const [name, setName] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [savingName, setSavingName] = useState(false)
  const [savingPassword, setSavingPassword] = useState(false)

  useEffect(() => {
    if (user) setName(user.name || '')
  }, [user])

  if (!user) return null

  const saveName = async () => {
    setSavingName(true)
    try {
      await api('/api/auth/profile', { method: 'PATCH', body: { name } })
      await refresh()
      toast.success('Profile updated')
    } catch (e: any) {
      toast.error(e?.message || 'Update failed')
    } finally {
      setSavingName(false)
    }
  }

  const savePassword = async () => {
    if (newPassword.length < 6) {
      toast.error('New password must be at least 6 characters.')
      return
    }
    setSavingPassword(true)
    try {
      await api('/api/auth/profile', { method: 'PATCH', body: { currentPassword, newPassword } })
      setCurrentPassword('')
      setNewPassword('')
      toast.success('Password changed')
    } catch (e: any) {
      toast.error(e?.message || 'Password change failed')
    } finally {
      setSavingPassword(false)
    }
  }

  const quota = user.quota

  return (
    <div className="max-w-2xl space-y-5">
      <StorageDonut />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <User className="size-4.5 text-amber-500" /> Profile
          </CardTitle>
          <CardDescription>Your public display name and account info.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="pname">Display name</Label>
            <div className="flex gap-2">
              <Input id="pname" value={name} onChange={e => setName(e.target.value)} placeholder="Your name" />
              <Button onClick={saveName} disabled={savingName} className="gap-1.5 shrink-0">
                {savingName ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save
              </Button>
            </div>
          </div>
          <Separator />
          <div className="grid sm:grid-cols-2 gap-4 text-sm">
            <div>
              <div className="micro-label mb-1.5">Email</div>
              <div className="font-medium truncate">{user.email}</div>
            </div>
            <div>
              <div className="micro-label mb-1.5">Role</div>
              <Badge variant="outline" className="border-amber-500/40 text-amber-500">{user.role}</Badge>
            </div>
            <div>
              <div className="micro-label mb-1.5">Member since</div>
              <div className="font-medium font-mono text-[13px] tnum">{formatDate(user.createdAt)}</div>
            </div>
            <div>
              <div className="micro-label mb-1.5">Storage used</div>
              <div className="font-medium font-mono text-[13px] tnum">
                {formatBytes(stats?.usedBytes || 0)} {quota === -1 ? 'of unlimited' : `of ${formatBytes(quota)}`}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="size-4.5 text-amber-500" /> Change password
          </CardTitle>
          <CardDescription>Use at least 6 characters. You stay signed in on this device.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="cpass">Current password</Label>
              <Input id="cpass" type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} placeholder="••••••••" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="npass">New password</Label>
              <Input id="npass" type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="••••••••" />
            </div>
          </div>
          <Button onClick={savePassword} disabled={savingPassword || !currentPassword || !newPassword} className="gap-1.5">
            {savingPassword ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />} Update password
          </Button>
        </CardContent>
      </Card>

      <ApiTokensCard />

      <PwaInstallCard />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Palette className="size-4.5 text-amber-500" /> Appearance
          </CardTitle>
          <CardDescription>Pick a theme for the dashboard.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            {[
              { v: 'light', label: 'Light', icon: Sun },
              { v: 'dark', label: 'Dark', icon: Moon },
              { v: 'system', label: 'System', icon: Laptop },
            ].map(t => (
              <button
                key={t.v}
                onClick={() => setTheme(t.v)}
                className={`flex items-center gap-2 rounded-lg border px-3.5 py-2 text-sm cursor-pointer transition-colors ${
                  theme === t.v ? 'border-amber-500/60 bg-amber-500/10 text-amber-500' : 'border-border hover:bg-accent'
                }`}
              >
                <t.icon className="size-4" /> {t.label}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="rounded-lg border border-border/60 bg-muted/20 p-4 flex items-center gap-3 text-sm text-muted-foreground">
        <Cloud className="size-5 text-emerald-500 shrink-0" />
        All your files are stored securely in the private cloud vault — encrypted native documents up to 2 GB with zero-spool streaming.
      </div>
    </div>
  )
}

/** Install the app as a PWA (uses the captured beforeinstallprompt when available). */
function PwaInstallCard() {
  const [promptEvent, setPromptEvent] = useState<any>(null)
  const [installed, setInstalled] = useState(false)

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault()
      setPromptEvent(e)
    }
    const onInstalled = () => {
      setInstalled(true)
      setPromptEvent(null)
    }
    const standaloneQuery = window.matchMedia('(display-mode: standalone)')
    const onStandaloneChange = () => {
      if (standaloneQuery.matches) setInstalled(true)
    }
    standaloneQuery.addEventListener('change', onStandaloneChange)
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      standaloneQuery.removeEventListener('change', onStandaloneChange)
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  const install = async () => {
    if (!promptEvent) return
    promptEvent.prompt()
    const choice = await promptEvent.userChoice.catch(() => null)
    if (choice?.outcome === 'accepted') {
      toast.success('ValencyStudio installed — find it on your home screen')
      setPromptEvent(null)
    }
  }

  const isStandalone = typeof window !== 'undefined' && window.matchMedia('(display-mode: standalone)').matches

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <MonitorSmartphone className="size-4.5 text-amber-500" /> Install as app
        </CardTitle>
        <CardDescription>Run ValencyStudio like a native app — own window, offline shell, home-screen icon.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {installed || isStandalone ? (
          <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 text-sm text-amber-600 dark:text-amber-400">
            <MonitorSmartphone className="size-4 shrink-0" /> App installed — you are running the standalone version.
          </div>
        ) : promptEvent ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={install} className="gap-1.5">
              <MonitorSmartphone className="size-4" /> Install ValencyStudio
            </Button>
            <p className="text-xs text-muted-foreground">One click — no store needed.</p>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground leading-relaxed">
            <span className="font-medium text-foreground">Manual install:</span>{' '}
            <span className="font-mono text-[11px]">Chrome/Edge</span> menu → <em>Install app</em> ·{' '}
            <span className="font-mono text-[11px]">iPhone</span> Share → <em>Add to Home Screen</em> ·{' '}
            <span className="font-mono text-[11px]">Android</span> menu → <em>Add to home screen</em>
          </div>
        )}
        <ul className="text-[11px] text-muted-foreground grid sm:grid-cols-3 gap-1.5">
          <li className="flex items-center gap-1.5"><ShieldCheck className="size-3 text-amber-500 shrink-0" /> Works offline for cached pages</li>
          <li className="flex items-center gap-1.5"><ShieldCheck className="size-3 text-amber-500 shrink-0" /> Instant launch from dock/taskbar</li>
          <li className="flex items-center gap-1.5"><ShieldCheck className="size-3 text-amber-500 shrink-0" /> No browser UI clutter</li>
        </ul>
      </CardContent>
    </Card>
  )
}
