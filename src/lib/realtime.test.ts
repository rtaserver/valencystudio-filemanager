import assert from 'node:assert/strict'
import { realtimeHub, type SseClient } from './realtime-hub'

async function run() {
  const eventsReceived: Record<string, any[]> = {
    c1: [],
    c2: [],
    c3: [],
  }

  const c1: SseClient = {
    id: 'c1',
    userId: 'user1',
    privileged: false,
    slug: undefined,
    send: (ev, data) => eventsReceived.c1.push({ ev, data }),
    close: () => {},
  }

  const c2: SseClient = {
    id: 'c2',
    userId: 'user2',
    privileged: true,
    slug: undefined,
    send: (ev, data) => eventsReceived.c2.push({ ev, data }),
    close: () => {},
  }

  const c3: SseClient = {
    id: 'c3',
    userId: undefined,
    privileged: false,
    slug: 'public-slug',
    send: (ev, data) => eventsReceived.c3.push({ ev, data }),
    close: () => {},
  }

  const un1 = realtimeHub.addClient(c1)
  const un2 = realtimeHub.addClient(c2)
  const un3 = realtimeHub.addClient(c3)

  assert.equal(realtimeHub.clientCount(), 3)

  // 1. Broadcast to specific user (user1)
  realtimeHub.broadcast({ domains: ['files'] }, { rooms: ['user:user1'] })
  assert.equal(eventsReceived.c1.length, 1)
  assert.equal(eventsReceived.c2.length, 0)
  assert.equal(eventsReceived.c3.length, 0)

  // 2. Broadcast to admins
  realtimeHub.broadcast({ domains: ['users'] }, { rooms: ['admins'] })
  assert.equal(eventsReceived.c1.length, 1)
  assert.equal(eventsReceived.c2.length, 1)
  assert.equal(eventsReceived.c3.length, 0)

  // 3. Broadcast to slug
  realtimeHub.broadcast({ domains: ['downloads'] }, { rooms: ['slug:public-slug'] })
  assert.equal(eventsReceived.c1.length, 1)
  assert.equal(eventsReceived.c2.length, 1)
  assert.equal(eventsReceived.c3.length, 1)

  // 4. Broadcast all
  realtimeHub.broadcast({ domains: ['settings'] }, { all: true })
  assert.equal(eventsReceived.c1.length, 2)
  assert.equal(eventsReceived.c2.length, 2)
  assert.equal(eventsReceived.c3.length, 2)

  // Cleanup
  un1()
  un2()
  un3()
  assert.equal(realtimeHub.clientCount(), 0)

  console.log('realtime.test.ts: PASS')
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
