/** Local transport/staging/adoption proof. No browser, model or publication. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile, readdir, lstat, mkdtemp, mkdir, symlink, chmod, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { join, sep } from 'node:path'
import { fixture } from './fixture.mjs'
import { callCompanion } from '../src/connection-file.mjs'
import { createCompanionStudio } from '../src/studio.mjs'
import { createStudioContentArchives } from '../src/studio-content-archive.mjs'

const hash = value => createHash('sha256').update(value).digest('hex')
const resign = value => { const { sha256, ...data } = value; return { ...data, sha256: hash(JSON.stringify(data)) } }
const directoryLink = process.platform === 'win32' ? 'junction' : 'dir'

test('authenticated archive storage accepts a trusted parent-directory alias without weakening noLinks', async () => {
  const temporary = await realpath(await mkdtemp(join(tmpdir(), 'studio-archive-parent-alias-')))
  let f
  try {
    const parent = join(temporary, 'physical'), alias = join(temporary, 'alias')
    await mkdir(parent); await symlink(parent, alias, directoryLink)
    const physicalState = join(parent, 'state'), stateRoot = join(alias, 'state')
    await mkdir(physicalState, { mode: 0o755 })
    const stateMode = (await lstat(physicalState)).mode
    f = await fixture({ serverOptions: { stateRoot } })
    const call = (method, params = {}) => callCompanion(f.server.connectionPath, { method, params })
    assert.equal(f.root, await realpath(f.root), 'the fixture owns canonical source roots')
    assert.equal((await lstat(alias)).isSymbolicLink(), true)
    assert.deepEqual(await call('studioContentImportList'), [])
    const installed = f.server.project.installedKit
    assert.equal(installed.sourceRoot, await realpath(installed.sourceRoot))
    for (const skill of installed.skills) assert.equal(skill.resourceRoot, await realpath(skill.resourceRoot))
    const source = await call('studioContentExport', { kind: 'kit', pin: { name: installed.name, version: String(installed.version) },
      provenance: { source: 'synthetic parent alias test', license: 'Apache-2.0' } })
    const imported = await call('studioContentImport', { source })
    assert.equal(imported.validation.valid, true)
    assert.equal(imported.executionGranted, false)
    assert.deepEqual(await call('studioContentImportRead', { id: imported.id }), imported)
    const reopened = await createCompanionStudio(installed, f.options.kitRoot, stateRoot)
    assert.deepEqual(await reopened.readContentImport({ id: imported.id }), imported)
    assert.equal((await call('studioContentImportList')).length, 1)
    assert.equal((await lstat(physicalState)).mode, stateMode, 'normalization never repairs host directory permissions')
    const privateRoot = join(stateRoot, 'studio-content-state')
    assert.equal(await realpath(privateRoot), await realpath(join(physicalState, 'studio-content-state')))
    // Only the trusted caller normalizes its root. Direct storage callers still
    // cannot supply a path containing a symlink, including this same parent alias.
    await assert.rejects(createStudioContentArchives({ stateRoot: privateRoot, kitRoot: f.options.kitRoot,
      readInstalledKit: () => installed }), /symlink|canonical/)
    assert.equal(f.messages.length, 0)
  } finally { if (f) await f.close(); await rm(temporary, { recursive: true, force: true }) }
})

test('archive caller rejects state leaf symlinks including trailing separators and regular files', async () => {
  const f = await fixture()
  try {
    const target = join(f.root, 'leaf-target'), alias = join(f.root, 'state-link')
    await mkdir(target, { mode: 0o700 }); await symlink(target, alias, directoryLink)
    const open = async path => (await createCompanionStudio(f.server.project.installedKit, f.options.kitRoot, path)).listContentImports()
    for (const path of [alias, alias + sep]) await assert.rejects(open(path), /existing canonical directory/)
    assert.deepEqual(await readdir(target), [], 'a rejected leaf link never creates private archive storage in its target')
    const file = join(f.root, 'state-file'); await writeFile(file, 'unchanged')
    await assert.rejects(open(file), /existing canonical directory/)
    assert.equal(await readFile(file, 'utf8'), 'unchanged')
  } finally { await f.close() }
})

test('normalized archive roots retain private-child link and permission rejection without repairs', async () => {
  const f = await fixture()
  try {
    const stateRoot = join(f.root, 'private-state'), target = join(f.root, 'private-target')
    await mkdir(stateRoot); await mkdir(target, { mode: 0o700 })
    const privateRoot = join(stateRoot, 'studio-content-state')
    await symlink(target, privateRoot, directoryLink)
    const open = async () => (await createCompanionStudio(f.server.project.installedKit, f.options.kitRoot, stateRoot)).listContentImports()
    await assert.rejects(open(), /symlink/)
    assert.deepEqual(await readdir(target), [])
    await rm(privateRoot); await mkdir(privateRoot, { mode: 0o700 })
    if (process.platform !== 'win32') {
      await chmod(privateRoot, 0o755)
      await assert.rejects(open(), /private owned directory/)
      assert.equal((await lstat(privateRoot)).mode & 0o777, 0o755)
    }
  } finally { await f.close() }
})

test('archive Kit nesting checks use canonical roots in both directions through a parent alias', async () => {
  const f = await fixture()
  try {
    const alias = join(f.root, 'parent-alias'); await symlink(f.root, alias, directoryLink)
    const installed = f.server.project.installedKit
    const nestedState = join(alias, 'kit')
    const withinKit = await createCompanionStudio(installed, f.options.kitRoot, nestedState)
    await assert.rejects(withinKit.listContentImports(), /must not be nested/)
    await assert.rejects(lstat(join(f.options.kitRoot, 'studio-content-state')), { code: 'ENOENT' })
    const stateRoot = join(f.root, 'reverse-state'), nestedKit = join(stateRoot, 'studio-content-state', 'kit')
    await mkdir(nestedKit, { recursive: true })
    const withinState = await createCompanionStudio({ ...installed, sourceRoot: nestedKit }, nestedKit, join(alias, 'reverse-state'))
    await assert.rejects(withinState.listContentImports(), /must not be nested/)
    assert.deepEqual(await readdir(nestedKit), [])
  } finally { await f.close() }
})

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
