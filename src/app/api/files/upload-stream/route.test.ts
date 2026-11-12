import assert from 'node:assert/strict'
import { GET } from '@/app/api/files/upload-stream/route'
import { getSettings } from '@/lib/settings'

async function run() {
  // Test 1: getSettings maxFileSize is 2 GiB (2,147,483,648 bytes)
  const settings = await getSettings()
  assert.equal(settings.maxFileSize, 2_147_483_648, 'maxFileSize should be 2 GiB')

  // Test 2: GET /api/files/upload-stream responds with ok and maxFileSize
  const res = await GET()
  assert.equal(res.status, 200)
  const json = await res.json()
  assert.equal(json.ok, true)
  assert.equal(typeof json.available, 'boolean')
  assert.equal(json.maxFileSize, 2_147_483_648)

  console.log('upload-stream/route.test.ts: PASS')
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
