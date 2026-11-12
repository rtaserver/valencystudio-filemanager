'use client'

import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/client-api'
import { toast } from 'sonner'
import { Loader2, Pencil } from 'lucide-react'
import type { FileRow } from '@/components/views/files-view'

export function RenameDialog({ file, onClose, onRenamed }: { file: FileRow | null; onClose: () => void; onRenamed: () => void }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (file) setName(file.name)
  }, [file])

  if (!file) return null

  const save = async () => {
    if (!name.trim()) {
      toast.error('File name cannot be empty.')
      return
    }
    setBusy(true)
    try {
      await api(`/api/files/${file.id}`, { method: 'PATCH', body: { name: name.trim() } })
      toast.success('File renamed')
      onRenamed()
      onClose()
    } catch (e: any) {
      toast.error(e?.message || 'Rename failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={!!file} onOpenChange={o => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[15px]">
            <Pencil className="size-4 text-amber-500" /> Rename file
          </DialogTitle>
          <DialogDescription className="text-[13px]">Choose a new name. Share links keep working.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Input
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && save()}
            autoFocus
            onFocus={e => {
              // select base name without extension
              const dot = e.target.value.lastIndexOf('.')
              e.target.setSelectionRange(0, dot > 0 ? dot : e.target.value.length)
            }}
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
            <Button size="sm" onClick={save} disabled={busy || !name.trim() || name === file.name} className="gap-1.5">
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Pencil className="size-4" />} Rename
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
