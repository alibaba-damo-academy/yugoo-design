/** Stateless archive transport and existing S2 import; no model, publication or browser. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readdir } from 'node:fs/promises'
import { fixture } from './fixture.mjs'
import { callCompanion } from '../src/connection-file.mjs'

const hash = value => createHash('sha256').update(value).digest('hex')
const resign = archive => { const { sha256, ...body } = archive; return { ...body, sha256: hash(JSON.stringify(body)) } }

test('exported bytes roundtrip through stateless archive reading and ordinary source import', async () => {
  const f = await fixture()
  const call = (method, params = {}) => callCompanion(f.server.connectionPath, { method, params })
  try {
    const original = await call('studioInstanceCreate', { kind: 'bundle', title: { zh: '原始技能', en: 'Original skill' } })
    const source = await call('studioContentExport', { id: original.id, expectedRevision: original.revision })
    const before = await readdir(f.options.stateRoot)
    const archive = await call('studioContentReadArchive', { source })
    assert.equal(archive.kind, 'bundle')
    assert.deepEqual(await readdir(f.options.stateRoot), before, 'archive parsing stores no import record')
    const imported = await call('studioInstanceImportSources', { kind: archive.kind, title: archive.title,
      files: archive.files.map(({ path, base64 }) => ({ path, base64 })) })
    assert.notEqual(imported.id, original.id)
    assert.equal(imported.revision, 0)
    assert.equal(f.messages.length, 0)
    const changed = structuredClone(archive); changed.files[0].base64 = 'AA=='
    await assert.rejects(call('studioContentReadArchive', { source: JSON.stringify(resign(changed)) }), /integrity|bytes|hash/i)
    const unsafe = structuredClone(archive); unsafe.files[0].path = '../outside'
    await assert.rejects(call('studioContentReadArchive', { source: JSON.stringify(resign(unsafe)) }), /path|integrity/i)
    await assert.rejects(call('studioContentReadArchive', { source: JSON.stringify({ ...archive, sha256: '0'.repeat(64) }) }), /integrity/i)
    for (const method of ['studioContentImport', 'studioContentImportRead', 'studioContentImportList', 'studioContentImportAdopt']) {
      await assert.rejects(call(method), /unsupported|method|unknown|allowed/i)
    }
  } finally { await f.close() }
})
