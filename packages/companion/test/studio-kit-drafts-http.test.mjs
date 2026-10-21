/** Authenticated local RPC proof only: no browser or native model execution. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fixture } from './fixture.mjs'
import { callCompanion } from '../src/connection-file.mjs'

test('Kit draft RPC uses token/origin auth and never mutates the installed Kit or notifies a host', async () => {
  const f = await fixture()
  const call = (method, params = {}) => callCompanion(f.server.connectionPath, { method, params })
  try {
    const connection = JSON.parse(await readFile(f.server.connectionPath, 'utf8'))
    const original = await readFile(join(f.options.kitRoot, 'mindset.md'), 'utf8')
    const denied = await fetch(`${connection.origin}/api`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: connection.origin },
      body: JSON.stringify({ method: 'studioKitDraftCreate', params: { kit: { name: 'web_app', version: '1.0' } } }) })
    assert.equal(denied.status, 403)
    assert.deepEqual(await call('studioKitDraftList'), [])
    const catalog = await call('studioWorkspace', { query: '' })
    const { name, version } = catalog.kits[0]
    const created = await call('studioKitDraftCreate', { kit: { name, version } })
    assert.equal(created.mindsetSource, original)
    const saved = await call('studioKitDraftSave', { id: created.id, expectedRevision: 0,
      mindsetSource: original + '\n<!-- HTTP working copy -->\n', relationsSource: created.relationsSource })
    assert.equal(saved.revision, 1)
    assert.deepEqual(await call('studioKitDraftRead', { id: saved.id }), saved)
    await assert.rejects(call('studioKitDraftSave', { id: saved.id, expectedRevision: 0, mindsetSource: original, relationsSource: null }), /changed/)
    const checked = await call('studioKitDraftValidate', { id: saved.id, expectedRevision: 1 })
    assert.equal(checked.valid, true, JSON.stringify(checked))
    const confirmed = await call('studioKitDraftConfirm', { id: saved.id, expectedRevision: 1 })
    assert.equal(confirmed.draft.confirmed, true)
    const fork = await call('studioKitDraftFork', { id: saved.id })
    assert.equal(fork.confirmed, false)
    assert.equal((await call('studioKitDraftList')).length, 2)
    assert.deepEqual(await call('studioDraftList'), [])
    assert.equal(await readFile(join(f.options.kitRoot, 'mindset.md'), 'utf8'), original)
    assert.equal(f.messages.length, 0)
  } finally { await f.close() }
})
