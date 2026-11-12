import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseParts, buildFileResponse, FileMeta } from '@/lib/download'
import { getSettings } from '@/lib/settings'

test('streaming and storage invariants', async () => {
  console.log('--- Starting Streaming & Storage Invariant Tests ---')

  // 1. Invariant: 1 Telethon file = 1 part (no 16MB chunk splitting)
  const teleParts = parseParts(JSON.stringify([{ ref: 'telethon:778899', size: 1_500_000_000 }]))
  assert.equal(teleParts.length, 1, 'Telethon file must have exactly 1 part')
  assert.equal(teleParts[0].ref, 'telethon:778899')
  assert.equal(teleParts[0].size, 1_500_000_000)
  console.log('✓ Invariant 1 passed: 1 Telethon file = 1 Telegram message ref (no chunking)')

  // 2. Invariant: Strict 2,147,483,648 byte (2 GiB) boundary limit
  const settings = await getSettings()
  assert.ok(
    settings.maxFileSize <= 2_147_483_648,
    `maxFileSize setting must be <= 2,147,483,648 bytes (got ${settings.maxFileSize})`
  )
  console.log('✓ Invariant 2 passed: Global max file size bounded by 2,147,483,648 bytes (2 GiB)')

  // 3. Invariant: Range Requests (HTTP 206) for Telethon files
  const testFile: FileMeta = {
    name: 'movie.mp4',
    mimeType: 'video/mp4',
    size: 1_000_000,
    parts: JSON.stringify([{ ref: 'telethon:101', size: 1_000_000 }]),
  }

  const originalFetch = globalThis.fetch
  let telethonFetchedUrl = ''
  let telethonFetchedRange = ''

  globalThis.fetch = async (input: any, init?: any) => {
    const url = typeof input === 'string' ? input : input.url
    if (url.includes('/download/101')) {
      telethonFetchedUrl = url
      telethonFetchedRange = init?.headers?.Range || ''
      const dummyChunk = new Uint8Array(100)
      return new Response(dummyChunk, {
        status: 200,
        headers: { 'Content-Type': 'application/octet-stream' },
      })
    }
    return originalFetch(input, init)
  }

  try {
    // 3a. Standard Range request
    const req1 = new Request('http://localhost/download', {
      headers: { range: 'bytes=500-599' },
    })
    const res1 = await buildFileResponse(req1, testFile, 'inline')
    assert.equal(res1.status, 206)
    assert.equal(res1.headers.get('content-range'), 'bytes 500-599/1000000')
    assert.equal(res1.headers.get('content-length'), '100')
    assert.equal(res1.headers.get('accept-ranges'), 'bytes')
    assert.equal(telethonFetchedRange, 'bytes=500-599')

    // 3b. Suffix Range request (last 200 bytes)
    const req2 = new Request('http://localhost/download', {
      headers: { range: 'bytes=-200' },
    })
    const res2 = await buildFileResponse(req2, testFile, 'inline')
    assert.equal(res2.status, 206)
    assert.equal(res2.headers.get('content-range'), 'bytes 999800-999999/1000000')
    assert.equal(res2.headers.get('content-length'), '200')
    assert.equal(telethonFetchedRange, 'bytes=999800-999999')

    // 3c. Unsatisfiable Range request
    const req3 = new Request('http://localhost/download', {
      headers: { range: 'bytes=2000000-3000000' },
    })
    const res3 = await buildFileResponse(req3, testFile, 'inline')
    assert.equal(res3.status, 416)
    assert.equal(res3.headers.get('content-range'), 'bytes */1000000')
    console.log('✓ Invariant 3 passed: HTTP 206 Range requests correctly mapped and forwarded')
  } finally {
    globalThis.fetch = originalFetch
  }

  // 4. Invariant: Legacy multi-part backward compatibility
  const legacyParts = parseParts(
    JSON.stringify([
      { ref: 'tg:file1:msg1', size: 16777216 },
      { ref: 'tg:file2:msg2', size: 16777216 },
      { ref: 'local:some/path.part', size: 1024 },
    ])
  )
  assert.equal(legacyParts.length, 3)
  assert.ok(legacyParts[0].ref.startsWith('tg:'))
  assert.ok(legacyParts[2].ref.startsWith('local:'))
  console.log('✓ Invariant 4 passed: Backward compatibility for legacy multipart files preserved')

  // 5. Invariant: Zero-byte file returns empty 200 without Telethon query
  const emptyFile: FileMeta = {
    name: 'empty.txt',
    mimeType: 'text/plain',
    size: 0,
    parts: '[]',
  }
  const emptyRes = await buildFileResponse(new Request('http://localhost/download'), emptyFile, 'attachment')
  assert.equal(emptyRes.status, 200)
  assert.equal(emptyRes.headers.get('content-length'), '0')
  console.log('✓ Invariant 5 passed: Zero-byte files stream cleanly')

  // 6. Invariant: Default new user quota is 1000 GB
  const currentSettings = await getSettings()
  assert.equal(currentSettings.defaultQuota, 1000 * 1024 * 1024 * 1024)
  console.log('✓ Invariant 6 passed: Default storage quota for new users is 1000 GB')

  console.log('--- All Streaming Storage Invariant Tests PASSED ---')
})
