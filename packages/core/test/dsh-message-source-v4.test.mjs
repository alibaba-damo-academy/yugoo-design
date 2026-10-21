/** Actual official codec/Session/writer methods, Linux temporary IO; no live Host/profile. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, appendFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import vm from 'node:vm'
import ts from 'typescript'
import { loadDshTestRuntime } from './dsh-asar-test-loader.mjs'

const host = loadDshTestRuntime({ asar: process.env.DSH_TEST_ASAR, webAnchor: process.env.DSH_TEST_WEB_ANCHOR })
const { createYugooDesignMessage } = await import('../src/dsh-message-source.ts')
const { releasedV4SessionFormatCodec: codec } = await import('@deepseek-ai/dsh-session-format-v3-to-v4')
const sdk = await import('@deepseek-ai/dsh-session')
const persistence = await import('@deepseek-ai/dsh-session-persistence')
assert.equal(sdk.SESSION_FORMAT_VERSION, 4, 'this gate requires the current v4 runtime, regardless of Web/Desktop presentation')
const splice = (message, seq = 0) => ({ type: 'agent/inbox/spliced', seq, time: 1,
  data: { target: 'next-step', start: 0, inserted: [message] } })

test('actual v4 admits Yugoo tasks/notices and real human input, rejects the retired wrapper', () => {
  for (const notice of [undefined, 'design panel saved: example', 'design advisory projection: 0']) {
    const message = createYugooDesignMessage({ content: [{ type: 'text', text: 'Keep saved facts' }], ...(notice === undefined ? {} : { notice }) })
    const event = splice(message)
    assert.doesNotThrow(() => codec.encodeEvent(event))
    assert.throws(() => codec.encodeEvent(splice({ ...message, source: { kind: 'plugin', plugin: 'dsh-design-core' } })), /producer-owned source kind/)
    assert.doesNotThrow(() => codec.encodeEvent(splice({ ...message, source: { kind: 'user' } })))
    assert.equal(event.data.inserted[0], message, 'admission does not replace message identity or bytes')
  }
})

test('actual Session and JSONL handle retain a rejected batch; later human input cannot bypass it', async t => {
  const root = await mkdtemp(join(tmpdir(), 'yugoo-v4-writer-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = host.readPackageFile('@deepseek-ai/dsh-session-persistence-jsonl', 'lib/index.js')
  const ast = ts.createSourceFile('actual-jsonl.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  let actualClass
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'JsonlSessionHandle') actualClass = node.initializer.getText(ast)
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.ok(actualClass, 'actual installed SDK still owns the expected JSONL handle')
  // Execute this exact SDK class without importing its Windows-only flock
  // binding. Only the storage port is a fixture: native lease/fsync and a live
  // Host are deliberately outside this test, and the buffer is never cleared.
  const Handle = vm.runInNewContext('(' + actualClass + ')', {
    ...persistence, setTimeout, clearTimeout, structuredClone, errorChain: String,
  })
  async function writer(name) {
    const file = join(root, name + '.jsonl')
    await writeFile(file, '')
    const id = sdk.SessionId(randomUUID())
    const session = new sdk.Session(id, undefined, { version: 4, id, createdAt: Date.now(), isSeeded: false, cwd: root })
    const state = { cursor: 0, materialized: true, inheritedEventCount: 0 }
    const storage = {
      async acquireWriteLease() { return {} },
      async persistBatch(_header, events) {
        const lines = events.map(event => JSON.stringify(codec.encodeEvent(event))).join('\n') + '\n'
        await appendFile(file, lines)
      },
    }
    const handle = new Handle(storage, id, session.header, 'write', state)
    t.after(() => clearTimeout(handle.batchTimer))
    return { file, handle, session, state }
  }
  const good = await writer('valid')
  const valid = createYugooDesignMessage({ content: [{ type: 'text', text: 'Saved' }], notice: 'Saved design facts' })
  good.handle.enqueueLive(good.session.append('agent/inbox/spliced', splice(valid).data), error => assert.fail(String(error)))
  await good.handle.drainLive()
  assert.equal(good.state.cursor, 1)
  assert.equal(JSON.parse((await readFile(good.file, 'utf8')).trim()).data.inserted[0].source.kind, 'yugoo-design')

  const bad = await writer('rejected')
  const invalid = { ...valid, id: randomUUID(), source: { kind: 'plugin', plugin: 'dsh-design-core' } }
  bad.handle.enqueueLive(bad.session.append('agent/inbox/spliced', splice(invalid).data), () => {})
  await assert.rejects(bad.handle.drainLive(), /producer-owned source kind/)
  assert.equal(bad.handle.buffered.length, 1)
  assert.equal(bad.handle.drainPaused, true)
  assert.equal(bad.state.cursor, 0)
  assert.equal(await readFile(bad.file, 'utf8'), '')
  const human = { ...valid, id: randomUUID(), source: { kind: 'user' } }
  bad.handle.enqueueLive(bad.session.append('agent/inbox/spliced', splice(human).data), () => {})
  await assert.rejects(bad.handle.drainLive(), /producer-owned source kind/)
  assert.equal(bad.handle.buffered.length, 2, 'failed batch precedes the later legal human message')
  assert.equal(bad.handle.buffered[0].data.inserted[0].id, invalid.id)
  assert.equal(bad.handle.buffered[1].data.inserted[0].id, human.id)
  assert.equal(await readFile(bad.file, 'utf8'), '')
})

test.after(() => { console.log('Official runtime test module hashes:', Object.fromEntries(host.observations)); host.close() })
