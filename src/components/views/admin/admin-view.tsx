'use client'

import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, downloadFile } from '@/lib/client-api'
import { formatBytes, formatDate, timeAgo, actionLabel, statusColor, fileKind, kindColor } from '@/lib/format'
import { navigate } from '@/lib/router'
import { useAuth } from '@/lib/auth-context'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts'
import { toast } from 'sonner'
import {
  Users,
  Files,
  HardDrive,
  DownloadCloud,
  Download,
  TrendingUp,
  Activity,
  Crown,
  ShieldCheck,
  Search,
  Trash2,
  Loader2,
  RefreshCw,
  Send,
  Radar,
  Save,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  KeyRound,
  Globe,
  ScrollText,
  Database,
  ExternalLink,
  ArrowLeftRight,
  FolderOpen,
  Star,
  Share2,
  Image as ImageIcon,
  Film,
  Music,
  FileType2,
  FileArchive,
  Code2,
  FileText,
  FileSpreadsheet,
  File as FileIcon,
} from 'lucide-react'

// ============================== Overview ==============================

interface OverviewData {
  stats: { users: number; files: number; storage: number; downloadsTotal: number; downloadsToday: number; downloadsWeek: number }
  series: { date: string; uploads: number; downloads: number; storageBytes: number }[]
  topUsers: { email: string; name?: string; role: string; storage: number; files: number }[]
  recentActivity: { id: string; action: string; detail?: string; createdAt: string; userEmail?: string }[]
  recentFiles: { id: string; name: string; size: number; createdAt: string; owner: string }[]
  storageHealth: { backend: string; storageChatId: string; botUsername?: string | null; configured: boolean }
}

function StatCard({ icon: Icon, label, value, sub, accent }: { icon: any; label: string; value: string; sub?: string; accent: string }) {
  return (
    <Card className="relative overflow-hidden">
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div>
            <div className="micro-label">{label}</div>
            <div className="text-2xl font-bold mt-2 font-mono tnum">{value}</div>
            {sub && <div className="text-xs text-muted-foreground mt-1 tnum">{sub}</div>}
          </div>
          <span className={`size-10 rounded-lg grid place-items-center ${accent}`}>
            <Icon className="size-5" strokeWidth={1.9} />
          </span>
        </div>
      </CardContent>
    </Card>
  )
}

