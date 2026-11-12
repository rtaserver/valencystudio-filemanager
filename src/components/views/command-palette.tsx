'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
import { navigate } from '@/lib/router'
import { useAuth } from '@/lib/auth-context'
import { useTheme } from 'next-themes'
import { api } from '@/lib/client-api'
import { formatBytes, fileKind, kindColor } from '@/lib/format'
import { folderColor } from '@/lib/folder-style'
import { Kbd } from '@/components/ui/kbd'
import type { FileRow } from '@/components/views/files-view'
import {
  FolderOpen,
  Share2,
  Trash2,
  Settings,
  LayoutDashboard,
  Sun,
  Moon,
  Laptop,
  LogOut,
  UploadCloud,
  FileText,
  Image as ImageIcon,
  Film,
  Music,
  FileArchive,
  Code2,
  File as FileIcon,
  FileSpreadsheet,
  FileType2,
  Folder,
  CornerDownLeft,
  Star,
  Keyboard,
} from 'lucide-react'

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

interface TreeFolder {
  id: string
  name: string
  parentId: string | null
  emoji?: string | null
  color?: string | null
}

/**
 * Global ⌘K command palette: quick navigation, theme, upload, sign out,
 * plus fuzzy search across the user's files and folders.
 */
export function CommandPalette({
  open,
  onOpenChange,
  onUpload,
  onOpenShortcuts,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  onUpload: () => void
  onOpenShortcuts?: () => void
}) {
  const { user, privileged, logout } = useAuth()
  const { theme, setTheme } = useTheme()
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setDebounced(query.trim()), 220)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [query])

  // reset the query each time the palette opens — the parent remounts us via `key`, so initial state is fresh

  const searching = debounced.length > 0

  const { data: filesData, isFetching: filesFetching } = useQuery<{ files: FileRow[] }>({
    queryKey: ['palette-files', debounced],
    queryFn: () => api(`/api/files?search=${encodeURIComponent(debounced)}&sort=newest&shared=0&trash=0&type=all`),
    enabled: open && searching,
  })

  const { data: foldersData } = useQuery<{ folders: TreeFolder[] }>({
    queryKey: ['folders-tree'],
    queryFn: () => api('/api/folders/tree'),
    enabled: open,
  })

  const fileHits = useMemo(() => (filesData?.files || []).slice(0, 6), [filesData])
  const folderHits = useMemo(() => {
    if (!searching) return []
    const q = debounced.toLowerCase()
    return (foldersData?.folders || [])
      .filter(f => f.name.toLowerCase().includes(q))
      .slice(0, 4)
  }, [foldersData, debounced, searching])

  const go = (path: string) => {
    onOpenChange(false)
    navigate(path)
  }

  const openFile = (f: FileRow) => {
    onOpenChange(false)
    const folderQs = f.folderId ? `folder=${encodeURIComponent(f.folderId)}&` : ''
    navigate(`/files?${folderQs}open=${encodeURIComponent(f.id)}`)
  }

  const run = (fn: () => void | Promise<void>) => {
    onOpenChange(false)
    void fn()
  }

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder="Search files, folders, actions…"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList className="max-h-[380px]">
        {/* ---- Files & folders ---- */}
        {searching && (
          <>
            {!filesFetching && fileHits.length === 0 && folderHits.length === 0 && (
              <CommandEmpty>No matches for “{debounced}”.</CommandEmpty>
            )}
            {fileHits.length > 0 && (
              <CommandGroup heading="Files">
                {fileHits.map(f => {
                  const kind = fileKind(f.mimeType, f.name)
                  const Icon = kindIcons[kind] || FileIcon
                  return (
                    <CommandItem
                      key={f.id}
                      value={`file-${f.name}-${f.id}`}
                      onSelect={() => openFile(f)}
                      className="gap-2.5 py-2!"
                    >
                      <span className={`size-7 rounded-md grid place-items-center shrink-0 ${kindColor(kind)}`}>
                        <Icon className="size-3.5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">{f.name}</span>
                        {f.folderPath && (
                          <span className="block truncate text-[11px] text-muted-foreground">in {f.folderPath}</span>
                        )}
                      </span>
                      {f.starred && <Star className="size-3 fill-amber-400 text-amber-400 shrink-0" />}
                      <span className="text-[11px] text-muted-foreground font-mono tnum shrink-0">{formatBytes(f.size)}</span>
                      <CornerDownLeft className="size-3 text-muted-foreground/50 shrink-0" />
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            )}
            {folderHits.length > 0 && (
              <CommandGroup heading="Folders">
                {folderHits.map(fd => (
                  <CommandItem
                    key={fd.id}
                    value={`folder-${fd.name}-${fd.id}`}
                    onSelect={() => go(`/files?folder=${encodeURIComponent(fd.id)}`)}
                    className="gap-2.5 h-9 py-0!"
                  >
                    <span
                      className={`size-7 rounded-md grid place-items-center shrink-0 ${
                        fd.emoji ? 'bg-muted/40' : folderColor(fd.color).chip
                      }`}
                    >
                      {fd.emoji ? <span className="text-sm leading-none">{fd.emoji}</span> : <Folder className="size-3.5" />}
                    </span>
                    <span className="truncate text-sm">{fd.name}</span>
                    <span className="ml-auto font-mono text-[10px] text-muted-foreground/70 shrink-0">open folder</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            <CommandSeparator />
          </>
        )}

        {/* ---- Places ---- */}
        <CommandGroup heading="Places">
          <CommandItem value="my-files" className="h-9 py-0!" onSelect={() => go('/files')}>
            <FolderOpen className="size-4 text-amber-500" /> My Files
          </CommandItem>
          <CommandItem value="starred" className="h-9 py-0!" onSelect={() => go('/starred')}>
            <Star className="size-4 fill-amber-400 text-amber-400" /> Starred
          </CommandItem>
          <CommandItem value="shared-links" className="h-9 py-0!" onSelect={() => go('/shared')}>
            <Share2 className="size-4 text-amber-500" /> Shared Links
          </CommandItem>
          <CommandItem value="trash" className="h-9 py-0!" onSelect={() => go('/trash')}>
            <Trash2 className="size-4 text-amber-500" /> Trash
          </CommandItem>
          <CommandItem value="account-settings" className="h-9 py-0!" onSelect={() => go('/profile')}>
            <Settings className="size-4 text-amber-500" /> Account Settings
          </CommandItem>
          {privileged && (
            <CommandItem value="admin-panel" className="h-9 py-0!" onSelect={() => go('/admin')}>
              <LayoutDashboard className="size-4 text-amber-500" /> Admin Panel
            </CommandItem>
          )}
        </CommandGroup>

        {/* ---- Actions ---- */}
        <CommandGroup heading="Actions">
          <CommandItem value="upload-files" className="h-9 py-0!" onSelect={() => run(onUpload)}>
            <UploadCloud className="size-4 text-amber-500" /> Upload files…
          </CommandItem>
          {onOpenShortcuts && (
            <CommandItem value="keyboard-shortcuts" className="h-9 py-0!" onSelect={() => run(onOpenShortcuts)}>
              <Keyboard className="size-4 text-muted-foreground" /> Keyboard shortcuts
              <Kbd className="ml-auto">?</Kbd>
            </CommandItem>
          )}
          <CommandItem value="theme-light" className="h-9 py-0!" onSelect={() => run(() => setTheme('light'))}>
            <Sun className="size-4 text-amber-500" /> Theme: Light {theme === 'light' && <CheckMark />}
          </CommandItem>
          <CommandItem value="theme-dark" className="h-9 py-0!" onSelect={() => run(() => setTheme('dark'))}>
            <Moon className="size-4 text-amber-500" /> Theme: Dark {theme === 'dark' && <CheckMark />}
          </CommandItem>
          <CommandItem value="theme-system" className="h-9 py-0!" onSelect={() => run(() => setTheme('system'))}>
            <Laptop className="size-4 text-muted-foreground" /> Theme: System {theme === 'system' && <CheckMark />}
          </CommandItem>
          <CommandItem
            value="sign-out"
            className="h-9 py-0! text-red-500 data-[selected=true]:text-red-500"
            onSelect={() => run(async () => { await logout(); navigate('/') })}
          >
            <LogOut className="size-4" /> Sign out {user?.email ? `(${user.email})` : ''}
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}

function CheckMark() {
  return <span className="ml-auto text-[10px] font-semibold text-amber-500">●</span>
}

/** Global keyboard shortcut hook — ⌘K / Ctrl+K */
export function useCommandPaletteHotkey(onOpen: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        onOpen()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onOpen])
}
