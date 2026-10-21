import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { browserRandomUuid } from '../src/browser-uuid.ts'
import { freshRecordId } from '../src/record-state.ts'

test('native UUID is preferred and retains its crypto receiver', () => {
  const value = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
  const source = { randomUUID() { assert.equal(this, source); return value }, getRandomValues() { assert.fail('fallback must not run') } }
  assert.equal(browserRandomUuid(source), value)
})

test('missing randomUUID uses secure bytes with RFC4122 v4 and variant bits', () => {
  let calls = 0
  const source = { getRandomValues(bytes) { assert.equal(this, source); assert.ok(bytes instanceof Uint8Array); assert.equal(bytes.length, 16); ++calls; bytes.set(Array.from({length:16},(_,i)=>i)); return bytes } }
  assert.equal(browserRandomUuid(source), '00010203-0405-4607-8809-0a0b0c0d0e0f')
  assert.equal(calls, 1)
  assert.equal(browserRandomUuid({ getRandomValues(bytes) { bytes.fill(255); return bytes } }), 'ffffffff-ffff-4fff-bfff-ffffffffffff')
})

test('no secure crypto rejects rather than producing weak IDs', () => {
  assert.throws(() => browserRandomUuid(null), /Secure browser randomness is unavailable/)
  assert.throws(() => browserRandomUuid({}), /Secure browser randomness is unavailable/)
  assert.throws(() => browserRandomUuid({ randomUUID: undefined, getRandomValues: undefined }), /Secure browser randomness is unavailable/)
})

test('record IDs retain prefixes and collision handling with the secure fallback', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto')
  let calls = 0
  Object.defineProperty(globalThis, 'crypto', { configurable:true, value:{getRandomValues(bytes) { bytes.fill(0); bytes[15] = calls++; return bytes }} })
  try {
    const first = 'credentials-00000000-0000-4000-8000-000000000000'
    assert.equal(freshRecordId('credentials', {[first]:{}}), 'credentials-00000000-0000-4000-8000-000000000001')
    assert.equal(calls, 2)
  } finally { if(descriptor) Object.defineProperty(globalThis,'crypto',descriptor); else delete globalThis.crypto }
})

test('all six browser consumers use the shared helper without direct randomUUID calls', async () => {
  const paths = ['record-state.ts','record-map.tsx','canvas-workspace.tsx','client/workspace.tsx','client/review-policy-control.tsx']
  for(const path of paths) {
    const source = await readFile(new URL('../src/'+path,import.meta.url),'utf8')
    assert.match(source, /import \{ browserRandomUuid \} from/)
    assert.doesNotMatch(source, /crypto\.randomUUID\(/)
  }
  const companion = await readFile(new URL('../../companion/src/client.tsx',import.meta.url),'utf8')
  assert.match(companion, /eventId: eventId \?\? browserRandomUuid\(\)/)
  assert.doesNotMatch(companion, /crypto\.randomUUID\(/)
})
