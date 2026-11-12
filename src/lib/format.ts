import { format, formatDistanceToNow } from 'date-fns'

export function formatBytes(bytes: number, decimals = 1): string {
  if (bytes === 0) return '0 B'
  if (bytes < 0) return '—'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1)
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(decimals))} ${sizes[i]}`
}

export function formatDate(d: string | Date): string {
  return format(new Date(d), 'MMM d, yyyy HH:mm')
}

export function timeAgo(d: string | Date): string {
  return formatDistanceToNow(new Date(d), { addSuffix: true })
}

export type FileKind = 'image' | 'video' | 'audio' | 'pdf' | 'archive' | 'code' | 'text' | 'doc' | 'sheet' | 'other'

export function fileKind(mime: string, name: string): FileKind {
  const m = (mime || '').toLowerCase()
  const ext = name.toLowerCase().split('.').pop() || ''
  if (m.startsWith('image/')) return 'image'
  if (m.startsWith('video/')) return 'video'
  if (m.startsWith('audio/')) return 'audio'
  if (m === 'application/pdf' || ext === 'pdf') return 'pdf'
  if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'iso', 'apk'].includes(ext) || m.includes('zip') || m.includes('compressed')) return 'archive'
  if (['js', 'ts', 'tsx', 'jsx', 'py', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'css', 'html', 'json', 'yml', 'yaml', 'sh', 'sql', 'php'].includes(ext)) return 'code'
  if (m.startsWith('text/') || ['txt', 'md', 'log', 'csv'].includes(ext)) return 'text'
  if (['doc', 'docx', 'odt', 'rtf'].includes(ext)) return 'doc'
  if (['xls', 'xlsx', 'ods'].includes(ext)) return 'sheet'
  return 'other'
}

export function isPreviewable(mime: string, name: string): boolean {
  const kind = fileKind(mime, name)
  return ['image', 'video', 'audio', 'pdf', 'text'].includes(kind)
}

/** Subtle, high-craft file kind badge styling — clear visual scanability without noisy neon tones. */
export function kindColor(kind: FileKind): string {
  switch (kind) {
    case 'image':
      return 'text-purple-600 dark:text-purple-400 bg-purple-500/10 border border-purple-500/20'
    case 'video':
      return 'text-sky-600 dark:text-sky-400 bg-sky-500/10 border border-sky-500/20'
    case 'audio':
      return 'text-pink-600 dark:text-pink-400 bg-pink-500/10 border border-pink-500/20'
    case 'pdf':
      return 'text-rose-600 dark:text-rose-400 bg-rose-500/10 border border-rose-500/20'
    case 'archive':
      return 'text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20'
    case 'code':
      return 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/20'
    case 'text':
    case 'doc':
      return 'text-blue-600 dark:text-blue-400 bg-blue-500/10 border border-blue-500/20'
    case 'sheet':
      return 'text-teal-600 dark:text-teal-400 bg-teal-500/10 border border-teal-500/20'
    default:
      return 'text-zinc-600 dark:text-zinc-400 bg-zinc-500/10 border border-zinc-500/20'
  }
}

/** Semantic status colors — the only place green/red appear as states. */
export function statusColor(status: string): string {
  switch (status) {
    case 'READY': return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/25'
    case 'PENDING': return 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/25'
    case 'FAILED': return 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/25'
    default: return 'bg-zinc-500/10 text-zinc-500 border-zinc-500/25'
  }
}

export function actionLabel(action: string): string {
  const map: Record<string, string> = {
    AUTH_LOGIN: 'Signed in',
    AUTH_REGISTER: 'Registered',
    AUTH_LOGOUT: 'Signed out',
    AUTH_PROFILE_UPDATE: 'Profile updated',
    FILE_UPLOAD: 'Uploaded',
    FILE_UPLOAD_START: 'Upload started',
    FILE_DELETE: 'Deleted',
    FILE_TRASH: 'Moved to trash',
    FILE_RESTORE: 'Restored from trash',
    FILE_RENAME: 'Renamed',
    FILE_MOVE: 'Moved',
    FILE_STAR: 'Starred',
    FILE_UNSTAR: 'Unstarred',
    FILE_DUPLICATE: 'Duplicated',
    FILE_SHARE: 'Share updated',
    FILE_DOWNLOAD: 'Download',
    FILE_LINK_CREATE: 'Expiring link created',
    FILE_LINK_REVOKE: 'Expiring link revoked',
    FOLDER_CREATE: 'Folder created',
    FOLDER_UPDATE: 'Folder updated',
    FOLDER_DELETE: 'Folder deleted',
    API_TOKEN_CREATE: 'API token created',
    API_TOKEN_REVOKE: 'API token revoked',
    ADMIN_USER_UPDATE: 'User updated',
    ADMIN_USER_DELETE: 'User deleted',
    ADMIN_SETTINGS_UPDATE: 'Settings updated',
    ADMIN_TELEGRAM_TEST: 'Cloud storage test',
  }
  return map[action] || action
}
