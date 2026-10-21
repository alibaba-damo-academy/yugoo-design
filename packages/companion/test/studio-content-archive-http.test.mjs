/** Local transport/staging/adoption proof. No browser, model or publication. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile, readdir, lstat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { fixture } from './fixture.mjs'
import { callCompanion } from '../src/connection-file.mjs'
import { createCompanionStudio } from '../src/studio.mjs'

const hash = value => createHash('sha256').update(value).digest('hex')
const resign = value => { const { sha256, ...data } = value; return { ...data, sha256: hash(JSON.stringify(data)) } }

test('authenticated archive adoption retains Kit closures and independent Bundles without source writes or execution', async () => {
  const f = await fixture()
  const call = (method, params = {}) => callCompanion(f.server.connectionPath, { method, params })
  try {
    const original = await readFile(join(f.options.kitRoot, 'mindset.md'), 'utf8')
    const stateMode = (await lstat(f.options.stateRoot)).mode
    const catalog = await call('studioWorkspace', { query: '' })
    const { name, version } = catalog.kits[0]
    const source = await call('studioContentExport', { kind: 'kit', pin: { name, version }, provenance: { source: 'isolated test fixture', license: 'Apache-2.0' } })
    const envelope = JSON.parse(source)
    assert.equal(envelope.pin.name, name)
    assert.equal(envelope.format, 'studio-content-archive/v1')
    const record = await call('studioContentImport', { source })
    assert.equal(record.executionGranted, false)
    assert.equal(record.validation.valid, true, JSON.stringify(record.validation))
    assert.equal(record.archive.sha256, envelope.sha256)
    assert.deepEqual(await call('studioContentImportRead', { id: record.id }), record)
    assert.equal((await call('studioContentImportList')).length, 1)
    const retained = await readdir(join(f.options.stateRoot, 'studio-content-state', 'studio-content-imports'))
    assert.deepEqual(retained, [`${record.id}.json`], 'only inert envelope retained, not an extracted Kit tree')
    assert.equal((await lstat(f.options.stateRoot)).mode, stateMode, 'host state directory permissions stay untouched')
    assert.equal(await readFile(join(f.options.kitRoot, 'mindset.md'), 'utf8'), original)
    assert.equal(f.messages.length, 0)

    const connection = JSON.parse(await readFile(f.server.connectionPath, 'utf8'))
    const denied = await fetch(`${connection.origin}/api`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: connection.origin },
      body: JSON.stringify({ method: 'studioContentImport', params: { source } }) })
    assert.equal(denied.status, 403)
    assert.equal((await call('studioContentImportList')).length, 1)
    await assert.rejects(call('studioContentImportRead', { id: '../outside' }), /identity/)

    const deniedAdopt = await fetch(`${connection.origin}/api`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: connection.origin },
      body: JSON.stringify({ method: 'studioContentImportAdopt', params: { id: record.id } }) })
    assert.equal(deniedAdopt.status, 403)
    assert.deepEqual(await call('studioKitDraftList'), [])
    const adopted = await call('studioContentImportAdopt', { id: record.id })
    assert.equal(adopted.importId, record.id)
    assert.equal(adopted.executionGranted, false)
    assert.equal(adopted.requiresTrustReview, record.requiresTrustReview)
    assert.deepEqual(adopted.contents, [{ kind: 'kit', pin: envelope.pin }, ...envelope.dependencies.map(pin => ({ kind: 'bundle', pin }))])
    assert.equal(adopted.draft.confirmed, false)
    assert.equal(adopted.draft.revision, 0)
    assert.deepEqual(adopted.draft.mounts, envelope.dependencies)
    const saved = await call('studioKitDraftSave', { id: adopted.draft.id, expectedRevision: 0,
      mindsetSource: adopted.draft.mindsetSource + '\nIsolated imported method edit.\n', relationsSource: adopted.draft.relationsSource })
    const reopened = await createCompanionStudio({ name, version }, f.options.kitRoot, f.options.stateRoot)
    assert.deepEqual(await reopened.readKitDraft({ id: saved.id }), saved)
    const confirmation = await call('studioKitDraftConfirm', { id: saved.id, expectedRevision: 1 })
    assert.equal(confirmation.draft.confirmed, true)
    const again = await call('studioContentImportAdopt', { id: record.id })
    assert.notEqual(again.draft.id, saved.id)
    assert.equal(again.draft.baseSnapshot, saved.baseSnapshot)
    assert.equal(again.draft.revision, 0)

    const wrongMembers = resign({ ...envelope, dependencies: [] })
    const invalid = await call('studioContentImport', { source: JSON.stringify(wrongMembers) })
    assert.equal(invalid.validation.valid, false)
    // A stale/forged positive receipt cannot replace same-call definition checks.
    const forged = resign({ ...invalid, validation: { valid: true, diagnostics: [] } })
    await writeFile(join(f.options.stateRoot, 'studio-content-state', 'studio-content-imports', `${invalid.id}.json`), JSON.stringify(forged))
    await assert.rejects(call('studioContentImportAdopt', { id: invalid.id }), /member pins/)
    const bundleSource = await call('studioContentExport', { kind: 'bundle', pin: envelope.dependencies[0], provenance: envelope.provenance })
    const standalone = await call('studioContentImport', { source: bundleSource })
    assert.equal(standalone.validation.valid, true)
    const bundleAdopted = await call('studioContentImportAdopt', { id: standalone.id })
    assert.deepEqual(bundleAdopted, { importId: standalone.id, contents: [{ kind: 'bundle', pin: standalone.archive.pin }],
      executionGranted: false, requiresTrustReview: standalone.requiresTrustReview })
    assert.deepEqual(await call('studioContentImportAdopt', { id: standalone.id }), bundleAdopted, 'identical retained Bundle bytes are deduplicated')
    const bundleWorkspace = await call('studioBundle', standalone.archive.pin)
    assert.deepEqual(bundleWorkspace.diagnostics, [])
    assert.equal(bundleWorkspace.workspace.name, standalone.archive.pin.name)
    assert.equal(bundleWorkspace.workspace.version, standalone.archive.pin.version)

    // A different byte tree at the same exact Bundle pin is not silently adopted.
    const changedBundle = resign({ ...standalone.archive, files: standalone.archive.files.map(file => {
      if (file.path !== 'SKILL.md') return file
      const bytes = Buffer.concat([Buffer.from(file.base64, 'base64'), Buffer.from('\nChanged imported method.\n')])
      return { ...file, base64: bytes.toString('base64'), bytes: bytes.length, sha256: hash(bytes) }
    }) })
    const conflicting = await call('studioContentImport', { source: JSON.stringify(changedBundle) })
    assert.equal(conflicting.validation.valid, true)
    await assert.rejects(call('studioContentImportAdopt', { id: conflicting.id }), /different content|conflict/i)
    const retainedBundle = await call('studioFile', { ...standalone.archive.pin, path: 'SKILL.md' })
    assert.equal(retainedBundle.file.content, Buffer.from(standalone.archive.files.find(file => file.path === 'SKILL.md').base64, 'base64').toString('utf8'))
    await assert.rejects(call('studioContentImportAdopt', { id: '../escape' }), /identity/)
    assert.equal((await call('studioKitDraftList')).length, 2)
    assert.equal(await readFile(join(f.options.kitRoot, 'mindset.md'), 'utf8'), original)
    assert.equal(f.messages.length, 0, 'adoption never runs or notifies a native agent')
  } finally { await f.close() }
})
