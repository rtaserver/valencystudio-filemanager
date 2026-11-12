'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'framer-motion'
import { api, downloadFile } from '@/lib/client-api'
import { formatBytes, formatDate, fileKind, kindColor, statusColor, timeAgo } from '@/lib/format'
import { navigate, useHashRoute } from '@/lib/router'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { ShareDialog } from '@/components/views/share-dialog'
import { PreviewDialog } from '@/components/views/preview-dialog'
import { RenameDialog } from '@/components/views/rename-dialog'
import { DetailsDialog } from '@/components/views/details-dialog'
import { MoveDialog, type MoveTarget } from '@/components/views/move-dialog'
import { FOLDER_COLORS, folderColor } from '@/lib/folder-style'
import { toast } from 'sonner'
import {
  Search,
  LayoutGrid,
  List,
  MoreVertical,
  Download,
  Share2,
  Trash2,
  Eye,
  FileText,
  Image as ImageIcon,
  Film,
  Music,
  FileArchive,
  Code2,
  File as FileIcon,
  FileSpreadsheet,
  FileType2,
  RefreshCw,
  LinkIcon,
  Loader2,
  FolderOpen,
  CheckSquare,
  X,
  Pencil,
  Info,
  RotateCcw,
  Trash,
  AlarmClock,
  ListChecks,
  Folder,
  FolderPlus,
  ChevronRight,
  Home,
  FolderInput,
  CornerLeftUp,
  Star,
  ArrowUpToLine,
  CopyPlus,
  Images,
  PictureInPicture2,
} from 'lucide-react'

export interface FileRow {
  id: string
  name: string
  mimeType: string
  size: number
  status: string
  folderId?: string | null
  /** location breadcrumb shown in global search results, e.g. "Photos / 2024" */
  folderPath?: string
  starred: boolean
  shareEnabled: boolean
  shareSlug: string
  shareHasPassword: boolean
  shareExpiresAt?: string | null
  shareMaxDownloads?: number | null
  shareDownloadCount?: number
  downloads: number
  partCount: number
  deletedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface FolderRow {
  id: string
  name: string
  parentId: string | null
  emoji?: string | null
  color?: string | null
  fileCount: number
  totalSize: number
  createdAt: string
}

export type FilesMode = 'files' | 'shared' | 'trash' | 'starred'

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

const TYPE_CHIPS = [
  { key: 'all', label: 'All', icon: null },
  { key: 'image', label: 'Images', icon: ImageIcon },
  { key: 'video', label: 'Videos', icon: Film },
  { key: 'audio', label: 'Audio', icon: Music },
  { key: 'archive', label: 'Archives', icon: FileArchive },
  { key: 'doc', label: 'Docs', icon: FileType2 },
  { key: 'code', label: 'Code & Text', icon: Code2 },
]

const EMPTY_SELECTION = new Set<string>()

/** Roving-focus navigation for the file browser (grid = 2D, list = 1D) */
function focusNeighbor(container: HTMLElement, current: HTMLElement | null, dir: 'left' | 'right' | 'up' | 'down') {
  const items = Array.from(container.querySelectorAll<HTMLElement>('[data-kb]'))
  if (items.length === 0) return
  let idx = current ? items.indexOf(current) : -1
  if (idx === -1) {
    items[0].focus()
    items[0].scrollIntoView({ block: 'nearest' })
    return
  }
  // detect column count from shared offsetTop rows (grid layout)
  let cols = 1
  if (dir === 'up' || dir === 'down') {
    const top0 = items[0].offsetTop
    cols = Math.max(1, items.filter(el => Math.abs(el.offsetTop - top0) < 4).length)
  }
  let next = idx
  if (dir === 'left') next = idx - 1
  else if (dir === 'right') next = idx + 1
  else next = cols > 1 ? idx + (dir === 'down' ? cols : -cols) : idx + (dir === 'down' ? 1 : -1)
  next = Math.max(0, Math.min(items.length - 1, next))
  const el = items[next]
  el.focus()
  el.scrollIntoView({ block: 'nearest' })
}

function Thumb({ file, className = 'size-10 rounded-lg' }: { file: FileRow; className?: string }) {
  const [failed, setFailed] = useState(false)
  const kind = fileKind(file.mimeType, file.name)
  const Icon = kindIcons[kind] || FileIcon
  const isImage = kind === 'image' && file.status === 'READY'

  if (isImage && !failed) {
    return (
      <span className={`${className} shrink-0 overflow-hidden bg-muted grid place-items-center border border-border/60`}>
        <img
          src={`/api/files/${file.id}/download?inline=1`}
          alt={file.name}
          loading="lazy"
          onError={() => setFailed(true)}
          className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.06]"
        />
      </span>
    )
  }
  return (
    <span className={`${className} shrink-0 grid place-items-center ${kindColor(kind)} transition-transform duration-300 group-hover:scale-[1.06]`}>
      <Icon className={className.includes('size-12') ? 'size-6' : 'size-5'} />
    </span>
  )
}

