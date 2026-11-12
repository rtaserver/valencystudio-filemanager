import { readPartBuffer } from '@/lib/storage'
import { streamFromTelethon } from '@/lib/telethon'
import { Readable } from 'stream'

export interface FileMeta {
  name: string
  mimeType: string
  size: number
  parts: string // JSON StoredPart[]
}

export function parseParts(json: string): { ref: string; size: number }[] {
  try {
    const arr = JSON.parse(json)
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

function contentDisposition(filename: string, mode: 'attachment' | 'inline'): string {
  const fallback = filename.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, "'")
  return `${mode}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}

/** Yield exact byte ranges across all parts */
async function* iterateRange(parts: { ref: string; size: number }[], start: number, end: number): AsyncGenerator<Uint8Array> {
  let offset = 0
  for (const part of parts) {
    const partStart = offset
    const partEnd = offset + part.size - 1
    offset += part.size
    if (partEnd < start) continue
    if (partStart > end) break
    if (part.size === 0) continue
    const buf = await readPartBuffer(part.ref)
    const s = Math.max(start - partStart, 0)
    const e = Math.min(end - partStart, part.size - 1)
    if (e >= s) yield buf.subarray(s, e + 1)
  }
}

function streamFromGenerator(gen: AsyncGenerator<Uint8Array>): ReadableStream<Uint8Array> {
  const iterator = gen[Symbol.asyncIterator]()
  return new ReadableStream({
    async pull(controller) {
      try {
        const { value, done } = await iterator.next()
        if (done) {
          controller.close()
        } else {
          controller.enqueue(value)
        }
      } catch (err) {
        controller.error(err instanceof Error ? err : new Error('Stream failed'))
      }
    },
    async cancel() {
      await iterator.return?.(undefined as never)
    },
  })
}

/**
 * Build a full HTTP file response with Range support (byte ranges mapped across
 * multi-part storage). Used for downloads and inline media previews.
 */
export async function buildFileResponse(req: Request, file: FileMeta, mode: 'attachment' | 'inline'): Promise<Response> {
  const parts = parseParts(file.parts)
  const total = file.size
  const baseHeaders: Record<string, string> = {
    'Content-Type': file.mimeType || 'application/octet-stream',
    'Content-Disposition': contentDisposition(file.name, mode),
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=3600',
  }

  if (total === 0) {
    return new Response(new Uint8Array(0), { status: 200, headers: { ...baseHeaders, 'Content-Length': '0' } })
  }

  // Direct streaming route for Telethon-stored single documents
  if (parts.length === 1 && parts[0]?.ref?.startsWith('telethon:')) {
    const messageId = parseInt(parts[0].ref.slice('telethon:'.length))
    const rangeHeader = req.headers.get('range')
    if (rangeHeader) {
      const m = /bytes=(\d*)-(\d*)/.exec(rangeHeader)
      if (m && (m[1] !== '' || m[2] !== '')) {
        let start: number
        let end: number
        if (m[1] === '') {
          const suffix = parseInt(m[2])
          start = Math.max(0, total - suffix)
          end = total - 1
        } else {
          start = parseInt(m[1])
          end = m[2] === '' ? total - 1 : Math.min(parseInt(m[2]), total - 1)
        }
        if (start > end || start >= total) {
          return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${total}` } })
        }
        const telethonRes = await streamFromTelethon(messageId, `bytes=${start}-${end}`)
        if (!telethonRes.ok || !telethonRes.body) {
          return new Response('Telethon download failed', { status: telethonRes.status || 500 })
        }
        return new Response(telethonRes.body, {
          status: 206,
          headers: {
            ...baseHeaders,
            'Content-Range': `bytes ${start}-${end}/${total}`,
            'Content-Length': String(end - start + 1),
          },
        })
      }
    }

    const telethonRes = await streamFromTelethon(messageId)
    if (!telethonRes.ok || !telethonRes.body) {
      return new Response('Telethon download failed', { status: telethonRes.status || 500 })
    }
    return new Response(telethonRes.body, {
      status: 200,
      headers: { ...baseHeaders, 'Content-Length': String(total) },
    })
  }

  const rangeHeader = req.headers.get('range')
  if (rangeHeader) {
    const m = /bytes=(\d*)-(\d*)/.exec(rangeHeader)
    if (m && (m[1] !== '' || m[2] !== '')) {
      let start: number
      let end: number
      if (m[1] === '') {
        // suffix range: last N bytes
        const suffix = parseInt(m[2])
        start = Math.max(0, total - suffix)
        end = total - 1
      } else {
        start = parseInt(m[1])
        end = m[2] === '' ? total - 1 : Math.min(parseInt(m[2]), total - 1)
      }
      if (start > end || start >= total) {
        return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${total}` } })
      }
      return new Response(streamFromGenerator(iterateRange(parts, start, end)), {
        status: 206,
        headers: {
          ...baseHeaders,
          'Content-Range': `bytes ${start}-${end}/${total}`,
          'Content-Length': String(end - start + 1),
        },
      })
    }
  }

  return new Response(streamFromGenerator(iterateRange(parts, 0, total - 1)), {
    status: 200,
    headers: { ...baseHeaders, 'Content-Length': String(total) },
  })
}

/** Node stream helper (kept for future use, e.g. zip streaming) */
export function nodeToWeb(stream: Readable): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      stream.on('data', (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)))
      stream.on('end', () => controller.close())
      stream.on('error', err => controller.error(err))
    },
    cancel() {
      stream.destroy()
    },
  })
}
