/**
 * Shared folder accent palette — used by folder cards, sidebar tree,
 * breadcrumbs and the folder create/edit dialog.
 * Keys are stored on Folder.color; `null` = default amber.
 */
export interface FolderColorDef {
  key: string
  label: string
  /** solid hex for dots / swatches */
  hex: string
  /** tailwind classes for the icon chip */
  chip: string
  /** tailwind text color class (static, for standalone icons) */
  text: string
  /** tailwind classes for the folder card border hover */
  border: string
  /** tailwind classes for active states (tree highlight, breadcrumb pill) */
  active: string
}

export const FOLDER_COLORS: FolderColorDef[] = [
  {
    key: 'amber',
    label: 'Amber',
    hex: '#d97706',
    chip: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
    text: 'text-amber-600 dark:text-amber-400',
    border: 'hover:border-amber-500/40 hover:shadow-amber-500/5',
    active: 'border-amber-500/50 bg-amber-500/10 text-amber-600 dark:text-amber-400',
  },
  {
    key: 'emerald',
    label: 'Emerald',
    hex: '#059669',
    chip: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
    text: 'text-emerald-600 dark:text-emerald-400',
    border: 'hover:border-emerald-500/40 hover:shadow-emerald-500/5',
    active: 'border-emerald-500/50 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  },
  {
    key: 'rose',
    label: 'Rose',
    hex: '#db5469',
    chip: 'bg-rose-500/10 text-rose-500 border-rose-500/20',
    text: 'text-rose-600 dark:text-rose-400',
    border: 'hover:border-rose-500/40 hover:shadow-rose-500/5',
    active: 'border-rose-500/50 bg-rose-500/10 text-rose-600 dark:text-rose-400',
  },
  {
    key: 'violet',
    label: 'Violet',
    hex: '#9d7ad6',
    chip: 'bg-violet-500/10 text-violet-500 border-violet-500/20',
    text: 'text-violet-600 dark:text-violet-400',
    border: 'hover:border-violet-500/40 hover:shadow-violet-500/5',
    active: 'border-violet-500/50 bg-violet-500/10 text-violet-600 dark:text-violet-400',
  },
  {
    key: 'cyan',
    label: 'Cyan',
    hex: '#0891b2',
    chip: 'bg-cyan-500/10 text-cyan-500 border-cyan-500/20',
    text: 'text-cyan-600 dark:text-cyan-400',
    border: 'hover:border-cyan-500/40 hover:shadow-cyan-500/5',
    active: 'border-cyan-500/50 bg-cyan-500/10 text-cyan-600 dark:text-cyan-400',
  },
  {
    key: 'orange',
    label: 'Orange',
    hex: '#e0762f',
    chip: 'bg-orange-500/10 text-orange-500 border-orange-500/20',
    text: 'text-orange-600 dark:text-orange-400',
    border: 'hover:border-orange-500/40 hover:shadow-orange-500/5',
    active: 'border-orange-500/50 bg-orange-500/10 text-orange-600 dark:text-orange-400',
  },
  {
    key: 'teal',
    label: 'Teal',
    hex: '#0d9488',
    chip: 'bg-teal-500/10 text-teal-500 border-teal-500/20',
    text: 'text-teal-600 dark:text-teal-400',
    border: 'hover:border-teal-500/40 hover:shadow-teal-500/5',
    active: 'border-teal-500/50 bg-teal-500/10 text-teal-600 dark:text-teal-400',
  },
  {
    key: 'lime',
    label: 'Lime',
    hex: '#7c9f3f',
    chip: 'bg-lime-500/10 text-lime-500 border-lime-500/20',
    text: 'text-lime-600 dark:text-lime-400',
    border: 'hover:border-lime-500/40 hover:shadow-lime-500/5',
    active: 'border-lime-500/50 bg-lime-500/10 text-lime-600 dark:text-lime-400',
  },
]

const BY_KEY = new Map(FOLDER_COLORS.map(c => [c.key, c]))
export const FOLDER_COLOR_KEYS = FOLDER_COLORS.map(c => c.key)

export function folderColor(key?: string | null): FolderColorDef {
  return (key && BY_KEY.get(key)) || FOLDER_COLORS[0]
}

/** Quick-pick icon glyphs for folders (null key = no emoji) — kept for data compat, no longer surfaced in UI */
export const FOLDER_EMOJIS = [
  '', '📁', '📂', '🗂️', '🖼️', '🎬', '🎵', '🎧',
  '📦', '📄', '📚', '💾', '🔧', '⚙️', '🚀', '🏠',
  '💼', '🎓', '🌱', '⭐', '🔥', '💡', '🛠️', '❤️',
]
void FOLDER_EMOJIS

/** Server-side validation for the color key */
export function isValidFolderColor(key: unknown): key is string {
  return typeof key === 'string' && FOLDER_COLOR_KEYS.includes(key)
}

/** Server-side validation for emoji (short string, no control chars) */
export function sanitizeFolderEmoji(emoji: unknown): string | null {
  if (typeof emoji !== 'string') return null
  const trimmed = emoji.trim()
  if (!trimmed) return null
  if (trimmed.length > 16) return null
  // strip control characters / weird whitespace
  return trimmed.replace(/[\u0000-\u001f\u007f]/g, '') || null
}