export function FilesView({ mode = 'files' }: { mode?: FilesMode }) {
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [sort, setSort] = useState('newest')
  const [type, setType] = useState('all')
  const [viewRaw, setViewRaw] = useState<'grid' | 'list' | 'gallery'>(() => {
    if (typeof window === 'undefined') return 'grid'
    const v = localStorage.getItem('vs_view')
    return v === 'list' || v === 'gallery' ? v : 'grid'
  })
  const setView = (v: 'grid' | 'list' | 'gallery') => {
    setViewRaw(v)
    try { localStorage.setItem('vs_view', v) } catch {}
  }
  const view = viewRaw
  const [selectionState, setSelectionState] = useState<{
    route: ReturnType<typeof useHashRoute> | null
    selecting: boolean
    selected: Set<string>
  }>({ route: null, selecting: false, selected: EMPTY_SELECTION })
  const [confirmDelete, setConfirmDelete] = useState<FileRow | null>(null)
  const [confirmPurge, setConfirmPurge] = useState<FileRow | FileRow[] | null>(null)
  const [confirmFolderDelete, setConfirmFolderDelete] = useState<FolderRow | null>(null)
  const [shareFile, setShareFile] = useState<FileRow | null>(null)
  const [previewFile, setPreviewFile] = useState<FileRow | null>(null)
  const [renameFile, setRenameFile] = useState<FileRow | null>(null)
  const [detailsFile, setDetailsFile] = useState<FileRow | null>(null)
  const [moveTarget, setMoveTarget] = useState<MoveTarget | null>(null)
  const [folderDialogOpen, setFolderDialogOpen] = useState(false)
  const [folderDialogMode, setFolderDialogMode] = useState<'create' | 'rename'>('create')
  const [folderDialogTarget, setFolderDialogTarget] = useState<FolderRow | null>(null)
  const [folderNameInput, setFolderNameInput] = useState('')
  const [folderColorInput, setFolderColorInput] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const queryClient = useQueryClient()

  const route = useHashRoute()
  const folderId = mode === 'files' ? route.query.get('folder') : null
  const inFolder = mode === 'files' && !!folderId
  const searchActive = debounced.trim().length > 0
  const isSelectionForCurrentRoute = selectionState.route === route
  const selected = isSelectionForCurrentRoute ? selectionState.selected : EMPTY_SELECTION
  const selecting = isSelectionForCurrentRoute && selectionState.selecting
  const setSelected = (next: Set<string> | ((previous: Set<string>) => Set<string>)) => {
    setSelectionState(current => {
      const isCurrent = current.route === route
      const currentSelection = isCurrent ? current.selected : EMPTY_SELECTION
      return {
        route,
        selected: typeof next === 'function' ? next(currentSelection) : next,
        selecting: isCurrent ? current.selecting : false,
      }
    })
  }
  const setSelecting = (next: boolean | ((previous: boolean) => boolean)) => {
    setSelectionState(current => {
      const isCurrent = current.route === route
      return {
        route,
        selected: isCurrent ? current.selected : EMPTY_SELECTION,
        selecting: typeof next === 'function' ? next(isCurrent && current.selecting) : next,
      }
    })
  }

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300)
    return () => clearTimeout(t)
  }, [search])

  // "/" focuses search
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && !['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])


  const { data, isLoading, refetch, isRefetching } = useQuery<{ files: FileRow[] }>({
    queryKey: ['files', mode, debounced, sort, type, folderId],
    queryFn: () =>
      api(
        `/api/files?search=${encodeURIComponent(debounced)}&sort=${sort}&shared=${mode === 'shared' ? '1' : '0'}&trash=${mode === 'trash' ? '1' : '0'}&starred=${mode === 'starred' ? '1' : '0'}&type=${type}` +
          (mode === 'files' ? `&folder=${encodeURIComponent(folderId || 'root')}` : '')
      ),
    refetchInterval: 15000,
  })

  // folders in the current directory (files mode only)
  const { data: foldersData, isLoading: foldersLoading } = useQuery<{ folders: FolderRow[]; path: { id: string; name: string }[] }>({
    queryKey: ['folders', folderId],
    queryFn: () => api(`/api/folders?parent=${folderId ? encodeURIComponent(folderId) : 'root'}`),
    enabled: mode === 'files',
    refetchInterval: 20000,
  })

  const files = data?.files || []
  // IMPORTANT: scope folders to files mode — the disabled folders query keeps stale
  // cache in trash/shared mode, which previously blocked the empty state (blank page bug)
  const folders = mode === 'files' ? foldersData?.folders || [] : []
  const breadcrumb = foldersData?.path || []

  // scroll-to-top FAB (window is the scroller)
  const [showTop, setShowTop] = useState(false)
  useEffect(() => {
    const onScroll = () => setShowTop(window.scrollY > 480)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Deep link: #/files?…&open=<fileId> (from the ⌘K palette) opens the preview once the list loads
  const openParam = route.query.get('open')
  const urlPreviewFile = mode === 'files' && !isLoading && openParam
    ? files.find(f => f.id === openParam) || null
    : null
  const visiblePreviewFile = previewFile || urlPreviewFile
  const clearOpenParam = () => {
    if (openParam) navigate(`/files${folderId ? `?folder=${encodeURIComponent(folderId)}` : ''}`)
  }
  const openPreview = (file: FileRow) => {
    setPreviewFile(file)
    clearOpenParam()
  }

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['files'] })
    queryClient.invalidateQueries({ queryKey: ['folders'] })
    queryClient.invalidateQueries({ queryKey: ['folders-tree'] })
    queryClient.invalidateQueries({ queryKey: ['me'] })
  }, [queryClient])

  const doDelete = async () => {
    if (!confirmDelete) return
    const target = confirmDelete
    setConfirmDelete(null)
    try {
      await api(`/api/files/${target.id}`, { method: 'DELETE' })
      if (mode === 'trash') {
        toast.success(`"${target.name}" permanently deleted`)
      } else {
        toast.success(`"${target.name}" moved to trash`, {
          duration: 9000,
          action: { label: 'Undo', onClick: () => restoreById(target.id, target.name) },
        })
      }
      invalidate()
    } catch (e: any) {
      toast.error(e?.message || 'Delete failed')
    }
  }

  const restoreById = async (id: string, name?: string) => {
    try {
      await api(`/api/files/${id}/restore`, { method: 'POST' })
      toast.success(name ? `"${name}" restored` : 'Restored')
      invalidate()
    } catch (e: any) {
      toast.error(e?.message || 'Restore failed')
    }
  }

  // instant copy — reuses the same storage parts, zero bytes re-uploaded
  const duplicateFile = async (f: FileRow) => {
    try {
      const r = await api<{ file: { id: string; name: string } }>(`/api/files/${f.id}/duplicate`, { method: 'POST' })
      toast.success(`"${f.name}" duplicated as "${r.file.name}"`, {
        description: 'The copy shares the same storage parts — no re-upload needed.',
      })
      invalidate()
    } catch (e: any) {
      toast.error(e?.message || 'Duplicate failed')
    }
  }

  // duplicate every READY file in the selection (sequential, one summary toast)
  const [bulkDupBusy, setBulkDupBusy] = useState(false)
  const bulkDuplicate = async () => {
    const targets = files.filter(f => selected.has(f.id) && f.status === 'READY')
    if (targets.length === 0) {
      toast.info('Only finished uploads can be duplicated')
      return
    }
    setBulkDupBusy(true)
    let ok = 0
    for (const t of targets) {
      try {
        await api(`/api/files/${t.id}/duplicate`, { method: 'POST' })
        ok++
      } catch {}
    }
    setBulkDupBusy(false)
    toast.success(`Duplicated ${ok} of ${targets.length} file${targets.length !== 1 ? 's' : ''}`, {
      description: 'Copies share the same storage parts — zero extra bytes uploaded.',
    })
    invalidate()
  }

  const doPurgeSelection = async () => {
    const ids = confirmPurge instanceof Array ? confirmPurge.map(f => f.id) : [confirmPurge?.id]
    setConfirmPurge(null)
    try {
      const r = await api<{ affected: number }>('/api/files/bulk', { method: 'POST', body: { action: 'purge', ids } })
      toast.success(`${r.affected} file${r.affected !== 1 ? 's' : ''} permanently deleted`)
      setSelected(new Set())
      setSelecting(false)
      invalidate()
    } catch (e: any) {
      toast.error(e?.message || 'Delete failed')
    }
  }

  const restore = async (f: FileRow) => {
    try {
      await api(`/api/files/${f.id}/restore`, { method: 'POST' })
      toast.success(`"${f.name}" restored`)
      invalidate()
    } catch (e: any) {
      toast.error(e?.message || 'Restore failed')
    }
  }

  const bulkAction = async (action: 'trash' | 'restore') => {
    const ids = [...selected]
    if (ids.length === 0) return
    try {
      const r = await api<{ affected: number }>('/api/files/bulk', { method: 'POST', body: { action, ids } })
      if (action === 'trash') {
        toast.success(`${r.affected} file${r.affected !== 1 ? 's' : ''} moved to trash`, {
          duration: 9000,
          action: {
            label: 'Undo',
            onClick: async () => {
              try {
                await api('/api/files/bulk', { method: 'POST', body: { action: 'restore', ids } })
                toast.success('Restored')
                invalidate()
              } catch (e: any) {
                toast.error(e?.message || 'Restore failed')
              }
            },
          },
        })
      } else {
        toast.success(`${r.affected} file${r.affected !== 1 ? 's' : ''} restored`)
      }
      setSelected(new Set())
      setSelecting(false)
      invalidate()
    } catch (e: any) {
      toast.error(e?.message || 'Bulk action failed')
    }
  }

  const toggleStar = async (f: FileRow) => {
    const next = !f.starred
    try {
      await api(`/api/files/${f.id}`, { method: 'PATCH', body: { starred: next } })
      toast.success(next ? `"${f.name}" starred` : `"${f.name}" unstarred`, {
        duration: next ? undefined : 4000,
      })
      invalidate()
    } catch (e: any) {
      toast.error(e?.message || 'Could not update star')
    }
  }

  const bulkStar = async (star: boolean) => {
    const ids = [...selected]
    if (ids.length === 0) return
    try {
      const r = await api<{ affected: number }>('/api/files/bulk', { method: 'POST', body: { action: star ? 'star' : 'unstar', ids } })
      toast.success(`${r.affected} file${r.affected !== 1 ? 's' : ''} ${star ? 'starred' : 'unstarred'}`)
      setSelected(new Set())
      setSelecting(false)
      invalidate()
    } catch (e: any) {
      toast.error(e?.message || 'Bulk action failed')
    }
  }

  const copyShareLink = (f: FileRow) => {
    const url = `${window.location.origin}/#/f/${f.shareSlug}`
    navigator.clipboard.writeText(url).then(
      () => toast.success('Share link copied to clipboard'),
      () => toast.error('Could not copy link')
    )
  }

  // files dragged from a card and dropped onto a folder card
  const moveDroppedFiles = async (ids: string[], targetFolderId: string) => {
    const movers = files.filter(f => ids.includes(f.id) && (f.folderId || null) !== targetFolderId)
    if (movers.length === 0) {
      toast.info('These files are already in that folder')
      return
    }
    const fd = folders.find(x => x.id === targetFolderId)
    try {
      const r = await api<{ affected: number }>('/api/files/bulk', {
        method: 'POST',
        body: { action: 'move', ids: movers.map(f => f.id), folderId: targetFolderId },
      })
      // remember original locations so the move can be undone
      const origin = new Map<string | null, string[]>()
      for (const f of movers) {
        const k = f.folderId || null
        if (!origin.has(k)) origin.set(k, [])
        origin.get(k)!.push(f.id)
      }
      toast.success(`${r.affected} file${r.affected !== 1 ? 's' : ''} moved to ${fd ? `"${fd.name}"` : 'folder'}`, {
        duration: 9000,
        action: {
          label: 'Undo',
          onClick: async () => {
            try {
              for (const [srcFolder, moveIds] of origin) {
                await api('/api/files/bulk', { method: 'POST', body: { action: 'move', ids: moveIds, folderId: srcFolder } })
              }
              toast.success('Move undone')
              invalidate()
            } catch (e: any) {
              toast.error(e?.message || 'Undo failed')
            }
          },
        },
      })
      invalidate()
    } catch (e: any) {
      toast.error(e?.message || 'Move failed')
    }
  }

  // ---- folder handlers ----
  const openFolderDialog = (mode: 'create' | 'rename', folder?: FolderRow) => {
    setFolderDialogMode(mode)
    setFolderDialogTarget(folder || null)
    setFolderNameInput(mode === 'rename' ? folder?.name || '' : '')
    setFolderColorInput(mode === 'rename' ? folder?.color || '' : '')
    setFolderDialogOpen(true)
  }

  const submitFolderDialog = async () => {
    const name = folderNameInput.trim().slice(0, 80)
    if (!name) {
      toast.error('Folder name is required')
      return
    }
    try {
      if (folderDialogMode === 'create') {
        await api('/api/folders', {
          method: 'POST',
          body: { name, parentId: folderId, emoji: null, color: folderColorInput || null },
        })
        toast.success(`Folder "${name}" created`)
      } else if (folderDialogTarget) {
        await api(`/api/folders/${folderDialogTarget.id}`, {
          method: 'PATCH',
          body: { name, emoji: null, color: folderColorInput || null },
        })
        toast.success('Folder updated')
      }
      setFolderDialogOpen(false)
      invalidate()
    } catch (e: any) {
      toast.error(e?.message || 'Folder operation failed')
    }
  }

  const doFolderDelete = async () => {
    if (!confirmFolderDelete) return
    const target = confirmFolderDelete
    setConfirmFolderDelete(null)
    try {
      const r = await api<{ trashed: number; folders: number }>(`/api/folders/${target.id}`, { method: 'DELETE' })
      toast.success(`Folder "${target.name}" deleted — ${r.trashed} file${r.trashed !== 1 ? 's' : ''} moved to trash`)
      invalidate()
    } catch (e: any) {
      toast.error(e?.message || 'Folder deletion failed')
    }
  }

  const goUp = () => {
    if (breadcrumb.length >= 2) navigate(`/files?folder=${encodeURIComponent(breadcrumb[breadcrumb.length - 2].id)}`)
    else navigate('/files')
  }

  const selectAll = () => {
    setSelected(new Set(files.map(f => f.id)))
  }

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const trashMode = mode === 'trash'
  const starredMode = mode === 'starred'
  const selectedIds = useMemo(() => [...selected], [selected])
  const placeholder = trashMode
    ? 'Search trash…'
    : mode === 'shared'
      ? 'Search shared files…'
      : starredMode
        ? 'Search starred files…'
        : inFolder
          ? `Search everywhere (current: ${breadcrumb[breadcrumb.length - 1]?.name || 'folder'})…`
          : 'Search your files…  (press /)'

  const cardHandlers = (f: FileRow) => ({
    onShare: () => setShareFile(f),
    onPreview: () => openPreview(f),
    onDelete: () => setConfirmDelete(f),
    onDownload: () => downloadFile(`/api/files/${f.id}/download`),
    onCopyLink: () => copyShareLink(f),
    onRename: () => setRenameFile(f),
    onDetails: () => setDetailsFile(f),
    onRestore: () => restore(f),
    onPurge: () => setConfirmPurge(f),
    onMove: () => setMoveTarget({ fileIds: [f.id] }),
    onStar: () => toggleStar(f),
    onDuplicate: () => duplicateFile(f),
  })

  const showFolders = mode === 'files' && !searchActive
  // NOTE: folders only gate the empty state while they are actually rendered (files mode, not searching).
  // Otherwise a stale root-folder count suppressed the "No results" state → blank page.
  const showEmptyState = !isLoading && files.length === 0 && (!showFolders || (folders.length === 0 && !foldersLoading))

  // ---- rubber-band (marquee) multi-select — grid view, files mode only ----
  const [marqueeRect, setMarqueeRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const marquee = useRef<{ startX: number; startY: number } | null>(null)
  const lastPos = useRef({ x: 0, y: 0 })

  const onContentMouseDown = (e: React.MouseEvent) => {
    if (mode !== 'files' || (view !== 'grid' && view !== 'gallery')) return
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return
    const target = e.target as HTMLElement
    // start only on the background/gaps — never on cards, folders or interactive elements
    if (target.closest('[data-kb],button,a,input,textarea,select,[role="menuitem"],[data-radix-popper-content-wrapper]')) return
    e.preventDefault() // stop native text selection while dragging
    marquee.current = { startX: e.clientX, startY: e.clientY }
    lastPos.current = { x: e.clientX, y: e.clientY }
    setMarqueeRect({ x: e.clientX, y: e.clientY, w: 0, h: 0 })
  }

  useEffect(() => {
    if (mode !== 'files' || (view !== 'grid' && view !== 'gallery')) return
    const onMove = (e: MouseEvent) => {
      const m = marquee.current
      if (!m) return
      lastPos.current = { x: e.clientX, y: e.clientY }
      const rect = { x: m.startX, y: m.startY, w: e.clientX - m.startX, h: e.clientY - m.startY }
      setMarqueeRect(rect)
      const container = contentRef.current
      if (!container) return
      const left = Math.min(rect.x, rect.x + rect.w)
      const top = Math.min(rect.y, rect.y + rect.h)
      const right = left + Math.abs(rect.w)
      const bottom = top + Math.abs(rect.h)
      const hits = new Set<string>()
      container.querySelectorAll<HTMLElement>('[data-kb-type="file"]').forEach(el => {
        const r = el.getBoundingClientRect()
        if (r.left < right && r.right > left && r.top < bottom && r.bottom > top) {
          const id = el.getAttribute('data-kb-id')
          if (id) hits.add(id)
        }
      })
      setSelecting(prev => prev || hits.size > 0)
      setSelected(hits)
    }
    const onUp = () => {
      const m = marquee.current
      if (!m) return
      marquee.current = null
      setMarqueeRect(null)
      // tiny drag = a plain click on the background → clear the selection
      if (Math.hypot(lastPos.current.x - m.startX, lastPos.current.y - m.startY) < 4) {
        setSelected(new Set())
        setSelecting(false)
      }
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [mode, view])

  // ---- keyboard navigation across cards/rows ----
  const onContentKeyDown = (e: React.KeyboardEvent) => {
    const container = contentRef.current
    if (!container) return
    const active = document.activeElement as HTMLElement | null
    const isItem = !!active && container.contains(active) && active.hasAttribute('data-kb')
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      if (!isItem) return
      e.preventDefault()
      const dir = e.key === 'ArrowLeft' ? 'left' : e.key === 'ArrowRight' ? 'right' : e.key === 'ArrowUp' ? 'up' : 'down'
      focusNeighbor(container, active, dir)
      return
    }
    if (!isItem) return
    const itemId = active!.getAttribute('data-kb-id') || ''
    const itemType = active!.getAttribute('data-kb-type')
    const itemFile = files.find(f => f.id === itemId)
    if ((e.key === 'Enter' || e.key === ' ') && e.target === active) {
      e.preventDefault()
      if (itemType === 'folder') {
        navigate(`/files?folder=${encodeURIComponent(itemId)}`)
      } else if (itemFile) {
        if (trashMode) setDetailsFile(itemFile)
        else openPreview(itemFile)
      }
    } else if (e.key === ' ' && itemType === 'file' && !trashMode) {
      e.preventDefault()
      if (!selecting) setSelecting(true)
      toggleSelect(itemId)
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && itemFile && e.target === active) {
      e.preventDefault()
      if (trashMode) setConfirmPurge(itemFile)
      else setConfirmDelete(itemFile)
    } else if (e.key === 's' && itemFile && !trashMode && e.target === active && !e.metaKey && !e.ctrlKey && !e.altKey) {
      // keyboard star toggle on the focused file
      e.preventDefault()
      toggleStar(itemFile)
    } else if (e.key === 'Escape') {
      if (selected.size > 0 || selecting) {
        e.preventDefault()
        setSelected(new Set())
        setSelecting(false)
      }
    }
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <label htmlFor="file-search" className="sr-only">Search files and folders</label>
          <Input
            id="file-search"
            ref={searchRef}
            placeholder={placeholder}
            className="pl-9 pr-9"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {!trashMode && !search && (
            <kbd className="absolute right-2.5 top-1/2 -translate-y-1/2 hidden md:inline-flex h-5 items-center rounded border border-border/80 bg-muted/60 px-1.5 font-mono text-[10px] text-muted-foreground pointer-events-none">
              /
            </kbd>
          )}
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
              aria-label="Clear search"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
        {!trashMode && (
          <Select value={sort} onValueChange={setSort}>
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="Sort" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">Newest first</SelectItem>
              <SelectItem value="oldest">Oldest first</SelectItem>
              <SelectItem value="starred" className="gap-2">Starred first</SelectItem>
              <SelectItem value="largest">Largest first</SelectItem>
              <SelectItem value="smallest">Smallest first</SelectItem>
              <SelectItem value="name">Name A→Z</SelectItem>
              <SelectItem value="downloads">Most downloaded</SelectItem>
            </SelectContent>
          </Select>
        )}
        <div className="flex items-center rounded-lg border border-border overflow-hidden" role="group" aria-label="View mode">
          <button
            className={`p-2 cursor-pointer transition-colors ${view === 'grid' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            onClick={() => setView('grid')}
            aria-label="Grid view"
            title="Grid view"
          >
            <LayoutGrid className="size-4" />
          </button>
          <button
            className={`p-2 cursor-pointer border-l border-border transition-colors ${view === 'gallery' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            onClick={() => setView('gallery')}
            aria-label="Gallery view"
            title="Gallery view (photos only)"
          >
            <Images className="size-4" />
          </button>
          <button
            className={`p-2 cursor-pointer border-l border-border transition-colors ${view === 'list' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            onClick={() => setView('list')}
            aria-label="List view"
            title="List view"
          >
            <List className="size-4" />
          </button>
        </div>
        {mode === 'files' && (
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => openFolderDialog('create')}>
            <FolderPlus className="size-4" />
            <span className="hidden sm:inline">New folder</span>
          </Button>
        )}
        {!trashMode && (
          <Button
            variant={selecting ? 'default' : 'outline'}
            size="sm"
            className="gap-1.5"
            onClick={() => {
              setSelecting(s => !s)
              setSelected(new Set())
            }}
          >
            {selecting ? <X className="size-4" /> : <CheckSquare className="size-4" />}
            <span className="hidden sm:inline">{selecting ? 'Cancel' : 'Select'}</span>
          </Button>
        )}
        <Button variant="outline" size="icon" onClick={() => refetch()} aria-label="Refresh" disabled={isRefetching}>
          {isRefetching ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
        </Button>
      </div>

      {/* Breadcrumbs */}
      {mode === 'files' && !searchActive && (
        <div className="flex items-center gap-1 flex-wrap">
          {breadcrumb.length > 0 && (
            <button
              onClick={goUp}
              className="mr-1 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors cursor-pointer"
              aria-label="Go up one folder"
              title="Go up one folder"
            >
              <CornerLeftUp className="size-4" />
            </button>
          )}
          <button
            onClick={() => navigate('/files')}
            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer ${
              breadcrumb.length === 0
                ? 'bg-accent text-foreground border border-border/80 shadow-xs'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent/60'
            }`}
          >
            <Home className="size-3.5" /> My Files
          </button>
          {breadcrumb.map((b, i) => {
            const last = i === breadcrumb.length - 1
            const bColor = folderColor((b as any).color)
            return (
              <div key={b.id} className="flex items-center gap-1">
                <ChevronRight className="size-3.5 text-muted-foreground/40" />
                {last ? (
                  <span className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium border ${bColor.active} shadow-xs`}>
                    <Folder className="size-3.5" /> {b.name}
                  </span>
                ) : (
                  <button
                    onClick={() => navigate(`/files?folder=${encodeURIComponent(b.id)}`)}
                    className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-colors cursor-pointer flex items-center gap-1"
                  >
                    {b.name}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
      {mode === 'files' && searchActive && (
        <div className="text-xs text-muted-foreground">
          Showing results for <span className="text-foreground font-medium">“{debounced.trim()}”</span> across all folders ·{' '}
          <button onClick={() => setSearch('')} className="text-amber-500 hover:underline cursor-pointer">back to {inFolder ? breadcrumb[breadcrumb.length - 1]?.name || 'folder' : 'My Files'}</button>
        </div>
      )}

      {/* Type chips */}
      {!trashMode && mode === 'files' && (
        <div className="flex flex-wrap gap-1.5">
          {TYPE_CHIPS.map(chip => {
            const ChipIcon = chip.icon
            return (
              <button
                key={chip.key}
                onClick={() => setType(chip.key)}
                className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer inline-flex items-center gap-1.5 ${
                  type === chip.key
                    ? 'border-primary bg-primary/10 text-primary shadow-xs'
                    : 'border-border/80 bg-card text-muted-foreground hover:bg-accent/60 hover:text-foreground'
                }`}
              >
                {ChipIcon && <ChipIcon className="size-3.5" />}
                {chip.label}
              </button>
            )
          })}
        </div>
      )}

      {/* Selection / summary strip */}
      {!isLoading && files.length > 0 && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground/80">
            {files.length} file{files.length !== 1 ? 's' : ''}
          </span>
          <span className="text-border">·</span>
          <span>{formatBytes(files.reduce((a, f) => a + f.size, 0))} total</span>
          {files.some(f => f.starred) && (
            <>
              <span className="text-border">·</span>
              <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
                <Star className="size-3 fill-amber-400 text-amber-400" />
                {files.filter(f => f.starred).length} starred
              </span>
            </>
          )}
          {files.some(f => f.shareEnabled) && (
            <>
              <span className="text-border">·</span>
              <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
                <LinkIcon className="size-3" />
                {files.filter(f => f.shareEnabled).length} shared
              </span>
            </>
          )}
        </div>
      )}

      {/* Bulk action bar */}
      <AnimatePresence>
        {selecting && selected.size > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="rounded-lg border border-border/80 bg-card/95 backdrop-blur shadow-md px-4 py-2.5 flex flex-wrap items-center gap-2.5"
          >
            <span className="text-xs font-semibold font-mono tnum px-2 py-0.5 rounded bg-muted border border-border/60">
              {selected.size} selected
            </span>
            <span className="text-xs text-muted-foreground font-mono tnum">
              {formatBytes(files.filter(f => selected.has(f.id)).reduce((a, f) => a + f.size, 0))}
            </span>
            {selected.size < files.length && (
              <Button size="sm" variant="ghost" className="h-7 text-xs gap-1.5" onClick={selectAll}>
                <ListChecks className="size-3.5" /> Select all ({files.length})
              </Button>
            )}
            <div className="flex-1" />
            {!trashMode && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 h-8 text-xs"
                  onClick={() => bulkStar(selectedIds.some(id => files.find(f => f.id === id)?.starred) ? false : true)}
                  title={selectedIds.some(id => files.find(f => f.id === id)?.starred) ? 'Unstar selection' : 'Star selection'}
                >
                  <Star className={`size-3.5 ${selectedIds.some(id => files.find(f => f.id === id)?.starred) ? 'fill-amber-400 text-amber-500' : ''}`} />
                  {selectedIds.some(id => files.find(f => f.id === id)?.starred) ? 'Unstar' : 'Star'}
                </Button>
                <Button size="sm" variant="outline" className="gap-1.5 h-8 text-xs" onClick={() => setMoveTarget({ fileIds: [...selected] })}>
                  <FolderInput className="size-3.5" /> Move
                </Button>
                {mode === 'files' && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5 h-8 text-xs"
                    onClick={bulkDuplicate}
                    disabled={bulkDupBusy}
                    title="Instant copies — reuse storage parts"
                  >
                    {bulkDupBusy ? <Loader2 className="size-3.5 animate-spin" /> : <CopyPlus className="size-3.5" />}
                    Duplicate
                  </Button>
                )}
                <Button size="sm" variant="outline" className="gap-1.5 h-8 text-xs text-rose-600 dark:text-rose-400 border-rose-500/30 hover:bg-rose-500/10" onClick={() => bulkAction('trash')}>
                  <Trash2 className="size-3.5" /> Trash
                </Button>
              </>
            )}
            {trashMode && (
              <>
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => bulkAction('restore')}>
                  <RotateCcw className="size-3.5" /> Restore
                </Button>
                <Button size="sm" variant="destructive" className="gap-1.5" onClick={() => setConfirmPurge(files.filter(f => selected.has(f.id)))}>
                  <Trash2 className="size-3.5" /> Delete forever
                </Button>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Content */}
      {isLoading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-36 rounded-lg" />
          ))}
        </div>
      ) : showEmptyState ? (
        /* Empty state */
        <div className="rounded-lg border border-dashed border-border/80 p-10 sm:p-12 text-center relative overflow-hidden">
          <div className="relative">
            {searchActive ? (
              <>
                <div className="mx-auto size-16 rounded-lg bg-muted/40 border border-border/60 grid place-items-center">
                  <Search className="size-7 text-muted-foreground/70" />
                </div>
                <h3 className="mt-5 font-semibold text-base">No results for “{debounced.trim()}”</h3>
                <p className="mt-1.5 text-sm text-muted-foreground max-w-sm mx-auto leading-relaxed">
                  {trashMode ? 'Nothing in the trash matches your search.' : mode === 'shared' ? 'No shared link matches your search.' : mode === 'starred' ? 'No starred file matches your search.' : 'No file in any folder matches your search. Try a different term.'}
                </p>
                <div className="mt-5">
                  <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setSearch('')}>
                    <X className="size-4" /> Clear search
                  </Button>
                </div>
              </>
            ) : (
              <>
            <div className="mx-auto size-16 rounded-lg bg-muted/40 border border-border/60 grid place-items-center">
              {trashMode ? (
                <Trash2 className="size-7 text-muted-foreground/70" strokeWidth={1.5} />
              ) : mode === 'shared' ? (
                <LinkIcon className="size-7 text-muted-foreground/70" strokeWidth={1.5} />
              ) : mode === 'starred' ? (
                <Star className="size-7 text-muted-foreground/70" strokeWidth={1.5} />
              ) : (
                <FolderOpen className="size-7 text-muted-foreground/70" strokeWidth={1.5} />
              )}
            </div>
            <h3 className="mt-5 font-semibold text-base">
              {trashMode
                ? 'Trash is empty'
                : mode === 'shared'
                  ? 'No shared links yet'
                  : mode === 'starred'
                    ? 'No starred files yet'
                    : inFolder
                      ? 'This folder is empty'
                      : 'No files yet'}
            </h3>
            <p className="mt-1.5 text-sm text-muted-foreground max-w-sm mx-auto leading-relaxed">
              {trashMode
                ? 'Deleted files stay here for 30 days before being purged automatically.'
                : mode === 'shared'
                  ? 'Create a share link from any file to see it listed here.'
                  : mode === 'starred'
                    ? 'Star your important files to pin them here for quick access. Press “s” on any focused file, or use the card menu.'
                  : inFolder
                    ? 'Drop files anywhere on the page to upload into this folder, or create a subfolder to stay organized.'
                    : 'Drag & drop files anywhere, or hit the Upload button to store your first file in the cloud vault. Create folders to keep things tidy.'}
            </p>
            {mode === 'files' && (
              <div className="mt-5 flex items-center justify-center gap-2 flex-wrap">
                <Button size="sm" className="gap-1.5" onClick={() => openFolderDialog('create')}>
                  <FolderPlus className="size-4" /> New folder
                </Button>
                {inFolder && (
                  <Button size="sm" variant="outline" className="gap-1.5" onClick={goUp}>
                    <CornerLeftUp className="size-4" /> Back to {breadcrumb.length >= 2 ? breadcrumb[breadcrumb.length - 2].name : 'My Files'}
                  </Button>
                )}
              </div>
            )}
              </>
            )}
          </div>
        </div>
      ) : (
        <div ref={contentRef} onKeyDown={onContentKeyDown} onMouseDown={onContentMouseDown} className={mode === 'files' && (view === 'grid' || view === 'gallery') ? 'cursor-crosshair' : undefined}>
          {/* crosshair hints "drag on empty space to multi-select" (grid/gallery view, files mode) */}
          {/* Folders */}
          {showFolders && folders.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[11px] uppercase tracking-wider text-muted-foreground/70 font-semibold">Folders</span>
                <span className="text-[11px] text-muted-foreground/50">{folders.length}</span>
              </div>
              {view === 'grid' ? (
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                  {folders.map((fd, i) => (
                    <motion.div
                      key={fd.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: Math.min(i * 0.03, 0.3), duration: 0.25 }}
                    >
                      <FolderCard
                        folder={fd}
                        onOpen={() => navigate(`/files?folder=${encodeURIComponent(fd.id)}`)}
                        onRename={() => openFolderDialog('rename', fd)}
                        onMove={() => setMoveTarget({ folderId: fd.id, folderName: fd.name })}
                        onDelete={() => setConfirmFolderDelete(fd)}
                        onDropFiles={ids => moveDroppedFiles(ids, fd.id)}
                      />
                    </motion.div>
                  ))}
                </div>
              ) : (
                <FolderList
                  folders={folders}
                  onOpen={id => navigate(`/files?folder=${encodeURIComponent(id)}`)}
                  onRename={fd => openFolderDialog('rename', fd)}
                  onMove={fd => setMoveTarget({ folderId: fd.id, folderName: fd.name })}
                  onDelete={fd => setConfirmFolderDelete(fd)}
                  onDropFiles={(fd, ids) => moveDroppedFiles(ids, fd.id)}
                />
              )}
            </div>
          )}

          {showFolders && foldersLoading && (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {Array.from({ length: 2 }).map((_, i) => (
                <Skeleton key={i} className="h-[88px] rounded-lg" />
              ))}
            </div>
          )}

          {/* Files */}
          {files.length === 0 ? (
            showFolders && folders.length > 0 ? (
              <div className="rounded-lg border border-dashed border-border/60 p-8 text-center text-sm text-muted-foreground">
                No files here yet — but there {folders.length === 1 ? 'is 1 folder' : `are ${folders.length} folders`} in this directory.
              </div>
            ) : null
          ) : view === 'gallery' ? (
            <GalleryView
              files={files}
              mode={mode}
              selecting={selecting}
              selected={selected}
              selectedIds={selectedIds}
              showPath={searchActive}
              onToggle={toggleSelect}
              onBackToGrid={() => setView('grid')}
              handlersFor={cardHandlers}
            />
          ) : view === 'grid' ? (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {files.map((f, i) => (
                <motion.div
                  key={f.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i * 0.03, 0.4), duration: 0.25 }}
                >
                  <GridCard
                    file={f}
                    mode={mode}
                    selecting={selecting}
                    selected={selected.has(f.id)}
                    selectedIds={selectedIds}
                    showPath={searchActive}
                    onToggle={() => toggleSelect(f.id)}
                    {...cardHandlers(f)}
                  />
                </motion.div>
              ))}
            </div>
          ) : (
            <ListView
              files={files}
              mode={mode}
              selecting={selecting}
              selected={selected}
              showPath={searchActive}
              onToggle={toggleSelect}
              handlersFor={cardHandlers}
            />
          )}
        </div>
      )}

      {/* rubber-band marquee overlay (fixed coords, purely visual) */}
      {marqueeRect && (
        <>
          <div
            aria-hidden
            className="fixed z-[60] pointer-events-none rounded border border-primary/70 bg-primary/10 shadow-sm"
            style={{
              left: Math.min(marqueeRect.x, marqueeRect.x + marqueeRect.w),
              top: Math.min(marqueeRect.y, marqueeRect.y + marqueeRect.h),
              width: Math.abs(marqueeRect.w),
              height: Math.abs(marqueeRect.h),
            }}
          />
          {selected.size > 0 && (
            <div
              aria-hidden
              className="fixed z-[60] pointer-events-none -translate-y-[calc(100%+6px)] rounded bg-foreground px-2 py-0.5 text-[10px] font-mono font-medium text-background shadow-md"
              style={{
                left: Math.min(marqueeRect.x, marqueeRect.x + marqueeRect.w),
                top: Math.min(marqueeRect.y, marqueeRect.y + marqueeRect.h),
              }}
            >
              {selected.size} selected
            </div>
          )}
        </>
      )}

      {/* New / edit folder dialog */}
      <Dialog open={folderDialogOpen} onOpenChange={setFolderDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FolderPlus className="size-4 text-amber-500" />
              {folderDialogMode === 'create' ? 'Create new folder' : 'Edit folder'}
            </DialogTitle>
            <DialogDescription>
              {folderDialogMode === 'create'
                ? `A new folder will be created ${inFolder ? `inside “${breadcrumb[breadcrumb.length - 1]?.name}”` : 'in My Files'}.`
                : 'Rename or restyle this folder.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <span
                className={`size-10 rounded-md shrink-0 grid place-items-center border ${folderColor(folderColorInput).chip}`}
                aria-hidden
              >
                <Folder className="size-5" />
              </span>
              <Input
                autoFocus
                value={folderNameInput}
                onChange={e => setFolderNameInput(e.target.value)}
                placeholder="Folder name"
                maxLength={80}
                onKeyDown={e => e.key === 'Enter' && submitFolderDialog()}
              />
            </div>
            <div>
              <div className="text-xs font-medium text-muted-foreground mb-1.5">Color</div>
              <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Folder color">
                <button
                  type="button"
                  role="radio"
                  aria-checked={!folderColorInput}
                  onClick={() => setFolderColorInput('')}
                  title="Default (amber)"
                  className={`size-7 rounded-full cursor-pointer transition-all grid place-items-center ${
                    !folderColorInput ? 'ring-2 ring-amber-500 ring-offset-2 ring-offset-background scale-105' : 'ring-1 ring-border hover:scale-105'
                  }`}
                  style={{ background: '#f59e0b22' }}
                >
                  <span className="size-3.5 rounded-full bg-amber-500" />
                </button>
                {FOLDER_COLORS.map(c => (
                  <button
                    key={c.key}
                    type="button"
                    role="radio"
                    aria-checked={folderColorInput === c.key}
                    onClick={() => setFolderColorInput(c.key)}
                    title={c.label}
                    className={`size-7 rounded-full cursor-pointer transition-all ${
                      folderColorInput === c.key
                        ? 'ring-2 ring-amber-500 ring-offset-2 ring-offset-background scale-105'
                        : 'ring-1 ring-border hover:scale-105'
                    }`}
                    style={{ background: c.hex }}
                    aria-label={c.label}
                  />
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFolderDialogOpen(false)}>Cancel</Button>
            <Button onClick={submitFolderDialog} disabled={!folderNameInput.trim()}>
              {folderDialogMode === 'create' ? 'Create folder' : 'Save changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Folder delete confirm */}
      <AlertDialog open={!!confirmFolderDelete} onOpenChange={o => !o && setConfirmFolderDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete folder “{confirmFolderDelete?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              All {confirmFolderDelete?.fileCount ?? 0} file{confirmFolderDelete?.fileCount === 1 ? '' : 's'} inside (including subfolders) will be moved to the Trash, and the folder structure will be removed. This cannot be undone for folders.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700 text-white" onClick={doFolderDelete}>
              Delete folder
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!confirmDelete} onOpenChange={o => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {mode === 'trash' ? `Permanently delete “${confirmDelete?.name}”?` : `Move “${confirmDelete?.name}” to trash?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {mode === 'trash'
                ? 'This permanently removes the file from the cloud vault. This action cannot be undone.'
                : 'Trashed files are kept for 30 days, then purged automatically. Share links are disabled while trashed.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700 text-white" onClick={doDelete}>
              {mode === 'trash' ? 'Delete permanently' : 'Move to trash'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!confirmPurge} onOpenChange={o => !o && setConfirmPurge(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Permanently delete {confirmPurge instanceof Array ? `${confirmPurge.length} files` : `“${(confirmPurge as FileRow)?.name}”`}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This removes the file(s) from cloud storage forever. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700 text-white" onClick={doPurgeSelection}>
              Delete forever
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ShareDialog file={shareFile} onClose={() => setShareFile(null)} />
      <PreviewDialog
        file={visiblePreviewFile}
        onClose={() => {
          setPreviewFile(null)
          clearOpenParam()
        }}
      />
      <RenameDialog file={renameFile} onClose={() => setRenameFile(null)} onRenamed={invalidate} />
      <DetailsDialog file={detailsFile} onClose={() => setDetailsFile(null)} />
      <MoveDialog
        target={moveTarget}
        onClose={() => setMoveTarget(null)}
        onMoved={() => {
          setSelected(new Set())
          setSelecting(false)
          invalidate()
        }}
      />

      {/* scroll-to-top */}
      <AnimatePresence>
        {showTop && (
          <motion.button
            key="scroll-top"
            initial={{ opacity: 0, scale: 0.8, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.8, y: 8 }}
            transition={{ duration: 0.15 }}
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            aria-label="Back to top"
            title="Back to top"
            className="fixed bottom-5 right-5 z-40 size-9 rounded-full border border-border/80 bg-background/90 backdrop-blur shadow-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:border-border transition-all cursor-pointer"
          >
            <ArrowUpToLine className="size-4" />
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  )
}

interface CardHandlers {
  onShare: () => void
  onPreview: () => void
  onDelete: () => void
  onDownload: () => void
  onCopyLink: () => void
  onRename: () => void
  onDetails: () => void
  onRestore: () => void
  onPurge: () => void
  onMove: () => void
  onStar: () => void
  onDuplicate: () => void
}

/** Masonry photo-wall — images only; non-image files are summarized in a hint strip */
function GalleryView({
  files,
  mode,
  selecting,
  selected,
  selectedIds,
  showPath,
  onToggle,
  onBackToGrid,
  handlersFor,
}: {
  files: FileRow[]
  mode: FilesMode
  selecting: boolean
  selected: Set<string>
  selectedIds: string[]
  showPath?: boolean
  onToggle: (id: string) => void
  onBackToGrid: () => void
  handlersFor: (f: FileRow) => CardHandlers
}) {
  const images = files.filter(f => fileKind(f.mimeType, f.name) === 'image')
  const hidden = files.length - images.length
  const selectedCount = selectedIds.filter(id => images.some(f => f.id === id)).length

  return (
    <div>
      {hidden > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2.5 rounded-lg border border-border/70 bg-muted/20 px-3.5 py-2 text-xs">
          <Images className="size-3.5 text-muted-foreground shrink-0" />
          <span className="text-muted-foreground">
            Gallery filter active — <span className="font-mono tnum text-foreground">{hidden}</span> non-image file{hidden !== 1 ? 's' : ''} hidden.
          </span>
          <Button size="sm" variant="outline" className="ml-auto h-7 text-xs gap-1.5" onClick={onBackToGrid}>
            <LayoutGrid className="size-3" /> Show all files
          </Button>
        </div>
      )}
      {images.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border/80 p-10 text-center">
          <div className="mx-auto size-14 rounded-lg bg-muted/40 border border-border/60 grid place-items-center">
            <Images className="size-6 text-muted-foreground/70" />
          </div>
          <h3 className="mt-4 font-semibold text-sm">No photos in this view</h3>
          <p className="mt-1 text-xs text-muted-foreground max-w-xs mx-auto">
            Upload some images and they will appear as a photo wall here.
          </p>
          <Button size="sm" variant="outline" className="mt-4 gap-1.5" onClick={onBackToGrid}>
            <LayoutGrid className="size-3.5" /> Back to grid
          </Button>
        </div>
      ) : (
        <>
          {selectedCount > 0 && !selecting && (
            <div className="mb-2 text-xs text-muted-foreground">{selectedCount} photo{selectedCount !== 1 ? 's' : ''} selected</div>
          )}
          <div className="columns-2 sm:columns-3 xl:columns-4 2xl:columns-5 gap-3">
            {images.map((f, i) => (
              <motion.div
                key={f.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i * 0.03, 0.4), duration: 0.28 }}
                className="mb-3 break-inside-avoid"
              >
                <GalleryTile
                  file={f}
                  mode={mode}
                  selecting={selecting}
                  selected={selected.has(f.id)}
                  selectedIds={selectedIds}
                  showPath={showPath}
                  onToggle={() => onToggle(f.id)}
                  {...handlersFor(f)}
                />
              </motion.div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function GalleryTile({
  file,
  mode,
  selecting,
  selected,
  selectedIds,
  showPath,
  onToggle,
  ...h
}: {
  file: FileRow
  mode: FilesMode
  selecting: boolean
  selected: boolean
  selectedIds: string[]
  showPath?: boolean
  onToggle: () => void
} & CardHandlers) {
  const [failed, setFailed] = useState(false)
  const [draggingSelf, setDraggingSelf] = useState(false)
  const canDrag = mode === 'files'
  const ready = file.status === 'READY'
  return (
    <div
      role="button"
      tabIndex={0}
      data-kb="file"
      data-kb-type="file"
      data-kb-id={file.id}
      draggable={canDrag}
      onDoubleClick={() => (mode === 'trash' ? h.onDetails() : h.onPreview())}
      title={mode === 'trash' ? 'Double-click for details' : 'Double-click to preview'}
      onDragStart={e => {
        if (!canDrag) return
        const ids = selecting && selected ? selectedIds : [file.id]
        e.dataTransfer.setData(DRAG_MIME, JSON.stringify(ids))
        e.dataTransfer.effectAllowed = 'move'
        setDraggingSelf(true)
      }}
      onDragEnd={() => setDraggingSelf(false)}
      onClick={e => {
        // plain click previews; checkbox clicks are stopped upstream
        if ((e.target as HTMLElement).closest('[data-tile-action]')) return
        if (mode === 'trash') h.onDetails()
        else h.onPreview()
      }}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          if (mode === 'trash') h.onDetails()
          else h.onPreview()
        }
      }}
      className={`group relative overflow-hidden rounded-lg border bg-card cursor-pointer transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
        selected ? 'border-primary ring-2 ring-primary/25' : 'border-border/70 hover:border-border hover:shadow-sm'
      } ${draggingSelf ? 'opacity-40' : ''}`}
    >
      {ready && !failed ? (
        <img
          src={`/api/files/${file.id}/download?inline=1`}
          alt={file.name}
          loading="lazy"
          onError={() => setFailed(true)}
          className="w-full block bg-muted/30 transition-transform duration-500 group-hover:scale-[1.03]"
        />
      ) : (
        <div className="w-full aspect-[4/3] grid place-items-center bg-muted/30">
          <ImageIcon className={`size-8 ${ready ? 'text-muted-foreground/60' : 'text-amber-500/70'}`} />
          {!ready && <span className="absolute bottom-2 left-2"><Badge variant="outline" className={`text-[10px] ${statusColor(file.status)}`}>{file.status}</Badge></span>}
        </div>
      )}

      {/* selecting checkbox */}
      {selecting && (
        <div className="absolute top-2 left-2 z-20" onClick={e => e.stopPropagation()}>
          <Checkbox
            checked={selected}
            onCheckedChange={onToggle}
            aria-label={`Select ${file.name}`}
            className="bg-background/70 backdrop-blur"
          />
        </div>
      )}

      {/* quick star */}
      {mode !== 'trash' && (
        <button
          onClick={e => {
            e.stopPropagation()
            h.onStar()
          }}
          aria-label={file.starred ? `Unstar ${file.name}` : `Star ${file.name}`}
          title={file.starred ? 'Unstar (s)' : 'Star (s)'}
          className={`absolute top-2 right-2 z-20 size-7 rounded-md grid place-items-center backdrop-blur bg-background/50 cursor-pointer transition-all ${
            file.starred ? 'text-amber-400 opacity-100' : 'text-white/90 opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 hover:bg-background/80'
          } focus-visible:opacity-100`}
        >
          <Star className={`size-4 ${file.starred ? 'fill-amber-400 drop-shadow' : ''}`} />
        </button>
      )}

      {/* hover overlay */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/80 via-black/35 to-transparent pt-10 pb-2.5 px-3 opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 transition-opacity duration-200">
        <div className="text-[13px] font-medium text-white truncate" title={file.name}>{file.name}</div>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className="text-[11px] text-white/70">{formatBytes(file.size)}</span>
          {showPath && file.folderPath && (
            <span className="text-[11px] text-amber-300/90 truncate">· {file.folderPath}</span>
          )}
        </div>
      </div>

      {/* quick actions (hover) */}
      <div className="absolute top-2 left-2 z-20 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity" style={selecting ? { display: 'none' } : undefined}>
        {mode === 'trash' ? (
          <>
            <button data-tile-action onClick={h.onRestore} title="Restore" className="size-7 rounded-md grid place-items-center backdrop-blur bg-background/60 text-white/90 hover:text-amber-400 cursor-pointer">
              <RotateCcw className="size-3.5" />
            </button>
            <button data-tile-action onClick={h.onPurge} title="Delete forever" className="size-7 rounded-md grid place-items-center backdrop-blur bg-background/60 text-white/90 hover:text-red-400 cursor-pointer">
              <Trash className="size-3.5" />
            </button>
          </>
        ) : (
          <>
            <button data-tile-action onClick={h.onPreview} title="Preview" className="size-7 rounded-md grid place-items-center backdrop-blur bg-background/60 text-white/90 hover:text-amber-400 cursor-pointer">
              <Eye className="size-3.5" />
            </button>
            {ready && (
              <>
                <button data-tile-action onClick={h.onDownload} title="Download" className="size-7 rounded-md grid place-items-center backdrop-blur bg-background/60 text-white/90 hover:text-amber-400 cursor-pointer">
                  <Download className="size-3.5" />
                </button>
                <button data-tile-action onClick={h.onShare} title="Share settings" className="size-7 rounded-md grid place-items-center backdrop-blur bg-background/60 text-white/90 hover:text-amber-400 cursor-pointer">
                  <Share2 className="size-3.5" />
                </button>
              </>
            )}
          </>
        )}
      </div>

      {/* persistent badges */}
      {!selecting && (file.shareEnabled || file.downloads > 0) && mode !== 'trash' && (
        <div className="absolute top-2 right-10 z-10 flex gap-1 group-hover:opacity-0 transition-opacity">
          {file.shareEnabled && (
            <span className="rounded bg-emerald-600/90 dark:bg-emerald-500/90 px-1.5 py-0.5 text-[10px] font-mono font-medium text-white backdrop-blur" title="Shared publicly">
              shared{file.shareHasPassword ? ' 🔒' : ''}
            </span>
          )}
          {file.downloads > 0 && (
            <span className="rounded-md bg-background/70 px-1.5 py-0.5 text-[10px] font-semibold text-white/90 backdrop-blur" title={`${file.downloads} downloads`}>
              {file.downloads}↓
            </span>
          )}
        </div>
      )}
    </div>
  )
}

function FolderMenu({
  folder,
  onRename,
  onMove,
  onDelete,
}: {
  folder: FolderRow
  onRename: () => void
  onMove: () => void
  onDelete: () => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 shrink-0"
          aria-label={`Folder actions for ${folder.name}`}
          onClick={e => e.stopPropagation()}
        >
          <MoreVertical className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44" onClick={e => e.stopPropagation()}>
        <DropdownMenuItem onClick={onRename}>
          <Pencil className="size-4" /> Edit name & style
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onMove}>
          <FolderInput className="size-4" /> Move to…
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-red-500 focus:text-red-500" onClick={onDelete}>
          <Trash className="size-4" /> Delete folder
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const DRAG_MIME = 'application/x-vs-file-ids'

function hasDragPayload(e: ReactDragEvent): boolean {
  return Array.from(e.dataTransfer.types).includes(DRAG_MIME)
}

function FolderCard({
  folder,
  onOpen,
  onRename,
  onMove,
  onDelete,
  onDropFiles,
}: {
  folder: FolderRow
  onOpen: () => void
  onRename: () => void
  onMove: () => void
  onDelete: () => void
  onDropFiles?: (ids: string[]) => void
}) {
  const [dropActive, setDropActive] = useState(false)
  return (
    <div
      role="button"
      tabIndex={0}
      data-folder-drop={folder.id}
      data-kb="folder"
      data-kb-type="folder"
      data-kb-id={folder.id}
      onClick={onOpen}
      onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && onOpen()}
      onDragOver={e => {
        if (!onDropFiles || !hasDragPayload(e)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        setDropActive(true)
      }}
      onDragLeave={e => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return
        setDropActive(false)
      }}
      onDrop={e => {
        setDropActive(false)
        if (!onDropFiles) return
        const raw = e.dataTransfer.getData(DRAG_MIME)
        if (!raw) return
        e.preventDefault()
        e.stopPropagation()
        try {
          const ids = JSON.parse(raw)
          if (Array.isArray(ids) && ids.length > 0) onDropFiles(ids.filter((x): x is string => typeof x === 'string'))
        } catch {}
      }}
      className={`group relative rounded-lg border bg-card p-4 cursor-pointer transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary focus-visible:border-primary ${
        dropActive
          ? 'border-primary bg-primary/10 ring-2 ring-primary/30 scale-[1.01] shadow-md shadow-primary/10'
          : `border-border/70 hover:border-foreground/20 hover:shadow-xs hover:bg-muted/10 ${folderColor(folder.color).border}`
      }`}
      aria-label={`Open folder ${folder.name}`}
    >
      {dropActive && (
        <div className="absolute inset-0 z-10 rounded-lg bg-primary/5 border-2 border-dashed border-primary grid place-items-center pointer-events-none">
          <span className="flex items-center gap-1.5 text-xs font-semibold text-primary bg-background/95 rounded-md px-3 py-1.5 shadow-md border border-border/80">
            <FolderInput className="size-3.5" /> Drop to move here
          </span>
        </div>
      )}
      <div className="flex items-start gap-3">
        <span
          className={`size-10 rounded-md shrink-0 grid place-items-center border transition-transform duration-300 group-hover:scale-[1.06] ${
            folderColor(folder.color).chip
          }`}
        >
          <Folder className="size-5" />
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium leading-snug truncate" title={folder.name}>
            {folder.name}
          </div>
          <div className="text-[11px] text-muted-foreground mt-1">
            {folder.fileCount} file{folder.fileCount !== 1 ? 's' : ''}
            {folder.totalSize > 0 ? ` · ${formatBytes(folder.totalSize)}` : ''}
          </div>
        </div>
        <FolderMenu folder={folder} onRename={onRename} onMove={onMove} onDelete={onDelete} />
      </div>
      <div className="mt-3 text-[11px] text-muted-foreground/60">created {timeAgo(folder.createdAt)}</div>
    </div>
  )
}

function FolderList({
  folders,
  onOpen,
  onRename,
  onMove,
  onDelete,
  onDropFiles,
}: {
  folders: FolderRow[]
  onOpen: (id: string) => void
  onRename: (f: FolderRow) => void
  onMove: (f: FolderRow) => void
  onDelete: (f: FolderRow) => void
  onDropFiles?: (f: FolderRow, ids: string[]) => void
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <tbody>
            {folders.map(fd => (
              <FolderListRow
                key={fd.id}
                folder={fd}
                onOpen={() => onOpen(fd.id)}
                onRename={() => onRename(fd)}
                onMove={() => onMove(fd)}
                onDelete={() => onDelete(fd)}
                onDropFiles={onDropFiles ? ids => onDropFiles(fd, ids) : undefined}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function FolderListRow({
  folder,
  onOpen,
  onRename,
  onMove,
  onDelete,
  onDropFiles,
}: {
  folder: FolderRow
  onOpen: () => void
  onRename: () => void
  onMove: () => void
  onDelete: () => void
  onDropFiles?: (ids: string[]) => void
}) {
  const [dropActive, setDropActive] = useState(false)
  return (
    <tr
      data-folder-drop={folder.id}
      tabIndex={0}
      data-kb="folder"
      data-kb-type="folder"
      data-kb-id={folder.id}
      onDragOver={e => {
        if (!onDropFiles || !hasDragPayload(e)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        setDropActive(true)
      }}
      onDragLeave={e => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return
        setDropActive(false)
      }}
      onDrop={e => {
        setDropActive(false)
        if (!onDropFiles) return
        const raw = e.dataTransfer.getData(DRAG_MIME)
        if (!raw) return
        e.preventDefault()
        e.stopPropagation()
        try {
          const ids = JSON.parse(raw)
          if (Array.isArray(ids) && ids.length > 0) onDropFiles(ids.filter((x): x is string => typeof x === 'string'))
        } catch {}
      }}
      className={`border-b border-border/40 last:border-0 transition-colors cursor-pointer ${
        dropActive ? 'bg-primary/10 ring-1 ring-inset ring-primary/40' : 'hover:bg-accent/30'
      }`}
      onClick={onOpen}
    >
      <td className="px-4 py-3">
        <div className="flex items-center gap-3 min-w-0">
          <span
            className={`size-10 rounded-md shrink-0 grid place-items-center border transition-colors ${
              dropActive
                ? 'bg-primary/20 text-primary border-primary/50'
                : folderColor(folder.color).chip
            }`}
          >
            <Folder className="size-5" />
          </span>
          <span className="font-medium truncate max-w-[240px]" title={folder.name}>{folder.name}</span>
          {dropActive && (
            <span className="flex items-center gap-1 text-[11px] font-mono text-primary">
              <FolderInput className="size-3" /> drop to move
            </span>
          )}
        </div>
      </td>
      <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">
        {folder.fileCount} file{folder.fileCount !== 1 ? 's' : ''}{folder.totalSize > 0 ? ` · ${formatBytes(folder.totalSize)}` : ''}
      </td>
      <td className="px-4 py-3 text-muted-foreground hidden md:table-cell">created {timeAgo(folder.createdAt)}</td>
      <td className="px-4 py-3 w-10" onClick={e => e.stopPropagation()}>
        <FolderMenu folder={folder} onRename={onRename} onMove={onMove} onDelete={onDelete} />
      </td>
    </tr>
  )
}

function GridCard({
  file,
  mode,
  selecting,
  selected,
  selectedIds,
  showPath,
  onToggle,
  ...h
}: {
  file: FileRow
  mode: FilesMode
  selecting: boolean
  selected: boolean
  selectedIds: string[]
  showPath?: boolean
  onToggle: () => void
} & CardHandlers) {
  const [draggingSelf, setDraggingSelf] = useState(false)
  const canDrag = mode === 'files'
  return (
    <div
      role="button"
      tabIndex={0}
      data-kb="file"
      data-kb-type="file"
      data-kb-id={file.id}
      draggable={canDrag}
      onDoubleClick={() => (mode === 'trash' ? h.onDetails() : h.onPreview())}
      title={mode === 'trash' ? 'Double-click for details' : 'Double-click to preview'}
      onDragStart={e => {
        if (!canDrag) return
        const ids = selecting && selected ? selectedIds : [file.id]
        e.dataTransfer.setData(DRAG_MIME, JSON.stringify(ids))
        e.dataTransfer.effectAllowed = 'move'
        setDraggingSelf(true)
      }}
      onDragEnd={() => setDraggingSelf(false)}
      className={`group relative rounded-lg border bg-card p-4 transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary focus-visible:border-primary ${
        selected ? 'border-primary ring-1 ring-primary/40 bg-primary/[0.03] scale-[0.99]' : 'border-border/70 hover:border-foreground/25 hover:shadow-xs hover:bg-muted/10'
      } ${draggingSelf ? 'opacity-40 scale-[0.98]' : ''}`}
    >
      {selecting && (
        <div className="absolute top-2 left-2 z-10" onClick={e => e.stopPropagation()}>
          <Checkbox checked={selected} onCheckedChange={onToggle} aria-label={`Select ${file.name}`} />
        </div>
      )}
      {/* quick star toggle (files mode, top-right, hover-reveal; stays visible when starred) */}
      {mode !== 'trash' && (
        <button
          onClick={e => {
            e.stopPropagation()
            h.onStar()
          }}
          aria-label={file.starred ? `Unstar ${file.name}` : `Star ${file.name}`}
          title={file.starred ? 'Unstar (s)' : 'Star (s)'}
          className={`absolute top-2 right-10 z-10 size-7 rounded-md grid place-items-center cursor-pointer transition-all ${
            file.starred
              ? 'text-amber-400 opacity-100'
              : 'text-muted-foreground/60 opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 hover:text-amber-400 hover:bg-amber-500/10'
          } focus-visible:opacity-100`}
        >
          <Star className={`size-4 ${file.starred ? 'fill-amber-400' : ''}`} />
        </button>
      )}
      <div className="flex items-start gap-3">
        <Thumb file={file} />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium leading-snug line-clamp-2" title={file.name}>
            {file.name}
          </div>
          <div className="text-[11px] font-mono text-muted-foreground mt-1 tnum">
            {formatBytes(file.size)}
            {mode === 'trash' && file.deletedAt ? ` · trashed ${timeAgo(file.deletedAt)}` : ''}
          </div>
        </div>
        <ActionsMenu file={file} mode={mode} {...h} />
      </div>
      <div className="mt-3 flex items-center flex-wrap gap-1.5">
        {file.status !== 'READY' && mode !== 'trash' ? (
          <Badge variant="outline" className={`text-[10px] ${statusColor(file.status)}`}>{file.status}</Badge>
        ) : (
          <Badge variant="outline" className="text-[10px] font-mono text-muted-foreground/80 border-border/70 bg-muted/20">
            {mode === 'trash' ? formatDate(file.deletedAt || file.createdAt) : timeAgo(file.createdAt)}
          </Badge>
        )}
        {showPath && file.folderPath && (
          <Badge
            variant="outline"
            className="text-[10px] gap-1 border-border/80 bg-muted/40 text-muted-foreground max-w-full font-mono"
            title={`Located in ${file.folderPath}`}
          >
            <Folder className="size-2.5 shrink-0" />
            <span className="truncate max-w-[150px]">{file.folderPath}</span>
          </Badge>
        )}
        {mode !== 'trash' && file.starred && (
          <Badge variant="outline" className="text-[10px] gap-1 border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400 font-medium" title="Starred file">
            <Star className="size-2.5 fill-amber-400 text-amber-400" /> starred
          </Badge>
        )}
        {mode !== 'trash' && file.shareEnabled && (
          <Badge variant="outline" className="text-[10px] gap-1 border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-medium">
            <LinkIcon className="size-2.5" /> shared{file.shareHasPassword ? ' 🔒' : ''}
          </Badge>
        )}
        {mode !== 'trash' && file.shareEnabled && file.shareExpiresAt && new Date(file.shareExpiresAt).getTime() <= Date.now() && (
          <Badge variant="outline" className="text-[10px] gap-1 border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400 font-medium">
            <AlarmClock className="size-2.5" /> expired
          </Badge>
        )}
        {file.downloads > 0 && (
          <Badge variant="outline" className="text-[10px] font-mono text-muted-foreground border-border/70 bg-muted/20 tnum">
            {file.downloads} dl{file.downloads !== 1 ? 's' : ''}
          </Badge>
        )}
      </div>
      {mode !== 'trash' && file.status === 'READY' && (
        <div className="mt-3 flex gap-1.5 opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 transition-opacity">
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1 flex-1" onClick={h.onDownload}>
            <Download className="size-3" /> Download
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1 flex-1" onClick={h.onShare}>
            <Share2 className="size-3" /> Share
          </Button>
        </div>
      )}
      {mode === 'trash' && (
        <div className="mt-3 flex gap-1.5 opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 transition-opacity">
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1 flex-1" onClick={h.onRestore}>
            <RotateCcw className="size-3" /> Restore
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1 flex-1 text-red-500 hover:text-red-500" onClick={h.onPurge}>
            <Trash className="size-3" /> Purge
          </Button>
        </div>
      )}
    </div>
  )
}

function ListView({
  files,
  mode,
  selecting,
  selected,
  showPath,
  onToggle,
  handlersFor,
}: {
  files: FileRow[]
  mode: FilesMode
  selecting: boolean
  selected: Set<string>
  showPath?: boolean
  onToggle: (id: string) => void
  handlersFor: (f: FileRow) => CardHandlers
}) {
  return (
    <div className="rounded-lg border border-border/70 bg-card overflow-hidden shadow-xs">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] table-fixed text-sm">
          <colgroup>
            {selecting && <col className="w-10" />}
            <col />
            <col className="w-28" />
            <col className="w-36" />
            <col className="w-24" />
            <col className="w-28" />
            <col className="w-12" />
          </colgroup>
          <thead>
            <tr className="border-b border-border/70 text-left font-mono text-[11px] uppercase tracking-wider text-muted-foreground/70 bg-muted/20">
              {selecting && <th className="font-medium px-3 py-2.5 w-8"></th>}
              <th className="font-medium px-4 py-2.5">Name</th>
              <th className="font-medium px-4 py-2.5 text-right hidden sm:table-cell">Size</th>
              <th className="font-medium px-4 py-2.5 hidden md:table-cell">{mode === 'trash' ? 'Trashed' : 'Uploaded'}</th>
              <th className="font-medium px-4 py-2.5 text-right hidden lg:table-cell">Downloads</th>
              <th className="font-medium px-4 py-2.5">Status</th>
              <th className="font-medium px-4 py-2.5 w-10"></th>
            </tr>
          </thead>
          <tbody>
            {files.map(f => {
              const h = handlersFor(f)
              return (
                <tr
                  key={f.id}
                  tabIndex={0}
                  data-kb="file"
                  data-kb-type="file"
                  data-kb-id={f.id}
                  className={`h-[60px] border-b border-border/40 last:border-0 transition-colors cursor-pointer focus-visible:outline-none focus-visible:bg-primary/5 ${
                    selected.has(f.id) ? 'bg-primary/[0.04] border-l-2 border-l-primary' : 'hover:bg-muted/20'
                  }`}
                >
                  {selecting && (
                    <td className="px-3 py-3">
                      <Checkbox checked={selected.has(f.id)} onCheckedChange={() => onToggle(f.id)} aria-label={`Select ${f.name}`} />
                    </td>
                  )}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <Thumb file={f} />
                      <div className="min-w-0">
                        <span className="font-medium truncate block max-w-[min(42vw,520px)]" title={f.name}>{f.name}</span>
                        {showPath && f.folderPath && (
                          <span
                            className="mt-0.5 flex items-center gap-1 font-mono text-[10px] text-muted-foreground max-w-[240px]"
                            title={`Located in ${f.folderPath}`}
                          >
                            <Folder className="size-2.5 shrink-0" />
                            <span className="truncate">{f.folderPath}</span>
                          </span>
                        )}
                      </div>
                      {mode !== 'trash' && f.starred && (
                        <span title="Starred file">
                          <Star className="size-3.5 shrink-0 fill-amber-400 text-amber-400" />
                        </span>
                      )}
                      {mode !== 'trash' && f.shareEnabled && (
                        <span title={f.shareExpiresAt && new Date(f.shareExpiresAt).getTime() <= Date.now() ? 'Share link expired' : 'Share link active'}>
                          <LinkIcon className={`size-3.5 shrink-0 ${f.shareExpiresAt && new Date(f.shareExpiresAt).getTime() <= Date.now() ? 'text-rose-500' : 'text-emerald-600 dark:text-emerald-400'}`} />
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-xs text-muted-foreground hidden sm:table-cell tnum whitespace-nowrap">{formatBytes(f.size)}</td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground hidden md:table-cell tnum">
                    {formatDate(mode === 'trash' && f.deletedAt ? f.deletedAt : f.createdAt)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-xs text-muted-foreground hidden lg:table-cell tnum whitespace-nowrap">{f.downloads}</td>
                  <td className="px-4 py-3">
                    <Badge variant="outline" className={`text-[10px] ${mode === 'trash' ? 'border-red-500/40 text-red-500' : statusColor(f.status)}`}>
                      {mode === 'trash' ? 'TRASHED' : f.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <ActionsMenu file={f} mode={mode} {...h} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ActionsMenu({ file, mode, ...h }: { file: FileRow; mode: FilesMode } & CardHandlers) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8 shrink-0" aria-label="File actions">
          <MoreVertical className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {mode === 'trash' ? (
          <>
            <DropdownMenuItem onClick={h.onRestore}>
              <RotateCcw className="size-4" /> Restore
            </DropdownMenuItem>
            <DropdownMenuItem onClick={h.onDetails}>
              <Info className="size-4" /> Details
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-red-500 focus:text-red-500" onClick={h.onPurge}>
              <Trash className="size-4" /> Delete forever
            </DropdownMenuItem>
          </>
        ) : (
          <>
            <DropdownMenuItem onClick={h.onPreview}>
              <Eye className="size-4" /> Preview
            </DropdownMenuItem>
            {file.status === 'READY' && (
              <DropdownMenuItem onClick={h.onDownload}>
                <Download className="size-4" /> Download
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={h.onRename}>
              <Pencil className="size-4" /> Rename
            </DropdownMenuItem>
            {file.status === 'READY' && (
              <DropdownMenuItem onClick={h.onDuplicate}>
                <CopyPlus className="size-4" /> Duplicate
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={h.onStar} className={file.starred ? 'text-amber-500 focus:text-amber-500' : ''}>
              <Star className={`size-4 ${file.starred ? 'fill-amber-400 text-amber-400' : ''}`} />
              {file.starred ? 'Unstar' : 'Star'}
            </DropdownMenuItem>
            {file.status === 'READY' && (
              <>
                <DropdownMenuItem onClick={h.onShare}>
                  <Share2 className="size-4" /> Share settings
                </DropdownMenuItem>
                {file.shareEnabled && (
                  <DropdownMenuItem onClick={h.onCopyLink}>
                    <LinkIcon className="size-4" /> Copy share link
                  </DropdownMenuItem>
                )}
              </>
            )}
            <DropdownMenuItem onClick={h.onMove}>
              <FolderInput className="size-4" /> Move to…
            </DropdownMenuItem>
            <DropdownMenuItem onClick={h.onDetails}>
              <Info className="size-4" /> Details
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-red-500 focus:text-red-500" onClick={h.onDelete}>
              <Trash2 className="size-4" /> Move to trash
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
