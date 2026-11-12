import assert from 'node:assert/strict'
import { parseParts, buildFileResponse, FileMeta } from './download'

async function run() {
  // Test 1: parseParts with telethon reference
  const parts = parseParts(JSON.stringify([{ ref: 'telethon:1234', size: 100 }]))
  assert.equal(parts.length, 1)
  assert.equal(parts[0].ref, 'telethon:1234')
  assert.equal(parts[0].size, 100)

  // Test 2: zero size file returns empty 200
  const zeroFile: FileMeta = {
    name: 'empty.txt',
    mimeType: 'text/plain',
    size: 0,
    parts: '[]',
  }
  const zeroReq = new Request('http://localhost/download')
  const zeroRes = await buildFileResponse(zeroReq, zeroFile, 'attachment')
  assert.equal(zeroRes.status, 200)
  assert.equal(zeroRes.headers.get('content-length'), '0')

  // Test 3: unsatisfiable range returns 416
  const teleFile: FileMeta = {
    name: 'test.bin',
    mimeType: 'application/octet-stream',
    size: 50,
    parts: JSON.stringify([{ ref: 'telethon:555', size: 50 }]),
  }
  const badRangeReq = new Request('http://localhost/download', {
    headers: { range: 'bytes=100-200' },
  })
  const badRangeRes = await buildFileResponse(badRangeReq, teleFile, 'attachment')
  assert.equal(badRangeRes.status, 416)
  assert.equal(badRangeRes.headers.get('content-range'), 'bytes */50')

  // Test 4: telethon file range routing creates 206 with Content-Range
  // Mock global fetch to return stream response from telethon service
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input: any, init?: any) => {
    const url = typeof input === 'string' ? input : input.url
    if (url.includes('/download/555')) {
      return new Response(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), {
        status: 200,
        headers: { 'Content-Type': 'application/octet-stream' },
      })
    }
    return originalFetch(input, init)
  }

  try {
    const rangeReq = new Request('http://localhost/download', {
      headers: { range: 'bytes=0-9' },
    })
    const rangeRes = await buildFileResponse(rangeReq, teleFile, 'inline')
    assert.equal(rangeRes.status, 206)
    assert.equal(rangeRes.headers.get('content-range'), 'bytes 0-9/50')
    assert.equal(rangeRes.headers.get('content-length'), '10')
    assert.equal(rangeRes.headers.get('accept-ranges'), 'bytes')
    assert.ok(rangeRes.headers.get('content-disposition')?.includes('inline'))
    const bodyBuf = await rangeRes.arrayBuffer()
    assert.equal(bodyBuf.byteLength, 10)

    // Test 5: telethon full file download returns 200
    const fullReq = new Request('http://localhost/download')
    const fullRes = await buildFileResponse(fullReq, teleFile, 'attachment')
    assert.equal(fullRes.status, 200)
    assert.equal(fullRes.headers.get('content-length'), '50')
    assert.equal(fullRes.headers.get('accept-ranges'), 'bytes')
    const fullBuf = await fullRes.arrayBuffer()
    assert.equal(fullBuf.byteLength, 10)
  } finally {
    globalThis.fetch = originalFetch
  }

  console.log('download.test.ts: PASS')
}

run().catch(e => {
  console.error(e)
  process.exit(1)
})
