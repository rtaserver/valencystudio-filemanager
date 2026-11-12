'use client'

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Kbd } from '@/components/ui/kbd'

const GROUPS: { title: string; items: { keys: string[]; desc: string }[] }[] = [
  {
    title: 'Navigation',
    items: [
      { keys: ['⌘', 'K'], desc: 'Open the command palette (files, folders & actions)' },
      { keys: ['G'], desc: 'Go to… — press G, then one of the keys below' },
      { keys: ['G', 'F'], desc: 'Go to My Files' },
      { keys: ['G', 'S'], desc: 'Go to Starred' },
      { keys: ['G', 'H'], desc: 'Go to Shared Links' },
      { keys: ['G', 'T'], desc: 'Go to Trash' },
      { keys: ['G', 'P'], desc: 'Go to Account Settings' },
      { keys: ['G', 'A'], desc: 'Go to Admin Panel (admins)' },
    ],
  },
  {
    title: 'File browser',
    items: [
      { keys: ['/'], desc: 'Focus the search box' },
      { keys: ['↑', '↓', '←', '→'], desc: 'Move focus between cards and rows' },
      { keys: ['Enter'], desc: 'Preview the focused file / open the focused folder' },
      { keys: ['Space'], desc: 'Select or deselect the focused file' },
      { keys: ['S'], desc: 'Star / unstar the focused file' },
      { keys: ['Delete'], desc: 'Move focused file to trash (purge in Trash view)' },
      { keys: ['Esc'], desc: 'Clear the selection / close dialogs' },
      { keys: ['?'], desc: 'Show this shortcut cheat-sheet' },
    ],
  },
]

export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[15px]">
            <Kbd className="text-sm">?</Kbd> Keyboard shortcuts
          </DialogTitle>
          <DialogDescription className="text-[13px]">
            Work anywhere in the dashboard — except while typing in a text field.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-5 max-h-[60vh] overflow-y-auto pr-1">
          {GROUPS.map(g => (
            <div key={g.title}>
              <div className="micro-label mb-2">{g.title}</div>
              <div className="space-y-1.5">
                {g.items.map((it, i) => (
                  <div key={i} className="flex items-center gap-3 rounded-md px-2.5 py-1.5 hover:bg-accent/40 transition-colors">
                    <div className="flex items-center gap-1 min-w-[92px]">
                      {it.keys.map((k, j) => (
                        <span key={j} className="flex items-center gap-1">
                          {j > 0 && <span className="text-[10px] text-muted-foreground/60">then</span>}
                          <Kbd>{k}</Kbd>
                        </span>
                      ))}
                    </div>
                    <span className="text-[13px] text-muted-foreground">{it.desc}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground/70 border-t border-border/40 pt-3">
          Tip: drag on empty space in the file grid to rubber-band select, and drop files onto any folder card to move them.
        </p>
      </DialogContent>
    </Dialog>
  )
}
