import assert from 'node:assert/strict'
import { GET, POST } from '@/app/api/realtime/route'
import { NextRequest } from 'next/server'
import { realtimeHub } from '@/lib/realtime-hub'

async function run() {
  // Test 1: GET connects SSE stream
  const req = new NextRequest('http://localhost:3000/api/realtime?userId=test-user&privileged=1')
  const res = await GET(req)

  assert.equal(res.status, 200)
  assert.equal(res.headers.get('Content-Type'), 'text/event-stream; charset=utf-8')
  assert.equal(res.headers.get('Cache-Control'), 'no-cache, no-transform, no-store')
  assert.equal(realtimeHub.clientCount(), 1)

  // An unauthenticated query string must not create a user/admin subscription.
  const unauthRoomReq = new NextRequest('http://localhost:3000/api/realtime?userId=test-user&privileged=1')
  const unauthRoomRes = await GET(unauthRoomReq)
  assert.equal(realtimeHub.clientCount(), 2)

  // Test 3: configured internal key permits the intended broadcast.
  const oldKey = process.env.REALTIME_INTERNAL_KEY
  process.env.REALTIME_INTERNAL_KEY = 'test-key'
  const goodPostReq = new NextRequest('http://localhost:3000/api/realtime', {
    method: 'POST',
    headers: { 'x-internal-key': 'test-key', 'Content-Type': 'application/json' },
    body: JSON.stringify({ domains: ['files'], rooms: ['user:test-user'] }),
  })
  const goodPostRes = await POST(goodPostReq)
  assert.equal(goodPostRes.status, 200)
  if (oldKey === undefined) delete process.env.REALTIME_INTERNAL_KEY
  else process.env.REALTIME_INTERNAL_KEY = oldKey

  req.signal.dispatchEvent(new Event('abort'))
  unauthRoomReq.signal.dispatchEvent(new Event('abort'))
  assert.equal(realtimeHub.clientCount(), 0)

  console.log('route.test.ts: PASS')
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
