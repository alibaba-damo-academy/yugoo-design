import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DesignProjectManager } from '../../core/lib/index.js'
import { startCompanion } from '../src/server.mjs'
import { callCompanion } from '../src/connection-file.mjs'
import { staticFixture } from './static-fixture.mjs'
import * as runtime from '../../knowledge-ladybug/lib/index.js'

// Reviews open the shared Ladybug runtime in-process; stop its worker so the
// test process exits naturally after both servers close.
after(() => runtime.shutdownLadybugKnowledgeRuntime())

test('same cwd and parent never let a Producer or reviewer move across projects', async () => {
  const root = await mkdtemp(join(tmpdir(), 'design-native-project-'))
  const threadId = '00000000-0000-4000-8000-000000000001'
  const runId = '00000000-0000-4000-8000-000000000002'
  const reviewerId = '00000000-0000-4000-8000-000000000003'
  const servers = []
  try {
    const assets = await staticFixture(root)
    for (const name of ['a', 'b']) {
      const projectRoot = join(root, name)
      await new DesignProjectManager().create({ root: projectRoot, name, knowledge: { provider: 'ladybug-wasm' }, kit: { name: 'web_app', version: '1.1' } })
      servers.push(await startCompanion({ ...assets, projectRoot, nativeCwd: root, stateRoot: join(root, 'state'),
        kitRoot: fileURLToPath(new URL('../../skills-web-app/', import.meta.url)), connection: { threadId, send: async () => ({ accepted: true }) } }))
    }
    const call = (index, method, params) => callCompanion(servers[index].connectionPath, { method, params })
    const metadata = async id => {
      const path = join(root, `${id}.jsonl`)
      await writeFile(path, JSON.stringify({ type: 'session_meta', payload: { id, cwd: root, source: { subagent: { thread_spawn: { parent_thread_id: threadId } } } } }) + '\n')
      return { runId: id, parentRunId: threadId, transcriptPath: path }
    }
    const producer = { ...await metadata(runId), role: 'producer', skill: 'function_modules', artifactId: 'function_modules' }
    await call(0, 'registerNativeRun', producer)
    await assert.rejects(call(1, 'registerNativeRun', producer), /another Design Project/)
    const a = await call(0, 'prepareReview', { profile: 'clarity' })
    const b = await call(1, 'prepareReview', { profile: 'clarity' })
    const nativeRun = await metadata(reviewerId)
    await call(0, 'bindReviewRun', { reviewId: a.reviewId, nativeRun })
    await assert.rejects(call(1, 'bindReviewRun', { reviewId: b.reviewId, nativeRun }), /another Design Project/)
    const fresh = await metadata('00000000-0000-4000-8000-000000000004')
    await assert.rejects(call(0, 'bindReviewRun', { reviewId: b.reviewId, nativeRun: fresh }), /Unknown review ID/)
    await assert.rejects(call(0, 'submitReview', { reviewId: a.reviewId, nativeRun: fresh, result: {} }), /registered native reviewer/)
    await assert.rejects(call(1, 'submitReview', { reviewId: b.reviewId, nativeRun: fresh, result: {} }), /registered native reviewer/)
    await call(1, 'bindReviewRun', { reviewId: b.reviewId, nativeRun: fresh })
  } finally { await Promise.all(servers.map(server => server.close())); await rm(root, { recursive: true, force: true }) }
})
