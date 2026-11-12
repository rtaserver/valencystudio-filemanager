'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Progress } from '@/components/ui/progress'
import { Logo } from '@/components/logo'
import { navigate, useHashRoute } from '@/lib/router'
import { useAuth } from '@/lib/auth-context'
import { formatBytes } from '@/lib/format'
import { useUploadStore } from '@/lib/uploader'
import { api } from '@/lib/client-api'
import { useRealtimeStatus } from '@/lib/realtime'
import { RealtimeBadge } from '@/components/realtime-badge'
import { folderColor } from '@/lib/folder-style'
import { FilesView } from '@/components/views/files-view'
import { ProfileView } from '@/components/views/profile-view'
import { AdminView } from '@/components/views/admin/admin-view'
import { UploadPanel } from '@/components/views/upload-panel'
import { CommandPalette, useCommandPaletteHotkey } from '@/components/views/command-palette'
import { ShortcutsDialog } from '@/components/views/shortcuts-dialog'
import { toast } from 'sonner'
import {
  FolderOpen,
  Share2,
  UploadCloud,
  LogOut,
  Settings,
  LayoutDashboard,
  Menu,
  Sun,
  Moon,
  Laptop,
  ChevronUp,
  ChevronRight,
  Megaphone,
  X,
  Shield,
  Trash2,
  Folder,
  Search,
  Star,
  Keyboard,
  HardDrive,
  File as FileIcon,
} from 'lucide-react'
import { useTheme } from 'next-themes'

interface TreeFolder {
  id: string
  name: string
  parentId: string | null
  emoji?: string | null
  color?: string | null
  fileCount?: number
  totalSize?: number
}

