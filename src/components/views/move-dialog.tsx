'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { api } from '@/lib/client-api'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { ChevronRight, FolderInput, Home, Loader2 } from 'lucide-react'

export interface TreeFolder {
  id: string
  name: string
  parentId: string | null
  emoji?: string | null
  color?: string | null
}

export interface MoveTarget {
  /** files to move */
  fileIds?: string[]
  /** folder to move (mutually exclusive with fileIds) */
  folderId?: string
  folderName?: string
}

interface TreeNode extends TreeFolder {
  depth: number
  disabled: boolean
}

function buildTree(folders: TreeFolder[], excludeId?: string): TreeNode[] {
  const byParent = new Map<string | null, TreeFolder[]>()
  for (const f of folders) {
    if (f.id === excludeId) continue
    const key = f.parentId || '__root__'
    if (!byParent.has(key)) byParent.set(key, [])
    byParent.get(key)!.push(f)
  }
  const out: TreeNode[] = []
  const walk = (parent: string | null, depth: number, disabledFrom: boolean) => {
    const list = (byParent.get(parent === null ? '__root__' : parent) || []).slice().sort((a, b) => a.name.localeCompare(b.name))
    for (const f of list) {
      const disabled = disabledFrom
      out.push({ ...f, depth, disabled })
      walk(f.id, depth + 1, disabled || f.id === excludeId)
    }
  }
  walk(null, 0, false)
  return out
}

export function MoveDialog({
  target,
  onClose,
  onMoved,
}: {
  target: MoveTarget | null
  onClose: () => void
  onMoved: (destName: string) => void
}) {
  const [selected, setSelected] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const { data, isLoading } = useQuery<{ folders: TreeFolder[] }>({
    queryKey: ['folders-tree'],
    queryFn: () => api('/api/folders/tree'),
    enabled: !!target,
  })

  const excludeId = target?.folderId
  const nodes = useMemo(() => buildTree(data?.folders || [], excludeId), [data, excludeId])

  const destName = selected === null ? 'My Files' : nodes.find(n => n.id === selected)?.name || 'folder'

  const confirm = async () => {
    if (!target) return
    setBusy(true)
    try {
      if (target.fileIds) {
        const r = await api<{ affected: number }>('/api/files/bulk', {
          method: 'POST',
          body: { action: 'move', ids: target.fileIds, folderId: selected },
        })
        toast.success(`${r.affected} file${r.affected !== 1 ? 's' : ''} moved to ${destName}`)
      } else if (target.folderId) {
        await api(`/api/folders/${target.folderId}`, {
          method: 'PATCH',
          body: { parentId: selected },
        })
        toast.success(`"${target.folderName}" moved to ${destName}`)
      }
      onMoved(destName)
      onClose()
    } catch (e: any) {
      toast.error(e?.message || 'Move failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={!!target} onOpenChange={o => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[15px]">
            <FolderInput className="size-4 text-amber-500" />
            Move {target?.fileIds ? `${target.fileIds.length} file${target.fileIds.length !== 1 ? 's' : ''}` : target ? `"${target.folderName}"` : ''}
          </DialogTitle>
          <DialogDescription className="text-[13px]">Choose a destination folder. Items keep their share links when moved.</DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <ScrollArea className="h-64 rounded-lg border border-border/60">
            <div className="p-1.5">
              {/* Home root */}
              <button
                onClick={() => setSelected(null)}
                className={cn(
                  'w-full flex items-center gap-2 rounded-md px-2.5 py-2 text-sm text-left transition-colors cursor-pointer',
                  selected === null ? 'bg-amber-500/12 text-amber-600 dark:text-amber-400 font-medium' : 'hover:bg-accent'
                )}
              >
                <Home className="size-4 shrink-0 text-amber-500" />
                My Files
              </button>
              {nodes.map(n => (
                <button
                  key={n.id}
                  disabled={n.disabled}
                  onClick={() => setSelected(n.id)}
                  style={{ paddingLeft: `${(n.depth + 1) * 18 + 10}px` }}
                  className={cn(
                    'w-full flex items-center gap-2 rounded-md px-2.5 py-2 text-sm text-left transition-colors',
                    n.disabled
                      ? 'opacity-35 cursor-not-allowed'
                      : cn(
                          'cursor-pointer hover:bg-accent',
                          selected === n.id && 'bg-amber-500/12 text-amber-600 dark:text-amber-400 font-medium'
                        )
                  )}
                >
                  <ChevronRight className="size-3 shrink-0 text-muted-foreground/50" />
                  {n.emoji ? <span className="text-sm leading-none shrink-0">{n.emoji}</span> : null}
                  <span className="truncate">{n.name}</span>
                </button>
              ))}
              {nodes.length === 0 && (
                <div className="px-3 py-4 text-xs text-muted-foreground text-center">No subfolders yet.</div>
              )}
            </div>
          </ScrollArea>
        )}

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={confirm} disabled={busy || isLoading} className="gap-1.5">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <FolderInput className="size-4" />}
            Move to {destName}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
