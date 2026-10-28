import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { prepareLocalEmbedding } from '../lib/index.js'

test('default preparation checks a missing cache without creating it or starting a probe', async t => {
  const root = await mkdtemp(join(tmpdir(), 'embedding-readiness-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const cacheDir = join(root, 'absent')
  const result = await prepareLocalEmbedding({ cacheDir, probe: true })
  assert.equal(result.status, 'unavailable')
  assert.equal(result.reasonCode, 'missing')
  assert.equal(result.downloadAllowed, false)
  assert.equal(result.resources.files.length, 4)
  assert.equal(result.resources.bytes, 135392016)
  assert.equal(result.inference.state, 'not-run')
  assert.equal(result.semanticKagVerified, false)
  await assert.rejects(readdir(cacheDir), { code: 'ENOENT' })
})

test('preparation validates its cache and returns bounded cancellation without leaking reasons', async () => {
  await assert.rejects(prepareLocalEmbedding({ cacheDir: 'relative' }), /absolute/)
  const abort = new AbortController(); abort.abort(new Error('PRIVATE_URL?token=PRIVATE'))
  const result = await prepareLocalEmbedding({ signal: abort.signal })
  assert.equal(result.reasonCode, 'cancelled')
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE/)
  assert.equal(result.inference.state, 'not-run')
})