/** Collapsible folder tree for quick navigation — mirrors the /files hierarchy */
function SidebarFolderTree({ currentFolderId }: { currentFolderId: string | null }) {
  const { data } = useQuery<{ folders: TreeFolder[] }>({
    queryKey: ['folders-tree'],
    queryFn: () => api('/api/folders/tree'),
    refetchInterval: 30000,
  })
  const [manuallyExpanded, setManuallyExpanded] = useState<Set<string>>(new Set())
  const [manuallyCollapsed, setManuallyCollapsed] = useState<Set<string>>(new Set())
  const folders = data?.folders || []

  const childrenOf = useMemo(() => {
    const m = new Map<string | null, TreeFolder[]>()
    for (const f of folders) {
      const k = f.parentId || null
      if (!m.has(k)) m.set(k, [])
      m.get(k)!.push(f)
    }
    m.forEach(list => list.sort((a, b) => a.name.localeCompare(b.name)))
    return m
  }, [folders])

  // ancestors of the folder currently being browsed are always expanded (derived, no effect)
  const autoExpanded = useMemo(() => {
    const s = new Set<string>()
    if (!currentFolderId || folders.length === 0) return s
    const byId = new Map(folders.map(f => [f.id, f]))
    let cur = byId.get(currentFolderId)
    let guard = 0
    while (cur?.parentId && guard < 50) {
      s.add(cur.parentId)
      cur = byId.get(cur.parentId)
      guard++
    }
    return s
  }, [currentFolderId, folders])

  if (folders.length === 0) return null

  const isOpen = (id: string) =>
    manuallyCollapsed.has(id) ? false : manuallyExpanded.has(id) || autoExpanded.has(id)

  const toggle = (id: string) => {
    if (isOpen(id)) {
      setManuallyCollapsed(prev => new Set(prev).add(id))
      setManuallyExpanded(prev => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    } else {
      setManuallyExpanded(prev => new Set(prev).add(id))
      setManuallyCollapsed(prev => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }

  const renderNodes = (parentId: string | null, depth: number): React.ReactNode[] =>
    (childrenOf.get(parentId) || []).map(f => {
      const kids = childrenOf.get(f.id) || []
      const open = isOpen(f.id)
      const active = currentFolderId === f.id
      const fc = f.fileCount ?? 0
      const size = f.totalSize ?? 0
      const title = `${f.name} — ${fc} file${fc !== 1 ? 's' : ''}${size > 0 ? ` · ${formatBytes(size)} (incl. subfolders)` : ''}`
      return (
        <div key={f.id}>
          <div className="flex items-center min-w-0">
            {kids.length > 0 ? (
              <button
                onClick={() => toggle(f.id)}
                aria-expanded={open}
                aria-controls={`folder-children-${f.id}`}
                className="p-1 -ml-1 shrink-0 text-muted-foreground/70 hover:text-foreground transition-colors cursor-pointer"
                aria-label={open ? `Collapse ${f.name}` : `Expand ${f.name}`}
              >
                <ChevronRight className={`size-3 transition-transform duration-150 ${open ? 'rotate-90' : ''}`} />
              </button>
            ) : (
              <span className="w-4 shrink-0" />
            )}
            <button
              onClick={() => navigate(`/files?folder=${encodeURIComponent(f.id)}`)}
              className={`flex-1 min-w-0 flex items-center gap-2 rounded-md px-1.5 py-1.5 text-[13px] text-left transition-colors cursor-pointer ${
                active
                  ? 'bg-accent text-foreground font-medium'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent/60'
              }`}
              title={title}
            >
              <Folder
                className={`size-3.5 shrink-0 transition-colors ${
                  active ? folderColor(f.color).text : 'text-muted-foreground/70'
                }`
                }
              />
              <span className="truncate">{f.name}</span>
              {fc > 0 && (
                <span
                  className="ml-auto shrink-0 flex items-center gap-0.5 text-[10px] text-muted-foreground/45 tabular-nums"
                  title={title}
                >
                  {fc}
                  <FileIcon className="size-2.5" />
                </span>
              )}
              {kids.length > 0 && fc === 0 && (
                <span className="ml-auto text-[10px] text-muted-foreground/40 tabular-nums">{kids.length}</span>
              )}
            </button>
          </div>
          {open && kids.length > 0 && (
            <div id={`folder-children-${f.id}`} style={{ marginLeft: `${depth * 9}px` }} className="border-l border-border/40 pl-1.5 ml-2">
              {renderNodes(f.id, depth + 1)}
            </div>
          )}
        </div>
      )
    })

  return (
    <div className="mt-2">
      <div className="px-3 pb-1.5 text-[11px] uppercase tracking-wider text-muted-foreground/70 font-semibold flex items-center gap-1.5">
        <Folder className="size-3" /> Folders
      </div>
      <div className="max-h-52 overflow-y-auto pr-1 fancy-scroll">{renderNodes(null, 1)}</div>
    </div>
  )
}

function SidebarContent({
  path,
  currentFolderId,
  onNavigate,
  onOpenShortcuts,
}: {
  path: string
  currentFolderId: string | null
  onNavigate?: () => void
  onOpenShortcuts?: () => void
}) {
  const { user, privileged, stats, logout } = useAuth()
  const go = (p: string) => {
    navigate(p)
    onNavigate?.()
  }

  const used = stats?.usedBytes || 0
  const quota = user?.quota ?? 0
  const pct = quota === -1 ? 0 : quota > 0 ? Math.min(100, (used / quota) * 100) : 0

  const items = [
    { href: '/files', label: 'My Files', icon: FolderOpen, active: path.startsWith('/files') },
    { href: '/starred', label: 'Starred', icon: Star, active: path.startsWith('/starred') },
    { href: '/shared', label: 'Shared Links', icon: Share2, active: path.startsWith('/shared') },
    { href: '/trash', label: 'Trash', icon: Trash2, active: path.startsWith('/trash') },
    { href: '/profile', label: 'Account Settings', icon: Settings, active: path.startsWith('/profile') },
  ]

  return (
    <div className="flex flex-col h-full">
      <div className="h-14 flex items-center px-5 border-b border-border/60 shrink-0">
        <button onClick={() => go('/files')} className="cursor-pointer"><Logo /></button>
      </div>

      <nav className="flex-1 overflow-y-auto p-3 space-y-0.5">
        {items.map(item => (
          <button
            aria-current={item.active ? 'page' : undefined}
            key={item.href}
            onClick={() => go(item.href)}
            className={`relative w-full flex items-center gap-3 rounded-md px-3 py-2 text-[13px] font-medium transition-colors cursor-pointer ${
              item.active
                ? 'bg-accent text-foreground'
                : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
            }`}
          >
            {item.active && <span className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-0.5 rounded-full bg-primary" />}
            <item.icon className={`size-4 ${item.active ? 'text-primary' : ''}`} strokeWidth={item.active ? 2.2 : 1.9} />
            {item.label}
          </button>
        ))}

        {!['/starred', '/shared', '/trash', '/profile', '/admin'].some(p => path.startsWith(p)) && (
          <SidebarFolderTree currentFolderId={currentFolderId} />
        )}

        {privileged && (
          <>
            <div className="pt-5 pb-1.5 px-3 micro-label flex items-center gap-1.5">
              <Shield className="size-3" /> Administration
            </div>
            <button
              aria-current={path.startsWith('/admin') ? 'page' : undefined}
              onClick={() => go('/admin')}
              className={`relative w-full flex items-center gap-3 rounded-md px-3 py-2 text-[13px] font-medium transition-colors cursor-pointer ${
                path.startsWith('/admin')
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
              }`}
            >
              {path.startsWith('/admin') && <span className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-0.5 rounded-full bg-primary" />}
              <LayoutDashboard className={`size-4 ${path.startsWith('/admin') ? 'text-primary' : ''}`} strokeWidth={path.startsWith('/admin') ? 2.2 : 1.9} />
              Admin Panel
            </button>
          </>
        )}
      </nav>

      {/* Storage usage */}
      <div className="p-3">
        <div className="rounded-md border border-border/70 bg-muted/25 p-3.5">
          <div className="flex items-center justify-between mb-2.5">
            <span className="micro-label !text-foreground/60 flex items-center gap-1.5">
              Storage
              <LiveDot />
            </span>
            <span className="font-mono text-[11px] text-muted-foreground tnum">
              {formatBytes(used)} {quota === -1 ? '/ ∞' : `/ ${formatBytes(quota)}`}
            </span>
          </div>
          {quota === -1 ? (
            <div className="h-1 rounded-full bg-muted overflow-hidden">
              <div className="h-full w-1/3 bg-primary/70 rounded-full animate-indeterminate" />
            </div>
          ) : (
            <Progress value={pct} className="h-1" />
          )}
          <div className="mt-2.5 font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground/80">
            {stats?.fileCount ?? 0} file{(stats?.fileCount ?? 0) === 1 ? '' : 's'} · encrypted vault
          </div>
        </div>

        {/* User chip */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="mt-3 w-full flex items-center gap-3 rounded-md border border-border/70 bg-card p-2.5 hover:bg-accent/50 transition-colors cursor-pointer">
              <span className="size-8 rounded-md bg-secondary text-foreground/80 grid place-items-center font-mono font-semibold text-sm shrink-0">
                {(user?.name || user?.email || '?').slice(0, 1).toUpperCase()}
              </span>
              <span className="flex-1 min-w-0 text-left">
                <span className="block text-sm font-medium truncate">{user?.name || user?.email}</span>
                <span className="block text-[11px] text-muted-foreground truncate">{user?.role}</span>
              </span>
              <ChevronUp className="size-4 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top" className="w-56">
            <DropdownMenuLabel>
              <div className="text-sm font-medium">{user?.name || 'User'}</div>
              <div className="text-xs text-muted-foreground font-normal">{user?.email}</div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => go('/profile')}>
              <Settings className="size-4" /> Account settings
            </DropdownMenuItem>
            {onOpenShortcuts && (
              <DropdownMenuItem onClick={onOpenShortcuts}>
                <Keyboard className="size-4" /> Keyboard shortcuts
                <span className="ml-auto">
                  <kbd className="inline-flex h-4.5 items-center rounded border border-border/80 bg-muted/60 px-1 font-mono text-[10px] text-muted-foreground">?</kbd>
                </span>
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              className="text-red-500 focus:text-red-500"
              onClick={async () => {
                await logout()
                navigate('/')
              }}
            >
              <LogOut className="size-4" /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}

/** Tiny pulsing dot shown next to the STORAGE label — mirrors connection state */
function LiveDot() {
  const status = useRealtimeStatus()
  return (
    <span
      aria-hidden
      className={`size-1.5 rounded-full shrink-0 ${
        status === 'live'
          ? 'bg-primary animate-pulse-dot'
          : status === 'connecting'
            ? 'bg-muted-foreground/60 animate-pulse'
            : 'bg-red-500'
      }`}
    />
  )
}

function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Toggle theme">
          <Sun className="size-4.5 dark:hidden" />
          <Moon className="size-4.5 hidden dark:block" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => setTheme('light')}><Sun className="size-4" /> Light</DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme('dark')}><Moon className="size-4" /> Dark</DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme('system')}><Laptop className="size-4" /> System</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function AnnouncementBanner() {
  const { site } = useAuth()
  const ann = site.announcement
  const key = `vs_announcement_${ann?.slice(0, 40)}`
  const [, forceRender] = useState(0)

  if (!ann) return null
  const dismissed = typeof window !== 'undefined' && localStorage.getItem(key) === '1'
  if (dismissed) return null

  return (
    <div className="mx-4 sm:mx-6 mt-4 rounded-lg border border-amber-500/30 bg-amber-500/8 px-4 py-3 flex items-start gap-3">
      <Megaphone className="size-4.5 text-amber-500 shrink-0 mt-0.5" />
      <p className="text-sm flex-1 text-foreground/90">{ann}</p>
      <button
        className="text-muted-foreground hover:text-foreground cursor-pointer"
        onClick={() => {
          localStorage.setItem(key, '1')
          forceRender(x => x + 1)
        }}
        aria-label="Dismiss announcement"
      >
        <X className="size-4" />
      </button>
    </div>
  )
}

export function DashboardShell({ route }: { route: string }) {
  const { user } = useAuth()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const dragCounter = useRef(0)
  const hashRoute = useHashRoute()
  const openPalette = useCallback(() => setPaletteOpen(true), [])
  useCommandPaletteHotkey(openPalette)
  const currentFolder = hashRoute.path.startsWith('/files') ? hashRoute.query.get('folder') : null
  const folderRef = useRef<string | null>(currentFolder)
  useEffect(() => {
    folderRef.current = currentFolder
  }, [currentFolder])
  const addFiles = useUploadStore(s => s.addFiles)

  const enqueue = useCallback(
    (list: FileList | File[] | null) => {
      if (!list) return
      const arr = Array.from(list)
      if (arr.length === 0) return
      addFiles(arr, folderRef.current)
      toast.info(`${arr.length} file${arr.length > 1 ? 's' : ''} added to upload queue`)
    },
    [addFiles]
  )

  // ---- global keyboard layer: "?" cheat-sheet + G-prefix navigation (g f / g s / …) ----
  useEffect(() => {
    let gPending = false
    let gTimer: ReturnType<typeof setTimeout> | undefined
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === '?' || (e.key === '/' && e.shiftKey)) {
        e.preventDefault()
        setShortcutsOpen(true)
        return
      }
      if (gPending) {
        const map: Record<string, string> = {
          f: '/files',
          s: '/starred',
          h: '/shared',
          t: '/trash',
          p: '/profile',
          a: '/admin',
        }
        const dest = map[e.key.toLowerCase()]
        gPending = false
        if (gTimer) clearTimeout(gTimer)
        if (dest) {
          e.preventDefault()
          navigate(dest)
        }
        return
      }
      if (e.key.toLowerCase() === 'g') {
        gPending = true
        gTimer = setTimeout(() => {
          gPending = false
        }, 1200)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      if (gTimer) clearTimeout(gTimer)
    }
  }, [])

  // shared by the Upload button and the ⌘K palette action
  const triggerUploadPicker = useCallback(() => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    input.onchange = () => enqueue(input.files)
    input.click()
  }, [enqueue])

  useEffect(() => {
    const onDragEnter = (e: DragEvent) => {
      if (!e.dataTransfer?.types?.includes('Files')) return
      dragCounter.current++
      setDragging(true)
    }
    const onDragLeave = () => {
      dragCounter.current = Math.max(0, dragCounter.current - 1)
      if (dragCounter.current === 0) setDragging(false)
    }
    const onDragOver = (e: DragEvent) => e.preventDefault()
    const onDrop = (e: DragEvent) => {
      e.preventDefault()
      dragCounter.current = 0
      setDragging(false)
      // dropped directly onto a folder card → upload into that folder
      const el = (e.target as HTMLElement)?.closest?.('[data-folder-drop]')
      const folderTarget = el?.getAttribute('data-folder-drop') || folderRef.current
      const list = e.dataTransfer?.files
      if (list && list.length > 0) {
        addFiles(Array.from(list), folderTarget)
        toast.info(
          `${list.length} file${list.length > 1 ? 's' : ''} added to upload queue${el ? ' → folder' : ''}`
        )
      }
    }
    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('drop', onDrop)
    }
  }, [enqueue])

  const title =
    route.startsWith('/shared') ? 'Shared Links' :
    route.startsWith('/starred') ? 'Starred' :
    route.startsWith('/trash') ? 'Trash' :
    route.startsWith('/profile') ? 'Account Settings' :
    route.startsWith('/admin') ? 'Admin Panel' : 'My Files'

  return (
    <div className="min-h-screen flex bg-background">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex w-[248px] shrink-0 flex-col border-r border-border/60 bg-sidebar/40">
        <SidebarContent path={route} currentFolderId={currentFolder} onOpenShortcuts={() => setShortcutsOpen(true)} />
      </aside>

      {/* Mobile sidebar */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="p-0 w-[280px]">
          <SheetHeader className="sr-only">
            <SheetTitle>Navigation</SheetTitle>
          </SheetHeader>
          <SidebarContent path={route} currentFolderId={currentFolder} onNavigate={() => setMobileOpen(false)} onOpenShortcuts={() => { setMobileOpen(false); setShortcutsOpen(true) }} />
        </SheetContent>
      </Sheet>

      <div className="flex-1 flex flex-col min-w-0">
        {/* Topbar */}
        <header className="h-14 shrink-0 border-b border-border/60 bg-background/85 backdrop-blur sticky top-0 z-30 flex items-center gap-3 px-4 sm:px-6">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu">
            <Menu className="size-5" />
          </Button>
          <h1 className="text-[15px] font-semibold tracking-tight">{title}</h1>
          <div className="flex-1" />
          <button
            onClick={openPalette}
            className="hidden md:flex items-center gap-2 h-8 rounded-md border border-border/70 bg-muted/30 pl-3 pr-2 text-[13px] text-muted-foreground hover:bg-accent hover:text-foreground transition-colors cursor-pointer mr-1"
            aria-label="Open command palette"
          >
            <Search className="size-3.5" />
            <span>Search…</span>
            <kbd className="ml-4 inline-flex h-5 items-center rounded border border-border/80 bg-muted/60 px-1.5 font-mono text-[10px]">⌘K</kbd>
          </button>
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={openPalette}
            aria-label="Search"
          >
            <Search className="size-5" />
          </Button>
          <RealtimeBadge className="hidden sm:inline-flex" />
          <ThemeToggle />
          <Button
            size="sm"
            className="gap-2"
            onClick={triggerUploadPicker}
          >
            <UploadCloud className="size-4" /> <span className="hidden sm:inline">Upload</span>
          </Button>
        </header>

        <main className="flex-1 min-w-0">
          <AnnouncementBanner />
          <AnimatePresence mode="wait">
            <motion.div
              key={route}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18 }}
              className="p-4 sm:p-6 pb-24"
            >
              {route.startsWith('/shared') ? (
                <FilesView mode="shared" />
              ) : route.startsWith('/starred') ? (
                <FilesView mode="starred" />
              ) : route.startsWith('/trash') ? (
                <FilesView mode="trash" />
              ) : route.startsWith('/profile') ? (
                <ProfileView />
              ) : route.startsWith('/admin') ? (
                <AdminView />
              ) : (
                <FilesView mode="files" />
              )}
            </motion.div>
          </AnimatePresence>
        </main>

        <footer className="mt-auto px-6 py-3.5 border-t border-border/50 font-mono text-[11px] text-muted-foreground flex flex-wrap items-center justify-between gap-2">
          <span>VALANCY STUDIO · SECURE CLOUD VAULT</span>
          <span>{user?.email}</span>
        </footer>
      </div>

      {/* Drag overlay */}
      <AnimatePresence>
        {dragging && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-background/70 backdrop-blur-sm grid place-items-center pointer-events-none"
          >
            <div className="rounded-lg border-2 border-dashed border-primary/70 bg-card px-10 py-8 text-center">
              <UploadCloud className="mx-auto size-10 text-primary" strokeWidth={1.5} />
              <p className="mt-3 text-base font-semibold">Drop files to upload</p>
              <p className="font-mono text-[11px] text-muted-foreground mt-1">→ ENCRYPTED CLOUD VAULT</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <UploadPanel />

      {/* ⌘K command palette — `key` remounts it fresh each open */}
      <CommandPalette key={paletteOpen ? 'open' : 'closed'} open={paletteOpen} onOpenChange={setPaletteOpen} onUpload={triggerUploadPicker} onOpenShortcuts={() => { setPaletteOpen(false); setShortcutsOpen(true) }} />

      {/* "?" keyboard cheat-sheet */}
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </div>
  )
}
