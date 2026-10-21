/** Opt-in real model cancellation test. Requires the previously downloaded model. */
import assert from 'node:assert/strict'
import { readFile, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { DesignSemanticIndex } from '../lib/semantic-index.js'
const source = JSON.parse(await readFile(process.argv[2], 'utf8'))
const graph = { checkpoint: source.checkpoint, semanticUnits: source.units }
const children = async () => (await readFile(`/proc/self/task/${process.pid}/children`, 'utf8')).trim().split(/\s+/).filter(Boolean).map(Number)
for (const mode of ['loading', 'after-first-inference']) {
  const index = new DesignSemanticIndex({ localOnly: true })
  let writes = 0, cancelled = false, lateWrites = 0
  try {
    index.read('cancel', graph, { readSemanticCache: async () => undefined, writeSemanticCache: async () => { writes++; if(cancelled)lateWrites++ } })
    const deadline = performance.now() + 60000
    let pids = []
    do {
      await new Promise(resolve => setTimeout(resolve, 10))
      pids = await children()
      if (performance.now() > deadline) throw new Error('Real inference did not reach cancellation checkpoint')
    } while (!pids.length || (mode === 'after-first-inference' && writes === 0))
    cancelled = true
    const started = performance.now()
    index.cancelProject('cancel')
    await index.close()
    assert.ok(performance.now() - started < 5000)
    assert.equal(lateWrites, 0)
    for (const pid of pids) assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' })
    console.log(JSON.stringify({ mode, cancellationMs: performance.now() - started, writes, childGone: true }))
  } finally { await index.close() }
}

const emptyCache = await mkdtemp(join(tmpdir(), 'semantic-offline-empty-'))
const offline = new DesignSemanticIndex({ localOnly: true, cacheDir: emptyCache })
const cache = { readSemanticCache: async () => undefined, writeSemanticCache: async () => assert.fail('missing offline model must not produce vectors') }
try {
  const started = performance.now()
  let result = offline.read('offline', graph, cache)
  while (result.status.state === 'indexing') {
    assert.ok(performance.now() - started < 30000)
    await new Promise(resolve => setTimeout(resolve, 20))
    result = offline.read('offline', graph, cache)
  }
  assert.equal(result.status.state, 'error')
  await new Promise(resolve => setTimeout(resolve, 200))
  assert.deepEqual(await children(), [])
  assert.equal(offline.read('offline', graph, cache).status.state, 'error')
  assert.deepEqual(await children(), [])
  console.log(JSON.stringify({ mode: 'offline-missing-model', failedClosed: true, automaticRetry: false, elapsedMs: performance.now() - started }))
} finally { await offline.close() }
