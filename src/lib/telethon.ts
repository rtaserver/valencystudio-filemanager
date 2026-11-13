import { getSettings } from '@/lib/settings'

export async function isTelethonHealthy(): Promise<boolean> {
  try {
    const settings = await getSettings()
    const url = `${settings.telethonCoreUrl || 'http://127.0.0.1:3005'}/health`
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) })
    if (!res.ok) return false
    const body = (await res.json()) as { ok: boolean; connected: boolean }
    return !!body.connected
  } catch {
    return false
  }
}

export async function uploadToTelethon(
  stream: ReadableStream<Uint8Array>,
  filename: string,
  size: number,
  mimeType: string,
  signal?: AbortSignal
): Promise<{ messageId: number; checksum: string; size: number }> {
  const settings = await getSettings()
  const url = `${settings.telethonCoreUrl || 'http://127.0.0.1:3005'}/upload`
  const key = settings.telethonInternalKey || 'vs-telethon-internal-key'

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'X-Internal-Key': key,
      'X-File-Name': encodeURIComponent(filename),
      'X-File-Size': String(size),
      'Content-Type': mimeType || 'application/octet-stream',
    },
    // @ts-expect-error - duplex option supported in Node/Bun fetch
    duplex: 'half',
    body: stream,
    signal,
  })

  if (!res.ok) {
    const err = await res.text().catch(() => '')
    throw new Error(`Telethon upload failed (${res.status}): ${err}`)
  }

  const data = (await res.json()) as { message_id: number; checksum: string; size: number }
  return {
    messageId: data.message_id,
    checksum: data.checksum,
    size: data.size,
  }
}

export async function uploadBigPart(
  telegramFileId: string,
  index: number,
  totalParts: number,
  data: Uint8Array,
  signal?: AbortSignal,
): Promise<void> {
  const settings = await getSettings()
  const res = await fetch(`${settings.telethonCoreUrl || 'http://127.0.0.1:3005'}/upload/big/${encodeURIComponent(telegramFileId)}/${index}`, {
    method: 'POST',
    headers: { 'X-Internal-Key': settings.telethonInternalKey || 'vs-telethon-internal-key', 'X-Total-Parts': String(totalParts), 'Content-Type': 'application/octet-stream' },
    body: Uint8Array.from(data).buffer,
    signal,
  })
  if (!res.ok) throw new Error(`Telethon multipart part failed (${res.status}): ${await res.text().catch(() => '')}`)
}

export async function finalizeBigUpload(
  telegramFileId: string,
  totalParts: number,
  filename: string,
  mimeType: string,
  caption: string,
  signal?: AbortSignal,
): Promise<{ messageId: number; documentId: string }> {
  const settings = await getSettings()
  const res = await fetch(`${settings.telethonCoreUrl || 'http://127.0.0.1:3005'}/upload/big/finalize`, {
    method: 'POST',
    headers: { 'X-Internal-Key': settings.telethonInternalKey || 'vs-telethon-internal-key', 'Content-Type': 'application/json' },
    body: JSON.stringify({ telegram_file_id: Number(telegramFileId), total_parts: totalParts, filename, mime_type: mimeType, caption }),
    signal,
  })
  if (!res.ok) throw new Error(`Telethon multipart finalize failed (${res.status}): ${await res.text().catch(() => '')}`)
  const data = await res.json() as { message_id: number; document_id: string }
  return { messageId: data.message_id, documentId: data.document_id }
}

export async function streamFromTelethon(messageId: number, range?: string | null): Promise<Response> {
  const settings = await getSettings()
  const url = `${settings.telethonCoreUrl || 'http://127.0.0.1:3005'}/download/${messageId}`
  const key = settings.telethonInternalKey || 'vs-telethon-internal-key'

  const headers: Record<string, string> = {
    'X-Internal-Key': key,
  }
  if (range) {
    headers['Range'] = range
  }

  return fetch(url, { headers })
}

export async function deleteFromTelethon(messageId: number): Promise<boolean> {
  try {
    const settings = await getSettings()
    const url = `${settings.telethonCoreUrl || 'http://127.0.0.1:3005'}/message/${messageId}`
    const key = settings.telethonInternalKey || 'vs-telethon-internal-key'

    const res = await fetch(url, {
      method: 'DELETE',
      headers: { 'X-Internal-Key': key },
      signal: AbortSignal.timeout(5000),
    })
    return res.ok
  } catch {
    return false
  }
}
