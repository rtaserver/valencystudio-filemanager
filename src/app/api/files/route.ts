import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/auth'
import { publicFile, purgeExpiredTrash, sweepStalePending } from '@/lib/files'
import { jsonError } from '@/lib/api-helpers'
import { ownedFolder } from '@/lib/folders'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const TYPE_FILTERS: Record<string, any> = {
  image: { mimeType: { startsWith: 'image/' } },
  video: { mimeType: { startsWith: 'video/' } },
  audio: { mimeType: { startsWith: 'audio/' } },
  archive: {
    OR: [
      { mimeType: { contains: 'zip' } },
      { mimeType: { contains: 'compressed' } },
      { name: { endsWith: '.zip' } }, { name: { endsWith: '.rar' } }, { name: { endsWith: '.7z' } },
      { name: { endsWith: '.tar' } }, { name: { endsWith: '.gz' } }, { name: { endsWith: '.iso' } },
      { name: { endsWith: '.apk' } },
    ],
  },
  doc: {
    OR: [
      { name: { endsWith: '.pdf' } }, { name: { endsWith: '.doc' } }, { name: { endsWith: '.docx' } },
      { name: { endsWith: '.odt' } }, { name: { endsWith: '.rtf' } }, { name: { endsWith: '.ppt' } },
      { name: { endsWith: '.pptx' } }, { name: { endsWith: '.xls' } }, { name: { endsWith: '.xlsx' } },
      { name: { endsWith: '.ods' } }, { name: { endsWith: '.csv' } },
    ],
  },
  code: {
    OR: [
      { name: { endsWith: '.js' } }, { name: { endsWith: '.ts' } }, { name: { endsWith: '.tsx' } },
      { name: { endsWith: '.jsx' } }, { name: { endsWith: '.py' } }, { name: { endsWith: '.go' } },
      { name: { endsWith: '.rs' } }, { name: { endsWith: '.java' } }, { name: { endsWith: '.c' } },
      { name: { endsWith: '.cpp' } }, { name: { endsWith: '.css' } }, { name: { endsWith: '.html' } },
      { name: { endsWith: '.json' } }, { name: { endsWith: '.yml' } }, { name: { endsWith: '.yaml' } },
      { name: { endsWith: '.sh' } }, { name: { endsWith: '.sql' } }, { name: { endsWith: '.php' } },
      { name: { endsWith: '.md' } }, { name: { endsWith: '.txt' } }, { name: { endsWith: '.log' } },
    ],
  },
}

export async function GET(req: Request) {
  const session = await getSessionUser(req)
  if (!session) return jsonError('Unauthorized', 401)

  // lazily purge trash older than retention window + sweep abandoned uploads (both throttled)
  purgeExpiredTrash().catch(() => {})
  sweepStalePending().catch(() => {})

  const url = new URL(req.url)
  const search = (url.searchParams.get('search') || '').trim().slice(0, 100)
  const sort = url.searchParams.get('sort') || 'newest'
  const status = url.searchParams.get('status') || 'all'
  const shared = url.searchParams.get('shared') === '1'
  const trash = url.searchParams.get('trash') === '1'
  const type = url.searchParams.get('type') || 'all'
  const starred = url.searchParams.get('starred') === '1'
  const folderParam = url.searchParams.get('folder') // 'root' | <folderId> | null(all folders)

  const where: any = { ownerId: session.id }
  where.deletedAt = trash ? { not: null } : null
  if (search) where.name = { contains: search }
  if (shared) where.shareEnabled = true
  if (starred) where.starred = true

  // folder scoping: only for the normal files view, ignored while searching (global search) or in trash/shared/starred
  if (!trash && !shared && !starred && !search && folderParam) {
    if (folderParam === 'root') {
      where.folderId = null
    } else {
      const f = await ownedFolder(folderParam, session.id)
      if (!f) return jsonError('Folder not found.', 404)
      where.folderId = f.id
    }
  }
  if (status === 'ready') where.status = 'READY'
  if (status === 'uploading') where.status = { in: ['PENDING', 'FAILED'] }
  if (!trash && TYPE_FILTERS[type]) {
    if (where.name && where.name.contains !== undefined) {
      const nameCond = where.name
      delete where.name
      where.AND = [{ name: nameCond }, TYPE_FILTERS[type]]
    } else {
      Object.assign(where, TYPE_FILTERS[type])
    }
  }

  const orderBy: any[] =
    trash ? [{ deletedAt: 'desc' }] :
    sort === 'oldest' ? [{ createdAt: 'asc' }] :
    sort === 'largest' ? [{ size: 'desc' }] :
    sort === 'smallest' ? [{ size: 'asc' }] :
    sort === 'name' ? [{ name: 'asc' }] :
    sort === 'downloads' ? [{ downloads: 'desc' }] :
    sort === 'starred' ? [{ starred: 'desc' }, { createdAt: 'desc' }] :
    [{ createdAt: 'desc' }]

  const files = await db.file.findMany({ where, orderBy, take: 500 })
  const rows = files.map(publicFile)

  // while searching globally, attach the folder location of each hit ("My Files / Photos")
  if (search && files.some(f => f.folderId)) {
    const folders = await db.folder.findMany({
      where: { ownerId: session.id },
      select: { id: true, name: true, parentId: true },
    })
    const byId = new Map(folders.map(f => [f.id, f]))
    const pathOf = (fid: string, guard = 0): string => {
      const f = byId.get(fid)
      if (!f || guard > 100) return ''
      const parent = f.parentId ? pathOf(f.parentId, guard + 1) : ''
      return parent ? `${parent} / ${f.name}` : f.name
    }
    for (const row of rows) {
      if (row.folderId) (row as any).folderPath = pathOf(row.folderId)
    }
  }

  return Response.json({ files: rows })
}