function Overview({ onGoStorage }: { onGoStorage: () => void }) {
  const { data, isLoading } = useQuery<OverviewData>({
    queryKey: ['admin-overview'],
    queryFn: () => api('/api/admin/overview'),
    refetchInterval: 30_000,
  })

  if (isLoading || !data) {
    return (
      <div className="space-y-4">
        <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-lg" />)}
        </div>
        <Skeleton className="h-72 rounded-lg" />
      </div>
    )
  }

  const chartData = data.series.map(s => ({ ...s, label: s.date.slice(5) }))
  const maxTop = Math.max(1, ...data.topUsers.map(u => u.storage))

  return (
    <div className="space-y-5">
      {/* Storage health banner */}
      {!data.storageHealth.configured && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/8 p-4 flex flex-wrap items-center gap-3">
          <AlertTriangle className="size-5 text-amber-500 shrink-0" />
          <div className="flex-1 min-w-[220px]">
            <div className="font-semibold text-sm">Cloud storage backend is not configured yet</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              Uploads will fail until you connect a storage chat. Run the setup wizard — it takes ~2 minutes.
            </div>
          </div>
          <Button size="sm" onClick={onGoStorage} className="gap-1.5">
            <Radar className="size-3.5" /> Open setup wizard
          </Button>
        </div>
      )}

      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard icon={Users} label="Users" value={String(data.stats.users)} sub="registered accounts" accent="bg-amber-500/12 text-amber-500" />
        <StatCard icon={Files} label="Files" value={String(data.stats.files)} sub="ready in storage" accent="bg-zinc-500/12 text-zinc-500" />
        <StatCard icon={HardDrive} label="Storage used" value={formatBytes(data.stats.storage)} sub="across all users" accent="bg-amber-500/12 text-amber-500" />
        <StatCard icon={DownloadCloud} label="Downloads" value={String(data.stats.downloadsTotal)} sub={`${data.stats.downloadsToday} today · ${data.stats.downloadsWeek} this week`} accent="bg-zinc-500/12 text-zinc-500" />
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="size-4.5 text-amber-500" /> Activity — last 30 days
            </CardTitle>
            <CardDescription>Daily uploads and downloads</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-64 relative">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
                  <defs>
                    <linearGradient id="gU" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#a1a1aa" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#a1a1aa" stopOpacity={0.02} />
                    </linearGradient>
                    <linearGradient id="gD" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#f59e0b" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.5 0 0 / 0.15)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} interval={4} />
                  <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ background: 'oklch(0.205 0.006 90)', border: '1px solid oklch(1 0 0 / 12%)', borderRadius: 8, fontSize: 12 }}
                    labelStyle={{ color: 'oklch(0.71 0.01 90)' }}
                  />
                  <Area type="monotone" dataKey="uploads" stroke="#a1a1aa" strokeWidth={2} fill="url(#gU)" name="Uploads" />
                  <Area type="monotone" dataKey="downloads" stroke="#f59e0b" strokeWidth={2} fill="url(#gD)" name="Downloads" />
                </AreaChart>
              </ResponsiveContainer>
              {data.series.every(s => s.uploads === 0 && s.downloads === 0) && (
                <div className="absolute inset-0 grid place-items-center pointer-events-none">
                  <div className="flex flex-col items-center gap-1.5 rounded-lg border border-dashed border-border/70 bg-background/80 backdrop-blur-[2px] px-6 py-4">
                    <Activity className="size-5 text-muted-foreground/60" />
                    <p className="text-sm font-medium text-muted-foreground">No activity in the last 30 days</p>
                    <p className="text-[11px] text-muted-foreground/70">Uploads and downloads will appear here.</p>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Crown className="size-4.5 text-amber-500" /> Top storage consumers
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3.5">
            {data.topUsers.length === 0 && <p className="text-sm text-muted-foreground">No files yet.</p>}
            {data.topUsers.map(u => (
              <div key={u.email}>
                <div className="flex justify-between text-xs mb-1.5">
                  <span className="font-medium truncate max-w-[160px]" title={u.email}>{u.name || u.email}</span>
                  <span className="text-muted-foreground font-mono tnum">{formatBytes(u.storage)}</span>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div className="h-full rounded-full bg-amber-500" style={{ width: `${Math.max(4, (u.storage / maxTop) * 100)}%` }} />
                </div>
                <div className="text-[10px] text-muted-foreground mt-1 tnum">{u.files} files · {u.role}</div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Database className="size-4.5 text-zinc-500" /> Storage growth — 30 days
            </CardTitle>
            <CardDescription>Cumulative live storage (excludes trash)</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: -6 }}>
                  <defs>
                    <linearGradient id="gS" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#f59e0b" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.5 0 0 / 0.15)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} interval={4} />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v: number) => formatBytes(v, 0)}
                    width={58}
                  />
                  <Tooltip
                    contentStyle={{ background: 'oklch(0.205 0.006 90)', border: '1px solid oklch(1 0 0 / 12%)', borderRadius: 8, fontSize: 12 }}
                    labelStyle={{ color: 'oklch(0.71 0.01 90)' }}
                    formatter={(v: any) => [formatBytes(Number(v)), 'Stored']}
                  />
                  <Area type="monotone" dataKey="storageBytes" stroke="#f59e0b" strokeWidth={2} fill="url(#gS)" name="Storage" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="size-4.5 text-amber-500" /> Recent activity
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5 max-h-72 overflow-y-auto">
            {data.recentActivity.map(a => (
              <div key={a.id} className="flex items-start gap-2.5 text-sm">
                <span className="mt-1 size-1.5 rounded-full bg-amber-500 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="truncate">
                    <span className="font-medium">{actionLabel(a.action)}</span>
                    {a.detail && <span className="text-muted-foreground"> — {a.detail}</span>}
                  </div>
                  <div className="text-[11px] text-muted-foreground">{a.userEmail || 'system'} · {timeAgo(a.createdAt)}</div>
                </div>
              </div>
            ))}
            {data.recentActivity.length === 0 && <p className="text-sm text-muted-foreground">Nothing yet.</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Files className="size-4.5 text-amber-500" /> Newest files
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5 max-h-72 overflow-y-auto">
            {data.recentFiles.map(f => (
              <div key={f.id} className="flex items-center gap-2.5 text-sm">
                <span className="size-8 rounded-lg bg-amber-500/10 text-amber-500 grid place-items-center shrink-0">
                  <Files className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{f.name}</div>
                  <div className="text-[11px] text-muted-foreground">{f.owner} · {formatBytes(f.size)} · {timeAgo(f.createdAt)}</div>
                </div>
              </div>
            ))}
            {data.recentFiles.length === 0 && <p className="text-sm text-muted-foreground">No files yet.</p>}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Database className="size-4.5 text-amber-500" /> Storage backend health
          </CardTitle>
        </CardHeader>
        <CardContent className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
          <div>
            <div className="micro-label mb-1.5">Backend</div>
            <Badge variant="outline" className="border-border/80 bg-muted/30 font-mono text-xs capitalize">{data.storageHealth.backend}</Badge>
          </div>
          <div>
            <div className="micro-label mb-1.5">Bot / Daemon</div>
            <div className="font-medium font-mono text-[13px] flex items-center gap-1.5">
              {data.storageHealth.botUsername ? (
                <>@{data.storageHealth.botUsername} <CheckCircle2 className="size-3.5 text-emerald-500" /></>
              ) : (
                <><XCircle className="size-3.5 text-rose-500" /> unreachable</>
              )}
            </div>
          </div>
          <div>
            <div className="micro-label mb-1.5">Storage chat</div>
            <div className="font-medium font-mono text-xs mt-0.5 truncate">{data.storageHealth.storageChatId || '— not set —'}</div>
          </div>
          <div className="flex items-end">
            <Button variant="outline" size="sm" className="gap-1.5" onClick={onGoStorage}>
              <ArrowLeftRight className="size-3.5" /> Configure
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// ============================== Users ==============================

interface AdminUser {
  id: string
  email: string
  name: string | null
  role: string
  quota: number
  isActive: boolean
  createdAt: string
  files: number
  usedBytes: number
}

function roleBadge(role: string) {
  if (role === 'OWNER') return <Badge className="bg-amber-500/15 text-amber-600 border-amber-500/40 gap-1"><Crown className="size-3" /> Owner</Badge>
  if (role === 'ADMIN') return <Badge variant="outline" className="border-zinc-500/40 text-zinc-500 gap-1"><ShieldCheck className="size-3" /> Admin</Badge>
  return <Badge variant="outline" className="text-muted-foreground">User</Badge>
}

function UsersSection({ currentUserId }: { currentUserId?: string }) {
  const [q, setQ] = useState('')
  const [debounced, setDebounced] = useState('')
  const [edit, setEdit] = useState<AdminUser | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<AdminUser | null>(null)
  const [filesDrawer, setFilesDrawer] = useState<AdminUser | null>(null)
  const queryClient = useQueryClient()

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 300)
    return () => clearTimeout(t)
  }, [q])

  const { data, isLoading } = useQuery<{ users: AdminUser[] }>({
    queryKey: ['admin-users', debounced],
    queryFn: () => api(`/api/admin/users?q=${encodeURIComponent(debounced)}`),
  })

  const doDelete = async () => {
    if (!confirmDelete) return
    const u = confirmDelete
    setConfirmDelete(null)
    try {
      await api(`/api/admin/users/${u.id}`, { method: 'DELETE' })
      toast.success(`${u.email} deleted`)
      queryClient.invalidateQueries({ queryKey: ['admin-users'] })
    } catch (e: any) {
      toast.error(e?.message || 'Delete failed')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input placeholder="Search by email or name…" className="pl-9" value={q} onChange={e => setQ(e.target.value)} />
        </div>
        <Button variant="outline" size="icon" onClick={() => queryClient.invalidateQueries({ queryKey: ['admin-users'] })} aria-label="Refresh">
          <RefreshCw className="size-4" />
        </Button>
      </div>

      {isLoading ? (
        <Skeleton className="h-64 rounded-lg" />
      ) : (
        <div className="rounded-lg border border-border/60 bg-card overflow-hidden">
          <div className="overflow-x-auto max-h-[70vh] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card z-10">
                <tr className="border-b border-border/60 text-left text-xs text-muted-foreground">
                  <th className="font-medium px-4 py-3">User</th>
                  <th className="font-medium px-4 py-3">Role</th>
                  <th className="font-medium px-4 py-3">Storage</th>
                  <th className="font-medium px-4 py-3 hidden md:table-cell">Files</th>
                  <th className="font-medium px-4 py-3">Active</th>
                  <th className="font-medium px-4 py-3 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {(data?.users || []).map(u => {
                  const pct = u.quota === -1 ? 0 : u.quota > 0 ? Math.min(100, (u.usedBytes / u.quota) * 100) : 100
                  return (
                    <tr key={u.id} className="border-b border-border/40 last:border-0 hover:bg-accent/30 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-medium">{u.name || u.email.split('@')[0]} {u.id === currentUserId && <span className="text-[10px] text-muted-foreground">(you)</span>}</div>
                        <div className="text-xs text-muted-foreground">{u.email}</div>
                      </td>
                      <td className="px-4 py-3">{roleBadge(u.role)}</td>
                      <td className="px-4 py-3">
                        <div className="text-xs tabular-nums">{formatBytes(u.usedBytes)} / {u.quota === -1 ? '∞' : formatBytes(u.quota)}</div>
                        <div className="h-1.5 w-28 rounded-full bg-muted mt-1 overflow-hidden">
                          <div className={`h-full rounded-full ${pct > 90 ? 'bg-red-500' : 'bg-amber-500'}`} style={{ width: `${u.quota === -1 ? 20 : pct}%` }} />
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground hidden md:table-cell">
                        <button
                          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 -mx-1.5 hover:bg-accent/40 transition-colors"
                          onClick={() => setFilesDrawer(u)}
                          title="View this user's files"
                        >
                          {u.files}
                          <FolderOpen className="size-3.5 text-amber-500" />
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="outline" className={u.isActive ? 'border-amber-500/40 text-amber-500' : 'border-red-500/40 text-red-500'}>
                          {u.isActive ? 'Active' : 'Disabled'}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <Button variant="ghost" size="icon" className="size-8" onClick={() => setEdit(u)} aria-label="Edit user">
                          <Users className="size-4" />
                        </Button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <UserEditDialog user={edit} onClose={() => setEdit(null)} isOwnerCurrent={currentUserId} />
      <UserFilesDrawer user={filesDrawer} onClose={() => setFilesDrawer(null)} />
      <AlertDialog open={!!confirmDelete} onOpenChange={o => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {confirmDelete?.email}?</AlertDialogTitle>
            <AlertDialogDescription>The user and ALL of their files (including cloud storage copies) will be permanently removed.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700 text-white" onClick={doDelete}>Delete user</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function UserEditDialog({ user, onClose }: { user: AdminUser | null; onClose: () => void; isOwnerCurrent?: string }) {
  const queryClient = useQueryClient()
  const { user: me } = useAuth()
  const [role, setRole] = useState('USER')
  const [quotaGb, setQuotaGb] = useState('1')
  const [unlimited, setUnlimited] = useState(false)
  const [active, setActive] = useState(true)
  const [name, setName] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [pwFieldOpen, setPwFieldOpen] = useState(false)
  const [pwVisible, setPwVisible] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (user) {
      setRole(user.role)
      setUnlimited(user.quota === -1)
      setQuotaGb(user.quota === -1 ? '1' : String(Math.max(0.1, +(user.quota / 1024 / 1024 / 1024).toFixed(2))))
      setActive(user.isActive)
      setName(user.name || '')
      setNewPassword('')
      setPwFieldOpen(false)
      setPwVisible(false)
    }
  }, [user])

  if (!user) return null
  const isOwner = me?.role === 'OWNER'

  const save = async () => {
    setBusy(true)
    try {
      const body: any = {
        role,
        isActive: active,
        name: name.trim() || null,
        quota: unlimited ? -1 : Math.round(parseFloat(quotaGb || '1') * 1024 * 1024 * 1024),
      }
      if (newPassword.trim().length > 0) body.password = newPassword.trim()
      await api(`/api/admin/users/${user.id}`, { method: 'PATCH', body })
      toast.success(`${user.email} updated${newPassword.trim() ? ' — password reset' : ''}`)
      setNewPassword('')
      queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      onClose()
    } catch (e: any) {
      toast.error(e?.message || 'Update failed')
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!confirm(`Really delete ${user.email} and all their files?`)) return
    setBusy(true)
    try {
      await api(`/api/admin/users/${user.id}`, { method: 'DELETE' })
      toast.success(`${user.email} deleted`)
      queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      onClose()
    } catch (e: any) {
      toast.error(e?.message || 'Delete failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={!!user} onOpenChange={o => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-[15px]">Edit user — {user.email}</DialogTitle>
          <DialogDescription className="text-[13px]">Quota, role and account status.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Display name</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Name" />
          </div>
          <div className="space-y-1.5">
            <Label>Role</Label>
            <Select value={role} onValueChange={setRole} disabled={!isOwner}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="USER">User</SelectItem>
                <SelectItem value="ADMIN">Admin</SelectItem>
                <SelectItem value="OWNER" disabled={!isOwner}>Owner</SelectItem>
              </SelectContent>
            </Select>
            {!isOwner && <p className="text-[11px] text-muted-foreground">Only the owner can change roles.</p>}
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Storage quota</Label>
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                <Switch checked={unlimited} onCheckedChange={setUnlimited} /> Unlimited
              </label>
            </div>
            {!unlimited && (
              <div className="flex items-center gap-2">
                <Input type="number" min="0.1" step="0.1" value={quotaGb} onChange={e => setQuotaGb(e.target.value)} />
                <span className="text-sm text-muted-foreground shrink-0">GB</span>
              </div>
            )}
          </div>
          <div className="flex items-center justify-between">
            <Label>Account active</Label>
            <Switch checked={active} onCheckedChange={setActive} />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>Reset password</Label>
              <button
                type="button"
                onClick={() => setPwFieldOpen(s => !s)}
                className="text-[11px] text-amber-600 dark:text-amber-400 hover:underline cursor-pointer"
              >
                {pwFieldOpen ? 'hide field' : 'set new password…'}
              </button>
            </div>
            {pwFieldOpen ? (
              <div className="relative">
                <Input
                  type={pwVisible ? 'text' : 'password'}
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  placeholder="New password (min 6 chars)"
                  autoComplete="new-password"
                  className="pr-16"
                />
                {newPassword && (
                  <button
                    type="button"
                    onClick={() => setPwVisible(v => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-medium text-muted-foreground hover:text-foreground cursor-pointer"
                  >
                    {pwVisible ? 'HIDE' : 'SHOW'}
                  </button>
                )}
                {newPassword && newPassword.length < 6 && (
                  <p className="mt-1 text-[11px] text-amber-500">Password will be rejected — at least 6 characters required.</p>
                )}
              </div>
            ) : (
              <p className="text-[11px] text-muted-foreground">Leave hidden to keep the current password. The user is not notified by email.</p>
            )}
          </div>
          <div className="flex justify-between pt-2">
            <Button variant="destructive" size="sm" onClick={remove} disabled={busy || user.role === 'OWNER'}>
              <Trash2 className="size-4" /> Delete
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
              <Button size="sm" onClick={save} disabled={busy} className="gap-1.5">
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ---- per-user files drawer ----

interface UserFilesData {
  user: { id: string; email: string; name: string | null; role: string; isActive: boolean; quota: number }
  totals: { count: number; totalSize: number; shared: number; trashed: number }
  files: {
    id: string
    name: string
    mimeType: string
    size: number
    status: string
    starred: boolean
    shareEnabled: boolean
    downloads: number
    deletedAt: string | null
    createdAt: string
    folderName: string | null
  }[]
}

function UserFilesDrawer({ user, onClose }: { user: AdminUser | null; onClose: () => void }) {
  const { data, isLoading } = useQuery<UserFilesData>({
    queryKey: ['admin-user-files', user?.id],
    queryFn: () => api(`/api/admin/users/${user!.id}/files`),
    enabled: !!user,
  })

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

  return (
    <Sheet open={!!user} onOpenChange={o => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col">
        <SheetHeader className="px-5 pt-5 pb-3 border-b border-border/40 text-left">
          <SheetTitle className="flex items-center gap-2.5">
            <span className="size-9 rounded-full bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-sm font-bold text-amber-500 uppercase shrink-0">
              {(user?.name || user?.email || '?').charAt(0)}
            </span>
            <span className="min-w-0">
              <span className="block truncate">{user?.name || user?.email?.split('@')[0]}</span>
              <span className="block text-xs font-normal text-muted-foreground truncate">{user?.email}</span>
            </span>
          </SheetTitle>
          <SheetDescription className="sr-only">Files stored by this user</SheetDescription>
          <div className="flex flex-wrap gap-1.5 pt-1">
            <Badge variant="outline" className="text-[10px] gap-1"><Files className="size-3" /> {data?.totals.count ?? '…'} active</Badge>
            <Badge variant="outline" className="text-[10px] gap-1"><HardDrive className="size-3" /> {data ? formatBytes(data.totals.totalSize) : '…'}</Badge>
            <Badge variant="outline" className="text-[10px] gap-1 border-amber-500/40 text-amber-500"><Share2 className="size-3" /> {data?.totals.shared ?? '…'} shared</Badge>
            <Badge variant="outline" className="text-[10px] gap-1 border-amber-500/40 text-amber-500"><Trash2 className="size-3" /> {data?.totals.trashed ?? '…'} trashed</Badge>
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-lg" />)}
            </div>
          ) : (data?.files.length ?? 0) === 0 ? (
            <div className="h-full min-h-48 flex flex-col items-center justify-center text-center gap-2 text-muted-foreground">
              <FolderOpen className="size-8 opacity-40" />
              <p className="text-sm">This user has no files yet.</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {data!.files.map(f => {
                const kind = fileKind(f.mimeType, f.name)
                const KIcon = kindIcons[kind] || FileIcon
                return (
                <div
                  key={f.id}
                  className={`flex items-center gap-2.5 rounded-lg border border-border/40 px-3 py-2 text-sm ${f.deletedAt ? 'opacity-55' : 'hover:bg-accent/30'} transition-colors`}
                >
                  <span className={`size-7 rounded-md grid place-items-center shrink-0 ${kindColor(kind)}`} aria-hidden>
                    <KIcon className="size-3.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="truncate font-medium text-[13px]" title={f.name}>{f.name}</span>
                      {f.starred && <Star className="size-3 fill-amber-400 text-amber-400 shrink-0" />}
                    </div>
                    <div className="text-[10.5px] text-muted-foreground truncate">
                      {formatBytes(f.size)} · {timeAgo(f.createdAt)}
                      {f.folderName ? ` · ${f.folderName}` : ''}
                      {f.downloads > 0 ? ` · ${f.downloads}↓` : ''}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    {f.shareEnabled && (
                      <Badge variant="outline" className="text-[9px] border-amber-500/40 text-amber-500 gap-0.5"><Share2 className="size-2.5" /> shared</Badge>
                    )}
                    {f.deletedAt ? (
                      <Badge variant="outline" className="text-[9px] border-amber-500/40 text-amber-500">trashed</Badge>
                    ) : f.status !== 'READY' ? (
                      <Badge variant="outline" className="text-[9px] text-muted-foreground">{f.status.toLowerCase()}</Badge>
                    ) : null}
                  </div>
                </div>
                )
              })}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

// ============================== All files ==============================

function AllFilesSection() {
  const [q, setQ] = useState('')
  const [debounced, setDebounced] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<any>(null)
  const queryClient = useQueryClient()

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 300)
    return () => clearTimeout(t)
  }, [q])

  const { data, isLoading } = useQuery<{ files: any[] }>({
    queryKey: ['admin-files', debounced],
    queryFn: () => api(`/api/admin/files?q=${encodeURIComponent(debounced)}`),
  })

  const doDelete = async () => {
    if (!confirmDelete) return
    const f = confirmDelete
    setConfirmDelete(null)
    try {
      await api(`/api/files/${f.id}`, { method: 'DELETE' })
      toast.success(`"${f.name}" deleted`)
      queryClient.invalidateQueries({ queryKey: ['admin-files'] })
    } catch (e: any) {
      toast.error(e?.message || 'Delete failed')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input placeholder="Search all files…" className="pl-9" value={q} onChange={e => setQ(e.target.value)} />
        </div>
        <Button variant="outline" size="icon" onClick={() => queryClient.invalidateQueries({ queryKey: ['admin-files'] })} aria-label="Refresh">
          <RefreshCw className="size-4" />
        </Button>
      </div>

      {isLoading ? (
        <Skeleton className="h-64 rounded-lg" />
      ) : (
        <div className="rounded-lg border border-border/60 bg-card overflow-hidden">
          <div className="overflow-x-auto max-h-[70vh] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card z-10">
                <tr className="border-b border-border/60 text-left text-xs text-muted-foreground">
                  <th className="font-medium px-4 py-3">File</th>
                  <th className="font-medium px-4 py-3 hidden md:table-cell">Owner</th>
                  <th className="font-medium px-4 py-3">Size</th>
                  <th className="font-medium px-4 py-3 hidden lg:table-cell">Downloads</th>
                  <th className="font-medium px-4 py-3 hidden lg:table-cell">Created</th>
                  <th className="font-medium px-4 py-3 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {(data?.files || []).map(f => (
                  <tr key={f.id} className="border-b border-border/40 last:border-0 hover:bg-accent/30 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-medium truncate max-w-[260px] flex items-center gap-2" title={f.name}>
                        <span className="truncate">{f.name}</span>
                        {f.deletedAt && <Badge variant="outline" className="text-[9px] border-red-500/40 text-red-500 shrink-0">TRASHED</Badge>}
                      </div>
                      <div className="text-[11px] text-muted-foreground">{f.mimeType}</div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground hidden md:table-cell">{f.owner?.name || f.owner?.email}</td>
                    <td className="px-4 py-3 tabular-nums">{formatBytes(f.size)}</td>
                    <td className="px-4 py-3 text-muted-foreground hidden lg:table-cell">{f.downloads}</td>
                    <td className="px-4 py-3 text-muted-foreground hidden lg:table-cell">{formatDate(f.createdAt)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="icon" className="size-8" onClick={() => downloadFile(`/api/files/${f.id}/download`)} aria-label="Download">
                          <DownloadCloud className="size-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="size-8 text-red-500 hover:text-red-500" onClick={() => setConfirmDelete(f)} aria-label="Delete permanently">
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <AlertDialog open={!!confirmDelete} onOpenChange={o => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{confirmDelete?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDelete?.deletedAt ? 'This file is already in the trash — deleting removes it from cloud storage forever.' : 'This moves the file to the owner\'s trash (or purges it immediately if it belongs to another user).' }
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700 text-white" onClick={doDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ============================== Storage settings ==============================

interface DetectedChat { id: string; title: string; type: string; configured?: boolean }

function StorageSection() {
  const { user } = useAuth()
  const isOwner = user?.role === 'OWNER'
  const [s, setS] = useState<any>(null)
  const [botUsername, setBotUsername] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [testing, setTesting] = useState(false)
  const [detecting, setDetecting] = useState(false)
  const [detected, setDetected] = useState<DetectedChat[] | null>(null)
  const [detectNotice, setDetectNotice] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [showToken, setShowToken] = useState(false)

  const { data, isLoading } = useQuery<{ settings: any; isOwner: boolean; botUsername?: string | null }>({
    queryKey: ['admin-settings'],
    queryFn: () => api('/api/admin/settings'),
    enabled: isOwner,
  })

  useEffect(() => {
    if (data?.settings) setS(data.settings)
    if (data?.botUsername) setBotUsername(data.botUsername)
  }, [data])

  if (!isOwner) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-sm text-muted-foreground">
          <KeyRound className="mx-auto size-8 text-muted-foreground/50" />
          <p className="mt-3">Only the <span className="font-semibold text-foreground">Owner</span> can manage storage configuration.</p>
        </CardContent>
      </Card>
    )
  }
  if (isLoading || !s) return <Skeleton className="h-96 rounded-lg" />

  const save = async () => {
    setBusy(true)
    try {
      await api('/api/admin/settings', { method: 'PUT', body: s })
      toast.success('Storage settings saved')
    } catch (e: any) {
      toast.error(e?.message || 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  const test = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const r = await api<{ ok: boolean; error?: string; botUsername?: string }>('/api/admin/telegram/test', {
        method: 'POST',
        body: { chatId: s.tgStorageChatId },
      })
      setTestResult(r.ok ? { ok: true, msg: `Test message delivered${r.botUsername ? ` via @${r.botUsername}` : ''}!` } : { ok: false, msg: r.error || 'Test failed' })
      if (r.ok) toast.success('Connection works!')
      else toast.error(r.error || 'Test failed')
    } catch (e: any) {
      setTestResult({ ok: false, msg: e?.message || 'Test failed' })
    } finally {
      setTesting(false)
    }
  }

  const detect = async () => {
    setDetecting(true)
    setDetectNotice(null)
    try {
      const r = await api<{ ok: boolean; chats: DetectedChat[]; notice?: string; error?: string }>('/api/admin/telegram/detect', { method: 'POST' })
      if (r.ok) {
        setDetected(r.chats)
        setDetectNotice(r.notice || null)
        if (r.chats.length === 0) toast.info('No chats detected yet — follow the steps below, then try again.')
        else toast.success(`${r.chats.length} chat${r.chats.length === 1 ? '' : 's'} found`)
      } else {
        toast.error(r.error || 'Detection failed')
      }
    } catch (e: any) {
      toast.error(e?.message || 'Detection failed')
    } finally {
      setDetecting(false)
    }
  }

  return (
    <div className="grid lg:grid-cols-5 gap-5">
      {/* Wizard guide */}
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Radar className="size-4.5 text-amber-500" /> Setup wizard
          </CardTitle>
          <CardDescription>Connect cloud storage infrastructure as your storage pool (~2 minutes).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3.5 text-sm">
          {[
            <>Create a <span className="font-medium">private storage channel or group</span> in your cloud connector (e.g. “My Cloud”). Groups also work.</>,
            <>Add your bot as an <span className="font-medium">administrator</span> with “Post messages” permission. Bot: {botUsername ? <span className="font-mono text-amber-500">@{botUsername}</span> : '— set token first —'}</>,
            <>Send <span className="font-medium">any message</span> inside that channel/group (e.g. “hello”).</>,
            <>Click <span className="font-medium">“Detect chats”</span> on the right and pick your chat, or type the ID manually.</>,
            <>Click <span className="font-medium">“Test connection”</span> — the bot posts a confirmation message.</>,
            <>Hit <span className="font-medium">Save</span>. Uploads will now flow to encrypted cloud storage.</>,
          ].map((step, i) => (
            <div key={i} className="flex gap-3">
              <span className="size-6 rounded-full bg-amber-500/12 text-amber-500 text-[11px] font-bold grid place-items-center shrink-0 mt-0.5">{i + 1}</span>
              <p className="text-muted-foreground leading-relaxed">{step}</p>
            </div>
          ))}
          <div className="rounded-lg border border-border/60 bg-muted/30 p-3 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Tip:</span> your own private chat with the bot works too — press <span className="font-mono">START</span> on the bot, then Detect.
          </div>
        </CardContent>
      </Card>

      {/* Config form */}
      <Card className="lg:col-span-3">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Send className="size-4.5 text-amber-500" /> Cloud storage configuration
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>Storage backend</Label>
            <Select value={s.storageBackend} onValueChange={v => setS({ ...s, storageBackend: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="telegram">Encrypted Cloud Storage (recommended)</SelectItem>
                <SelectItem value="local">Local disk (fallback)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Bot token</Label>
            <div className="flex gap-2">
              <Input type={showToken ? 'text' : 'password'} value={s.tgBotToken} onChange={e => setS({ ...s, tgBotToken: e.target.value })} className="font-mono text-xs" />
              <Button variant="outline" size="sm" className="shrink-0" onClick={() => setShowToken(v => !v)}>{showToken ? 'Hide' : 'Show'}</Button>
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>API ID</Label>
              <Input value={s.tgApiId} onChange={e => setS({ ...s, tgApiId: e.target.value })} className="font-mono text-xs" />
            </div>
            <div className="space-y-1.5">
              <Label>API hash</Label>
              <Input type="password" value={s.tgApiHash} onChange={e => setS({ ...s, tgApiHash: e.target.value })} className="font-mono text-xs" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Admin Alert IDs (comma-separated)</Label>
            <Input value={s.tgAdminIds} onChange={e => setS({ ...s, tgAdminIds: e.target.value })} className="font-mono text-xs" placeholder="987654321,123456789" />
          </div>

          <div className="space-y-1.5">
            <Label>Storage chat ID</Label>
            <div className="flex gap-2">
              <Input value={s.tgStorageChatId} onChange={e => setS({ ...s, tgStorageChatId: e.target.value })} className="font-mono text-xs" placeholder="-1001234567890 or @channelname" />
              <Button variant="outline" size="sm" className="shrink-0 gap-1.5" onClick={detect} disabled={detecting}>
                {detecting ? <Loader2 className="size-3.5 animate-spin" /> : <Radar className="size-3.5" />} Detect
              </Button>
            </div>
            {detected && (
              <div className="mt-2 rounded-lg border border-border/60 max-h-44 overflow-y-auto">
                {detected.length === 0 ? (
                  <p className="text-xs text-muted-foreground p-3 leading-relaxed">
                    No chats in the bot&apos;s recent activity. Send <span className="font-medium text-foreground">any message</span> in your group/channel (or press <span className="font-mono text-foreground">START</span> in the bot&apos;s private chat), then Detect again — or type the chat ID manually above.
                  </p>
                ) : detected.map(c => (
                  <button
                    key={c.id}
                    className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-xs hover:bg-accent/50 border-b border-border/40 last:border-0 cursor-pointer text-left"
                    onClick={() => { setS({ ...s, tgStorageChatId: c.id }); setDetected(null); setDetectNotice(null) }}
                  >
                    <span className="font-medium truncate">{c.title}</span>
                    <span className="flex items-center gap-1.5 shrink-0 text-muted-foreground font-mono">
                      {c.configured && <span className="font-sans text-[10px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded px-1.5 py-0.5">Current</span>}
                      <span className="truncate">{c.id} · {c.type}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
            {detectNotice && (
              <p className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/8 p-3 text-xs text-amber-600 dark:text-amber-400 leading-relaxed">{detectNotice}</p>
            )}
          </div>

          {testResult && (
            <div className={`rounded-lg border p-3 text-xs flex items-center gap-2 ${testResult.ok ? 'border-amber-500/40 bg-amber-500/8 text-amber-600 dark:text-amber-400' : 'border-red-500/40 bg-red-500/8 text-red-600 dark:text-red-400'}`}>
              {testResult.ok ? <CheckCircle2 className="size-4 shrink-0" /> : <XCircle className="size-4 shrink-0" />}
              {testResult.msg}
            </div>
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            <Button onClick={save} disabled={busy} className="gap-1.5">
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save settings
            </Button>
            <Button variant="outline" onClick={test} disabled={testing || !s.tgStorageChatId} className="gap-1.5">
              {testing ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} Test connection
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// ============================== Site settings ==============================

function SiteSection() {
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery<{ settings: any }>({
    queryKey: ['admin-settings'],
    queryFn: () => api('/api/admin/settings'),
  })
  const [s, setS] = useState<any>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (data?.settings) {
      setS({
        ...data.settings,
        defaultQuotaGb: +(data.settings.defaultQuota / 1024 / 1024 / 1024).toFixed(2),
        maxFileSizeGb: +(data.settings.maxFileSize / 1024 / 1024 / 1024).toFixed(2),
      })
    }
  }, [data])

  if (isLoading || !s) return <Skeleton className="h-96 rounded-lg" />

  const save = async () => {
    setBusy(true)
    try {
      await api('/api/admin/settings', {
        method: 'PUT',
        body: {
          siteName: s.siteName,
          siteDescription: s.siteDescription,
          announcement: s.announcement,
          allowRegistration: s.allowRegistration,
          defaultQuota: Math.round(s.defaultQuotaGb * 1024 * 1024 * 1024),
          maxFileSize: Math.round(s.maxFileSizeGb * 1024 * 1024 * 1024),
        },
      })
      toast.success('Site settings saved')
      queryClient.invalidateQueries({ queryKey: ['me'] })
    } catch (e: any) {
      toast.error(e?.message || 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Globe className="size-4.5 text-amber-500" /> Site configuration
          </CardTitle>
          <CardDescription>Branding, registration policy and upload limits.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>Site name</Label>
            <Input value={s.siteName} onChange={e => setS({ ...s, siteName: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>Tagline / description</Label>
            <Input value={s.siteDescription} onChange={e => setS({ ...s, siteDescription: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>Announcement banner (shown to all users)</Label>
            <Input value={s.announcement || ''} onChange={e => setS({ ...s, announcement: e.target.value })} placeholder="e.g. Scheduled maintenance Sunday 02:00 UTC" />
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border/60 p-3.5">
            <div>
              <Label>Allow new registrations</Label>
              <p className="text-xs text-muted-foreground mt-0.5">When off, the register page is closed.</p>
            </div>
            <Switch checked={s.allowRegistration} onCheckedChange={(v: boolean) => setS({ ...s, allowRegistration: v })} />
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Default user quota (GB)</Label>
              <Input type="number" min="0.1" step="0.5" value={s.defaultQuotaGb} onChange={e => setS({ ...s, defaultQuotaGb: parseFloat(e.target.value) || 1 })} />
            </div>
            <div className="space-y-1.5">
              <Label>Max file size (GB)</Label>
              <Input type="number" min="0.05" step="0.5" value={s.maxFileSizeGb} onChange={e => setS({ ...s, maxFileSizeGb: parseFloat(e.target.value) || 2 })} />
            </div>
          </div>
          <Button onClick={save} disabled={busy} className="gap-1.5">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save site settings
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

// ============================== Logs ==============================

function LogsSection() {
  const [type, setType] = useState('all')
  const [q, setQ] = useState('')
  const [debounced, setDebounced] = useState('')
  const [page, setPage] = useState(1)

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 300)
    return () => clearTimeout(t)
  }, [q])

  const { data, isLoading } = useQuery<{ logs: any[]; total: number; page: number; pages: number }>({
    queryKey: ['admin-logs', type, debounced, page],
    queryFn: () => api(`/api/admin/logs?type=${type}&q=${encodeURIComponent(debounced)}&page=${page}`),
  })

  const colorFor = (action: string) => {
    if (action.startsWith('AUTH')) return 'border-zinc-500/40 text-zinc-500'
    if (action.includes('DELETE')) return 'border-red-500/40 text-red-500'
    if (action.includes('UPLOAD')) return 'border-amber-500/40 text-amber-500'
    if (action.includes('DOWNLOAD')) return 'border-amber-500/40 text-amber-500'
    if (action.startsWith('ADMIN')) return 'border-orange-500/40 text-orange-500'
    return 'border-border text-muted-foreground'
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={type} onValueChange={v => { setType(v); setPage(1) }}>
          <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All events</SelectItem>
            <SelectItem value="auth">Auth</SelectItem>
            <SelectItem value="upload">Uploads</SelectItem>
            <SelectItem value="download">Downloads</SelectItem>
            <SelectItem value="share">Shares</SelectItem>
            <SelectItem value="admin">Admin</SelectItem>
          </SelectContent>
        </Select>
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input placeholder="Search logs…" className="pl-9" value={q} onChange={e => setQ(e.target.value)} />
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 shrink-0"
          title="Download the filtered logs (up to 5000 rows) as CSV"
          onClick={() => {
            downloadFile(`/api/admin/logs/export?type=${type}&q=${encodeURIComponent(debounced)}`)
            toast.success('Export started — check your downloads')
          }}
        >
          <Download className="size-4" />
          <span className="hidden sm:inline">Export CSV</span>
        </Button>
        <span className="text-xs text-muted-foreground ml-auto">{data?.total ?? '…'} events</span>
      </div>

      {isLoading ? (
        <Skeleton className="h-64 rounded-lg" />
      ) : (
        <div className="rounded-lg border border-border/60 bg-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/60 text-left text-xs text-muted-foreground">
                  <th className="font-medium px-4 py-3">Event</th>
                  <th className="font-medium px-4 py-3">Detail</th>
                  <th className="font-medium px-4 py-3 hidden md:table-cell">User</th>
                  <th className="font-medium px-4 py-3 hidden lg:table-cell">IP</th>
                  <th className="font-medium px-4 py-3">When</th>
                </tr>
              </thead>
              <tbody>
                {(data?.logs || []).map(l => (
                  <tr key={l.id} className="border-b border-border/40 last:border-0 hover:bg-accent/30 transition-colors">
                    <td className="px-4 py-2.5"><Badge variant="outline" className={`text-[10px] ${colorFor(l.action)}`}>{actionLabel(l.action)}</Badge></td>
                    <td className="px-4 py-2.5 text-muted-foreground max-w-[320px]"><span className="line-clamp-2">{l.detail || '—'}</span></td>
                    <td className="px-4 py-2.5 text-muted-foreground hidden md:table-cell">{l.userEmail || 'system'}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground hidden lg:table-cell">{l.ip || '—'}</td>
                    <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">{timeAgo(l.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" size="sm" disabled={(data?.page || 1) <= 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
        <span className="text-xs text-muted-foreground">Page {data?.page || 1} / {data?.pages || 1}</span>
        <Button variant="outline" size="sm" disabled={(data?.page || 1) >= (data?.pages || 1)} onClick={() => setPage(p => p + 1)}>Next</Button>
      </div>
    </div>
  )
}

// ============================== Root admin view ==============================

const TABS = [
  { id: 'overview', label: 'Overview', icon: Activity },
  { id: 'users', label: 'Users', icon: Users },
  { id: 'files', label: 'All Files', icon: Files },
  { id: 'storage', label: 'Storage', icon: Database },
  { id: 'site', label: 'Site', icon: Globe },
  { id: 'logs', label: 'Audit Logs', icon: ScrollText },
]

export function AdminView() {
  const { user, privileged } = useAuth()
  const initialTab = useMemo(() => {
    const h = window.location.hash
    const m = /#\/admin\/(\w+)/.exec(h || '')
    return m?.[1] || 'overview'
  }, [])
  const [tab, setTab] = useState(initialTab)

  const selectTab = (id: string) => {
    setTab(id)
    navigate(`/admin/${id}`)
  }

  useEffect(() => {
    const onHash = () => {
      const m = /#\/admin\/(\w+)/.exec(window.location.hash || '')
      if (m?.[1]) setTab(m[1])
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  if (!privileged || !user) {
    return (
      <Card>
        <CardContent className="p-10 text-center">
          <AlertTriangle className="mx-auto size-8 text-amber-500" />
          <p className="mt-3 font-medium">You don't have admin access.</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => selectTab(t.id)}
            className={`flex items-center gap-2 whitespace-nowrap rounded-lg px-3.5 py-2 text-sm font-medium transition-colors cursor-pointer ${
              tab === t.id ? 'bg-amber-500/12 text-amber-500' : 'text-muted-foreground hover:bg-accent hover:text-foreground'
            }`}
          >
            <t.icon className="size-4" /> {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && <Overview onGoStorage={() => selectTab('storage')} />}
      {tab === 'users' && <UsersSection currentUserId={user.id} />}
      {tab === 'files' && <AllFilesSection />}
      {tab === 'storage' && <StorageSection />}
      {tab === 'site' && <SiteSection />}
      {tab === 'logs' && <LogsSection />}
    </div>
  )
}
