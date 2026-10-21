import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCompanionKnowledge } from '../src/knowledge.mjs'

test('a provider read failure is failed, not an empty unassessed graph or an indexing success', async () => {
  let loads = 0, writes = 0
  const projectId = '11111111-1111-4111-8111-111111111111'
  const project = { project: { metadata: { id: projectId, knowledge: { provider: 'ladybug-wasm' } } },
    requireWritable: async () => {}, store: { head: async () => 'current-checkpoint' },
    mutateKnowledge: async () => { writes++; throw new Error('A status read cannot mutate knowledge') } }
  const knowledge = createCompanionKnowledge({ project, stateRoot: '/unused-read-only-status',
    loadRuntime: async () => { loads++; throw new Error('Native knowledge runtime could not open') },
    embedding: { provider: 'disabled' } })
  try {
    const cold = await knowledge.status()
    assert.equal(cold.state, 'unavailable')
    assert.equal(cold.reasonCode, 'knowledge-store-not-open')
    assert.equal(loads, 0, 'a cold status read cannot initialize or recover a provider')
    await assert.rejects(knowledge.notify(), /could not open/)
    for (let read = 0; read < 2; read++) {
      const status = await knowledge.status()
      assert.equal(status.project, projectId)
      assert.equal(status.head, 'current-checkpoint')
      assert.equal(status.state, 'failed')
      assert.equal(status.freshness, 'none')
      assert.equal(status.latestComplete, undefined)
      assert.equal(status.lastFailure.target, 'companion-maintenance')
      assert.match(status.lastFailure.message, /could not open/)
      assert.equal(status.semanticLayer, 'disabled')
    }
    assert.equal(loads, 1, 'reading a failure does not retry provider opening')
    assert.equal(writes, 0, 'status never starts maintenance or creates a publication')
  } finally { await knowledge.close() }
})

test('cold maintenance never starts without a published head, including a failed head read', async () => {
  for (const failRead of [false, true]) {
    let loads = 0
    const project = { project: { metadata: { id: '11111111-1111-4111-8111-111111111111', knowledge: { provider: 'ladybug-wasm' } } },
      requireWritable: async () => {}, store: { head: async () => { if (failRead) throw new Error('Head unavailable'); return undefined } } }
    const knowledge = createCompanionKnowledge({ project, stateRoot: '/unused-no-head',
      loadRuntime: async () => { loads++; throw new Error('Must not acquire a provider') } })
    try {
      assert.equal((await knowledge.requestMaintenance()).reason, 'no-published-checkpoint')
      assert.equal(loads, 0)
    } finally { await knowledge.close() }
  }
})

test('an ordinary cold graph-open failure remains visible without status retrying it', async () => {
  let loads = 0
  const project = { project: { metadata: { id: '11111111-1111-4111-8111-111111111111', knowledge: { provider: 'ladybug-wasm' } } },
    requireWritable: async () => {}, store: { head: async () => 'head' } }
  const knowledge = createCompanionKnowledge({ project, stateRoot: '/unused-open-failure',
    loadRuntime: async () => { loads++; throw new Error('Controlled graph-open failure') } })
  try {
    await assert.rejects(knowledge.readGraph(), /Controlled graph-open failure/)
    const status = await knowledge.status()
    assert.equal(status.state, 'failed')
    assert.equal(status.lastFailure.target, 'knowledge-store')
    assert.equal(loads, 1)
  } finally { await knowledge.close() }
})

test('the existing publication parser stays the authority while I/O and malformed pointers remain observable', async () => {
  const projectId = '11111111-1111-4111-8111-111111111111'
  const root = await mkdtemp(join(tmpdir(), 'companion-publication-status-'))
  await writeFile(join(root, 'project.json'), JSON.stringify({ kind: 'dsh-design-project', formatVersion: 3,
    id: projectId, name: 'Publication status', createdAt: '2026-10-19T00:00:00.000Z', knowledge: { provider: 'ladybug-wasm' } }))
  let value, readError = false, closed = false
  const provider = { async readSemanticCache() { if (readError) throw new Error('Publication read failed'); return value },
    async writeSemanticCache() {}, async revision() { return 'rev:0' }, async resetCache() {},
    async close() { closed = true } }
  const project = { project: { root, metadata: { id: projectId, knowledge: { provider: 'ladybug-wasm' } } },
    requireWritable: async () => {}, store: { head: async () => 'current-checkpoint' },
    mutateKnowledge: async () => { throw new Error('Stop before graph operations') } }
  const knowledge = createCompanionKnowledge({ project, stateRoot: '/unused-publication-status',
    loadRuntime: async () => ({ LadybugDesignKnowledgeProvider: { open: async () => provider },
      DesignSemanticIndex: class { publicationIdentity = 'test'; async close() {} } }), embedding: { provider: 'disabled' } })
  try {
    assert.equal((await knowledge.status()).state, 'unavailable')
    // Only the normal graph operation acquires a provider; status must not.
    await assert.rejects(knowledge.readGraph(), /Stop before graph operations/)
    readError = true
    let status = await knowledge.status()
    assert.equal(status.state, 'failed')
    assert.equal(status.lastFailure.target, 'knowledge-publication')
    assert.match(status.lastFailure.message, /Publication read failed/)
    readError = false; value = '{invalid'
    status = await knowledge.status()
    assert.equal(status.state, 'failed')
    assert.match(status.lastFailure.message, /not valid/)
    value = JSON.stringify({ schemaVersion: 1, key: 'key', edges: 'edges', checkpoint: 'current-checkpoint', revision: 'rev:1', warnings: [] })
    status = await knowledge.status()
    assert.equal(status.state, 'current')
    assert.equal(status.latestComplete.revision, 'rev:1')
    assert.equal(status.lastFailure, undefined)
  } finally { await knowledge.close(); assert.equal(closed, true); await rm(root, { recursive: true, force: true }) }
})
