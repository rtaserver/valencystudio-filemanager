'use client'

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { formatBytes, formatDate, fileKind, isPreviewable } from '@/lib/format'
import { downloadFile } from '@/lib/client-api'
import { Download, FileWarning } from 'lucide-react'
import type { FileRow } from '@/components/views/files-view'

export function PreviewDialog({ file, onClose }: { file: FileRow | null; onClose: () => void }) {
  if (!file) return null
  const kind = fileKind(file.mimeType, file.name)
  const previewable = isPreviewable(file.mimeType, file.name) && kind !== 'text' && kind !== 'code'
  const src = `/api/files/${file.id}/download?inline=1`

  return (
    <Dialog open={!!file} onOpenChange={o => !o && onClose()}>
      <DialogContent className="sm:max-w-3xl max-h-[88vh] overflow-hidden flex flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle className="truncate pr-6 text-[15px]" title={file.name}>{file.name}</DialogTitle>
          <div className="text-[11px] font-mono tnum text-muted-foreground font-normal">
            {formatBytes(file.size)} · {file.mimeType} · {formatDate(file.createdAt)} ·{' '}
            {file.partCount === 1 ? 'Encrypted Cloud Document' : `${file.partCount} encrypted blocks`}
          </div>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-auto rounded-lg border border-border/60 bg-muted/30 grid place-items-center">
          {!previewable ? (
            <div className="p-10 text-center">
              <FileWarning className="mx-auto size-10 text-muted-foreground/50" />
              <p className="mt-3 text-sm text-muted-foreground max-w-xs">
                No inline preview for this file type. Download it to open on your device.
              </p>
              <Button className="mt-4 gap-2" onClick={() => downloadFile(`/api/files/${file.id}/download`)}>
                <Download className="size-4" /> Download file
              </Button>
            </div>
          ) : kind === 'image' ? (
            <img src={src} alt={file.name} className="max-h-[60vh] w-auto object-contain" />
          ) : kind === 'video' ? (
            <video src={src} controls className="max-h-[60vh] w-full" preload="metadata" />
          ) : kind === 'audio' ? (
            <div className="p-8 w-full max-w-md">
              <audio src={src} controls className="w-full" preload="metadata" />
            </div>
          ) : kind === 'pdf' ? (
            <iframe src={src} title={file.name} className="w-full h-[60vh]" />
          ) : (
            <iframe src={src} title={file.name} className="w-full h-[60vh] bg-white" />
          )}
        </div>

        {previewable && (
          <div className="shrink-0 pt-3 flex justify-end">
            <Button variant="outline" size="sm" className="gap-2" onClick={() => downloadFile(`/api/files/${file.id}/download`)}>
              <Download className="size-3.5" /> Download original
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
