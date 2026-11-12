'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { Progress } from '@/components/ui/progress'
import { Button } from '@/components/ui/button'
import { useUploadStore, UploadItem } from '@/lib/uploader'
import { formatBytes, fileKind, kindColor } from '@/lib/format'
import {
  ChevronDown,
  ChevronUp,
  UploadCloud,
  CheckCircle2,
  XCircle,
  Loader2,
  X,
  RotateCcw,
  Trash2,
} from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

function ItemRow({ item }: { item: UploadItem }) {
  const cancel = useUploadStore(s => s.cancel)
  const retry = useUploadStore(s => s.retry)
  const removeItem = useUploadStore(s => s.removeItem)
  const kind = fileKind(item.mimeType, item.name)

  const statusIcon = () => {
    switch (item.status) {
      case 'done':
        return <CheckCircle2 className="size-4.5 text-emerald-600 dark:text-emerald-400 shrink-0" strokeWidth={1.9} />
      case 'error':
        return <XCircle className="size-4.5 text-red-500 shrink-0" strokeWidth={1.9} />
      case 'canceled':
        return <XCircle className="size-4.5 text-muted-foreground/70 shrink-0" strokeWidth={1.9} />
      case 'queued':
        return <Loader2 className="size-4.5 text-muted-foreground shrink-0" strokeWidth={1.9} />
      default:
        return <Loader2 className="size-4.5 text-amber-500 shrink-0 animate-spin" strokeWidth={1.9} />
    }
  }

  const statusText = () => {
    switch (item.status) {
      case 'queued': return 'Queued…'
      case 'initializing': return 'Initializing stream…'
      case 'uploading': return `Streaming · ${formatBytes(item.speed, 0)}/s`
      case 'finalizing': return 'Indexing in cloud vault…'
      case 'done': return `Completed · ${formatBytes(item.size)}`
      case 'error': return item.error || 'Failed'
      case 'canceled': return 'Canceled'
    }
  }

  return (
    <motion.div layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }} className="rounded-lg border border-border/60 bg-card p-3">
      <div className="flex items-center gap-2.5">
        {statusIcon()}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`size-5 shrink-0 rounded grid place-items-center text-[9px] font-bold ${kindColor(kind)}`}>
              {kind === 'image' ? 'I' : kind === 'video' ? 'V' : kind === 'audio' ? 'A' : kind === 'pdf' ? 'P' : kind === 'archive' ? 'Z' : 'F'}
            </span>
            <span className="text-[13px] font-medium truncate">{item.name}</span>
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1.5 tnum">
            {item.status === 'uploading' && <span className="font-mono text-amber-500">{Math.round(item.progress * 100)}%</span>}
            <span className="truncate">{statusText()}</span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {item.status === 'uploading' && (
            <Button variant="ghost" size="icon" className="size-7" onClick={() => cancel(item.key)} aria-label="Cancel upload">
              <X className="size-3.5" />
            </Button>
          )}
          {item.status === 'error' && (
            <Button variant="ghost" size="icon" className="size-7" onClick={() => retry(item.key)} aria-label="Retry upload">
              <RotateCcw className="size-3.5" />
            </Button>
          )}
          {['done', 'canceled', 'error'].includes(item.status) && (
            <Button variant="ghost" size="icon" className="size-7" onClick={() => removeItem(item.key)} aria-label="Remove from list">
              <Trash2 className="size-3.5" />
            </Button>
          )}
        </div>
      </div>
      {['uploading', 'initializing', 'finalizing'].includes(item.status) && (
        <Progress value={item.progress * 100} className="h-1.5 mt-2" />
      )}
    </motion.div>
  )
}

export function UploadPanel() {
  const items = useUploadStore(s => s.items)
  const clearFinished = useUploadStore(s => s.clearFinished)
  const [collapsed, setCollapsed] = useState(false)

  const active = items.filter(i => ['queued', 'initializing', 'uploading', 'finalizing'].includes(i.status))
  const finished = items.filter(i => ['done', 'canceled', 'error'].includes(i.status))
  const visible = items.length > 0

  if (!visible) return null

  return (
    <div className="fixed bottom-4 right-4 z-40 w-[min(92vw,380px)]">
      <div className="rounded-lg border border-border/70 bg-background/95 backdrop-blur shadow-lg overflow-hidden">
        <button
          className="w-full flex items-center gap-2.5 px-4 py-3 border-b border-border/50 hover:bg-accent/40 transition-colors cursor-pointer"
          onClick={() => setCollapsed(c => !c)}
        >
          <UploadCloud className="size-4.5 text-amber-500" />
          <span className="text-sm font-semibold flex-1 text-left">
            Uploads
            {active.length > 0 && (
              <span className="ml-2 text-[11px] font-medium text-amber-500 tnum">{active.length} active</span>
            )}
            {finished.length > 0 && active.length === 0 && (
              <span className="ml-2 text-[11px] font-medium text-muted-foreground tnum">{finished.length} finished</span>
            )}
          </span>
          {collapsed ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
        </button>

        <AnimatePresence initial={false}>
          {!collapsed && (
            <motion.div
              initial={{ height: 0 }}
              animate={{ height: 'auto' }}
              exit={{ height: 0 }}
              className="overflow-hidden"
            >
              <div className="p-2.5 space-y-2 max-h-[320px] overflow-y-auto">
                {items.map(item => (
                  <ItemRow key={item.key} item={item} />
                ))}
              </div>
              {finished.length > 0 && (
                <div className="px-3 pb-3">
                  <Button variant="outline" size="sm" className="w-full text-xs" onClick={clearFinished}>
                    Clear finished
                  </Button>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
