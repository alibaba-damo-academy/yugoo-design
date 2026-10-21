import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
const { register } = await import('tsx/esm/api'); register()
const { normalizeUnseededChildSessionMeta, designUnseededChildSessionMeta } = await import('../src/dsh-child-session-meta.ts')

test('official boolean header normalizes legacy zero without losing host lineage or mutating input', () => {
  for (const isSeeded of [0, false]) {
    const meta = Object.freeze({ cwd: '/owned', agentPreset: 'host-preset', parentSession: 'parent', origin: 'subagent', delegationDepth: 2, isSeeded })
    const result = normalizeUnseededChildSessionMeta(meta)
    assert.deepEqual(result, { ...meta, isSeeded: false })
    assert.notEqual(result, meta)
    assert.equal(meta.isSeeded, isSeeded)
  }
})

test('legacy header stays legacy; no new seeding field or invented preset', () => {
  const meta = { parentSession: 'parent', origin: 'subagent', delegationDepth: 2 }
  assert.deepEqual(normalizeUnseededChildSessionMeta(meta), meta)
  assert.equal(Object.hasOwn(normalizeUnseededChildSessionMeta(meta), 'isSeeded'), false)
})

test('unexpected seeded or malformed metadata fails closed', () => {
  for (const meta of [null, [], 'bad', { seedLength: 0 }, { seedLength: 1 }, { isSeeded: true }, { isSeeded: 1 }, { isSeeded: undefined }, { isSeeded: 'false' }]) {
    assert.throws(() => normalizeUnseededChildSessionMeta(meta), /metadata/)
  }
})

test('installed official host keeps boolean unseeded metadata, preset and complete lineage', () => {
  for (const agentPreset of [undefined, 'host-preset']) {
    const parent = { session: { header: { id: 'parent', cwd: '/owned' } }, ctx: { get: () => ({ composedPreset: () => agentPreset }) } }
    const actual = designUnseededChildSessionMeta(parent, 2)
    assert.deepEqual(actual, {
      cwd: '/owned', parentSession: 'parent', origin: 'subagent', delegationDepth: 2, isSeeded: false,
      ...(agentPreset === undefined ? {} : { agentPreset }),
    })
    assert.equal(Object.hasOwn(actual, 'seedLength'), false, 'fresh child never inherits a transcript prefix')
  }
})

test('both creation paths use shared metadata; Producer keeps its scoped cwd', async () => {
  const worker = await readFile(new URL('../src/dsh-file-worker-agent.ts', import.meta.url), 'utf8')
  const producer = await readFile(new URL('../src/dsh-producer-agent.ts', import.meta.url), 'utf8')
  assert.match(worker, /meta: designUnseededChildSessionMeta\(request\.parent, depth\)/)
  assert.match(producer, /\.\.\.designUnseededChildSessionMeta\(request\.parent, childDepth\),\s*cwd: request\.designFilesRoot/)
  assert.doesNotMatch(worker + producer, /childSessionMeta\(request\.parent/)
})
