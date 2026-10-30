/** Authenticated current-object editing replaces the removed draft release surface. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fixture } from './fixture.mjs'
import { callCompanion } from '../src/connection-file.mjs'

test('current library editing preserves authentication, identity and CAS without draft release routes', async () => {
  const f = await fixture()
  const call = (method, params = {}) => callCompanion(f.server.connectionPath, { method, params })
  try {
    const connection = JSON.parse(await readFile(f.server.connectionPath, 'utf8'))
    const catalog = await call('studioWorkspace', { query: '' })
    const { name, version } = catalog.kits[0]
    const denied = await fetch(`${connection.origin}/api`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: connection.origin },
      body: JSON.stringify({ method: 'studioInstanceEditCurrent', params: { kind: 'kit', kit: { name, version } } }) })
    assert.equal(denied.status, 403)
    const current = await call('studioInstanceEditCurrent', { kind: 'kit', kit: { name, version } })
    assert.equal(current.current, true)
    assert.equal((await call('studioInstanceEditCurrent', { kind: 'kit', kit: { name, version } })).id, current.id)
    const original = await call('studioInstanceFile', { id: current.id, path: 'mindset.md' })
    const saved = await call('studioInstanceSave', { id: current.id, expectedRevision: current.revision, path: original.path,
      content: original.content + '\n<!-- Current object HTTP edit -->\n' })
    assert.equal(saved.revision, current.revision + 1)
    await assert.rejects(call('studioInstanceSave', { id: current.id, expectedRevision: current.revision, path: original.path, content: original.content }), /changed/)
    assert.match((await call('studioInstanceFile', { id: saved.id, path: original.path })).content, /Current object HTTP edit/)
    for (const method of ['studioKitDraftCreate', 'studioKitDraftList', 'studioKitDraftRead', 'studioKitDraftSave', 'studioKitDraftValidate', 'studioKitDraftPreview', 'studioKitDraftConfirm', 'studioKitDraftFork',
      'studioDraftCreate', 'studioDraftList', 'studioDraftRead', 'studioDraftSave', 'studioDraftPreview', 'studioDraftConfirm', 'studioDraftFork']) {
      await assert.rejects(call(method), /method|unknown|allowed|unsupported/i)
    }
    assert.equal(f.messages.length, 0)
  } finally { await f.close() }
})
