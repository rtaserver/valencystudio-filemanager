import assert from 'node:assert/strict'
import { isTelethonHealthy } from './telethon'

async function run() {
  // When service is not running or unreachable, isTelethonHealthy should return false without crashing
  const healthy = await isTelethonHealthy()
  assert.equal(typeof healthy, 'boolean')
  console.log('telethon.test.ts: PASS')
}

run().catch(e => {
  console.error(e)
  process.exit(1)
})
