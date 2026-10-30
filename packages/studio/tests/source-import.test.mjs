/** Real Core definitions over isolated retained S2 sources; no Host, project or model. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStudioInstances } from '../src/node/studio-instances.mjs'
import { createStudioDraftPorts } from '../src/node/studio-panel-drafts.mjs'
import { readStudioContentArchive } from '../src/content-archive.ts'
import { adapters, originalFiles, entry, textOf, pin } from '../../companion/test/fixtures/studio-changes-fixture.mjs'

async function fixture(t, ports = adapters()) {
  const stateRoot = await mkdtemp(join(tmpdir(), 'studio-source-import-'))
  t.after(() => rm(stateRoot, { recursive: true, force: true }))
  const options = { stateRoot, ...ports }
  return { options, service: await createStudioInstances(options) }
}
async function draft(service, record, changes) {
  const request = { id: record.id, expectedRevision: record.revision, changes }
  const candidate = await service.prepareChanges(request)
  for (const change of changes) assert.equal(candidate.diff.find(file => file.path === change.path)?.after, change.content,
    'candidate bytes must exactly match the editor request so the existing UI can enable save')
  assert.equal((await service.read(record.id)).revision, record.revision, 'preparation remains read-only')
  return service.saveChanges({ ...request, mode: 'draft', digest: candidate.digest })
}
const kitSources = (mounts = [{ bindingKey: pin.name, ...pin }]) => [
  entry('mindset.md', `---\nname: imported_kit\nversion: "1.0"\ndescription: Preserve supplied observations.\n---\n# Method\n\n<design_skills>\n## observations\nRecord supplied observations.\n</design_skills>\n`),
  entry('kit.yaml', JSON.stringify({ version: 1, mounts })),
]

test('bare SKILL imports without metadata; additions save in stages and readiness follows saved sources after reopen', async t => {
  const { service, options } = await fixture(t)
  let record = await service.importSources({ kind: 'bundle', files: [entry('SKILL.md', '# Human draft\r\nKeep my method.\r\n')] })
  assert.equal(record.revision, 0)
  assert.equal(record.readiness.ready, false)
  assert.deepEqual(record.readiness.diagnostics.map(item => item.path), ['skill.yaml', 'schema.yaml', 'validation.yaml'])
  assert.equal((await service.readFile({ id: record.id, path: 'SKILL.md' })).content, '# Human draft\r\nKeep my method.\r\n')
  const partial = readStudioContentArchive(await service.exportArchive({ id: record.id, expectedRevision: 0 }))
  assert.equal(partial.provenance, undefined)
  assert.equal(textOf(partial.files, 'SKILL.md'), '# Human draft\r\nKeep my method.\r\n')
  record = await draft(service, record, [{ path: 'skill.yaml', content: textOf(originalFiles, 'skill.yaml') }])
  assert.equal(record.readiness.ready, false)
  assert.deepEqual(record.readiness.diagnostics.map(item => item.path), ['schema.yaml', 'validation.yaml'])
  const missing = originalFiles.filter(file => !['skill.yaml', 'reference/preserved.bin'].includes(file.path))
  record = await draft(service, record, missing.map(file => ({ path: file.path, content: Buffer.from(file.base64, 'base64').toString('utf8') })))
  assert.equal(record.readiness.ready, false)
  assert.equal(record.readiness.diagnostics[0].code, 'instance.identity')
  assert.equal(record.readiness.diagnostics[0].path, 'skill.yaml')
  assert.match(record.readiness.diagnostics[0].message, new RegExp(record.bundle.name))
  assert.equal((await service.readFile({ id: record.id, path: 'skill.yaml' })).content, textOf(originalFiles, 'skill.yaml'),
    'saving an incomplete definition preserves the user text without inserting identity')
  record = await draft(service, record, [{ path: 'skill.yaml', content: `identity: ${record.bundle.name}\n` + textOf(originalFiles, 'skill.yaml') }])
  assert.deepEqual(record.readiness, { ready: true, diagnostics: [] })
  assert.equal(record.runtimeName, pin.name, 'a missing method header can be repaired without inventing a runtime name')
  assert.match((await service.readFile({ id: record.id, path: 'skill.yaml' })).content, new RegExp(record.bundle.name))
  const reopened = await createStudioInstances(options)
  assert.deepEqual((await reopened.read(record.id)).readiness, { ready: true, diagnostics: [] })
  assert.deepEqual((await reopened.list()).find(item => item.id === record.id).readiness, record.readiness)
  record = await reopened.saveFile({ id: record.id, expectedRevision: record.revision, path: 'schema.yaml', content: 'broken: [\n' })
  assert.equal(record.readiness.ready, false, 'readiness is recalculated, never an import-time flag')
  assert.equal(record.readiness.diagnostics[0].code, 'instance.definition')
})

test('same-name imports get independent catalog pins and labels, preserving runtime, original snapshot and all resource bytes', async t => {
  const { service, options } = await fixture(t)
  const first = await service.importSources({ kind: 'bundle', files: originalFiles })
  const second = await service.importSources({ kind: 'bundle', files: originalFiles })
  assert.notEqual(first.bundle.name, second.bundle.name)
  assert.notEqual(first.bundle.name, pin.name)
  assert.notEqual(first.title.en, 'Observations', 'the installed catalog label is already taken')
  assert.notEqual(first.title.en, second.title.en)
  assert.equal(first.runtimeName, pin.name)
  assert.equal(first.readiness.ready, true, JSON.stringify(first.readiness.diagnostics))
  assert.equal((await service.readFile({ id: first.id, path: 'SKILL.md' })).content, textOf(originalFiles, 'SKILL.md'))
  const archive = readStudioContentArchive(await service.exportArchive({ id: first.id, expectedRevision: first.revision }))
  for (const file of originalFiles.filter(file => file.path !== 'skill.yaml')) assert.equal(archive.files.find(item => item.path === file.path)?.base64, file.base64)
  assert.deepEqual((await adapters().catalog.captureBundle(pin)).files, originalFiles, 'installed sources are not overwritten')
  const { repository, sources } = await createStudioDraftPorts(options, 'instance')
  const stored = await repository.read(first.id), original = await sources.open(stored.importedFromSnapshot)
  assert.equal(await original.fs.readText(join(original.root, 'skill.yaml')), textOf(originalFiles, 'skill.yaml'))
  assert.equal(Object.hasOwn(first, 'importedFromSnapshot'), false)
})

test('definition readiness does not require a Panel, example or preview adapter', async t => {
  const ports = adapters()
  ports.composition.preview = async () => { throw Error('Readiness must not render a Panel.') }
  const { service } = await fixture(t, ports)
  const files = originalFiles.filter(file => ['SKILL.md', 'skill.yaml', 'schema.yaml', 'validation.yaml'].includes(file.path))
    .map(file => file.path === 'skill.yaml' ? entry(file.path, textOf(originalFiles, file.path).replace('mode: declarative', 'mode: none')) : file)
  const record = await service.importSources({ kind: 'bundle', files })
  assert.deepEqual(record.readiness, { ready: true, diagnostics: [] })
})

test('Kit import retains its exact bundled closure without global guessing and supports managed mount repair', async t => {
  const ports = adapters()
  let captures = 0
  ports.catalog.listBundles = async () => []
  ports.catalog.captureBundle = async () => { captures++; throw Error('No installed Bundle.') }
  const { service, options } = await fixture(t, ports)
  const closure = originalFiles.map(file => ({ ...file, path: `bundles/${pin.name}/${pin.version}/${file.path}` }))
  let record = await service.importSources({ kind: 'kit', files: [...kitSources(), ...closure] })
  assert.equal(captures, 0, 'a supplied exact mount never substitutes installed source')
  assert.equal(record.mounts[0].bundle.name, pin.name)
  assert.deepEqual(record.readiness, { ready: true, diagnostics: [] })
  assert.ok(!record.files.some(file => file.path.startsWith('bundles/')))
  const archive = readStudioContentArchive(await service.exportArchive({ id: record.id, expectedRevision: record.revision }))
  assert.equal(archive.files.find(file => file.path.endsWith('reference/preserved.bin')).base64, originalFiles.find(file => file.path.endsWith('.bin')).base64)
  const reopened = await createStudioInstances(options)
  assert.equal((await reopened.read(record.id)).readiness.ready, true)
  record = await service.importSources({ kind: 'kit', files: kitSources() })
  assert.equal(record.readiness.ready, false)
  assert.equal(record.readiness.diagnostics[0].code, 'instance.missing_mount')
  const method = await service.readFile({ id: record.id, path: 'mindset.md' })
  record = await service.saveFile({ id: record.id, expectedRevision: 0, path: 'mindset.md', content: method.content + '\nHuman correction.\n' })
  assert.equal(record.readiness.ready, false)
  await assert.rejects(service.prepareChanges({ id: record.id, expectedRevision: record.revision, changes: [{ path: 'kit.yaml', content: '{}' }] }), /mount management/)
  const local = await service.importSources({ kind: 'bundle', files: originalFiles })
  record = await service.updateMounts({ id: record.id, expectedRevision: record.revision, bundles: [{ ...local.bundle, instanceId: local.id, revision: local.revision, bindingKey: pin.name }] })
  assert.deepEqual(record.readiness, { ready: true, diagnostics: [] })
  assert.match((await service.readFile({ id: record.id, path: 'mindset.md' })).content, /Human correction/)
})

test('invalid Kit declaration is importable and repaired through existing mount management', async t => {
  const { service } = await fixture(t)
  let record = await service.importSources({ kind: 'kit', files: kitSources().map(file => file.path === 'kit.yaml' ? entry(file.path, 'mounts: [\n') : file) })
  assert.equal(record.readiness.ready, false)
  const archive = readStudioContentArchive(await service.exportArchive({ id: record.id, expectedRevision: 0 }))
  assert.equal(textOf(archive.files, 'kit.yaml'), 'mounts: [\n')
  record = await service.updateMounts({ id: record.id, expectedRevision: 0, bundles: [pin] })
  assert.deepEqual(record.readiness, { ready: true, diagnostics: [] })
  const partial = originalFiles.filter(file => ['SKILL.md', 'skill.yaml'].includes(file.path))
    .map(file => ({ ...file, path: `bundles/${pin.name}/${pin.version}/${file.path}` }))
  record = await service.importSources({ kind: 'kit', files: [...kitSources(), ...partial] })
  assert.equal(record.readiness.ready, false)
  record = await service.updateMounts({ id: record.id, expectedRevision: 0, bundles: [pin] })
  assert.deepEqual(record.readiness, { ready: true, diagnostics: [] }, 'explicit re-selection can repair an incomplete imported mount at the same exact pin')
})

test('minimal imported Kit saves exact mounts as a draft before its method catalog exists, then reopens and repairs normally', async t => {
  const { service, options } = await fixture(t)
  let record = await service.importSources({ kind: 'kit', files: [
    entry('mindset.md', '---\nname: minimal_kit\nversion: "1.0"\ndescription: Human method being authored.\n---\n# Human method\nPreserve this unfinished guidance.\n'),
    entry('kit.yaml', 'version: 1\nmounts: []\n'),
  ] })
  assert.equal(record.readiness.ready, false)
  const method = await service.readFile({ id: record.id, path: 'mindset.md' })
  record = await service.updateMounts({ id: record.id, expectedRevision: 0, bundles: [pin] })
  assert.equal(record.revision, 1)
  assert.equal(record.mounts[0].bindingKey, pin.name)
  assert.equal(record.mounts[0].bundle.name, pin.name)
  assert.equal(record.mounts[0].bundle.version, pin.version)
  assert.equal(record.readiness.ready, false, 'saving mounts is not complete-method validation')
  assert.match(record.readiness.diagnostics[0].message, /design_skills/)
  assert.match(record.readiness.diagnostics[0].message, /mindset.md.*尚未完善/)
  assert.doesNotMatch(record.readiness.diagnostics[0].message, new RegExp(record.kit.name))
  const candidate = await service.prepareChanges({ id: record.id, expectedRevision: 1,
    changes: [{ path: 'mindset.md', content: method.content + '\nMore human guidance.\n' }] })
  assert.equal(candidate.valid, false)
  assert.equal(candidate.diagnostics[0].subject, 'mindset.md')
  assert.doesNotMatch(candidate.diagnostics[0].message, new RegExp(record.kit.name))
  assert.equal((await service.readFile({ id: record.id, path: 'mindset.md' })).content, method.content,
    'mount repair preserves the unfinished human method without inventing catalog prose')
  const reopened = await createStudioInstances(options)
  assert.deepEqual((await reopened.read(record.id)).mounts, record.mounts)
  assert.equal((await reopened.read(record.id)).readiness.ready, false)
  assert.match((await reopened.readFile({ id: record.id, path: 'kit.yaml' })).content, /bindingKey: observations/)
  const archive = readStudioContentArchive(await reopened.exportArchive({ id: record.id, expectedRevision: 1 }))
  assert.equal(archive.files.find(file => file.path.endsWith('reference/preserved.bin')).base64,
    originalFiles.find(file => file.path.endsWith('.bin')).base64)
  record = await reopened.saveFile({ id: record.id, expectedRevision: 1, path: 'mindset.md',
    content: method.content + '\n<design_skills>\n## observations\nRecord supplied observations.\n</design_skills>\n' })
  assert.deepEqual(record.readiness, { ready: true, diagnostics: [] })
  const empty = await reopened.updateMounts({ id: record.id, expectedRevision: record.revision, bundles: [] })
  assert.equal(empty.mounts.length, 0)
  assert.equal(empty.revision, record.revision + 1)
  assert.equal(empty.readiness.ready, false)
})

test('Bundle preparation and preview pinpoint manifest identity and version while preserving candidate source bytes', async t => {
  const { service, options } = await fixture(t)
  let record = await service.importSources({ kind: 'bundle', files: originalFiles.filter(file => file.path === 'SKILL.md') })
  const changes = originalFiles.filter(file => !['SKILL.md', 'reference/preserved.bin'].includes(file.path))
    .map(file => ({ path: file.path, content: Buffer.from(file.base64, 'base64').toString('utf8') }))
  const request = { id: record.id, expectedRevision: 0, changes }
  const candidate = await service.prepareChanges(request)
  assert.equal(candidate.valid, false)
  assert.equal(candidate.diagnostics[0].code, 'instance.identity')
  assert.equal(candidate.diagnostics[0].subject, 'skill.yaml')
  assert.match(candidate.diagnostics[0].message, new RegExp(record.bundle.name))
  assert.equal(candidate.diff.find(file => file.path === 'skill.yaml').after, changes.find(file => file.path === 'skill.yaml').content)
  assert.equal((await service.read(record.id)).revision, 0)
  record = await service.saveChanges({ ...request, mode: 'draft', digest: candidate.digest })
  const reopened = await createStudioInstances(options)
  assert.equal((await reopened.preview({ id: record.id, expectedRevision: record.revision })).diagnostics[0].subject, 'skill.yaml')
  const fixed = { id: record.id, expectedRevision: record.revision, changes: [{ path: 'skill.yaml',
    content: `identity: ${record.bundle.name}\n` + textOf(originalFiles, 'skill.yaml') }] }
  assert.equal((await reopened.prepareChanges(fixed)).valid, true)
  const wrongVersion = await reopened.prepareChanges({ ...fixed,
    changes: [{ path: 'skill.yaml', content: fixed.changes[0].content.replace('version: "1.0"', 'version: "9.0"') }] })
  assert.equal(wrongVersion.valid, true, JSON.stringify(wrongVersion.diagnostics))
})

test('missing import core rejects while malformed optional definitions remain editable; existing bounds and CAS still apply', async t => {
  const { service } = await fixture(t)
  await assert.rejects(service.importSources({ kind: 'bundle', files: [entry('schema.yaml', '{}')] }), /SKILL.md/)
  await assert.rejects(service.importSources({ kind: 'kit', files: [entry('mindset.md', '# method')] }), /kit.yaml/)
  await assert.rejects(service.importSources({ kind: 'bundle', files: [entry('SKILL.md', '# method'), entry('../bad', '')] }), /path/)
  await assert.rejects(service.importSources({ kind: 'bundle', files: [entry('SKILL.md', '# method'), entry('a', ''), entry('a/b', '')] }), /conflicts/)
  let record = await service.importSources({ kind: 'bundle', files: [...originalFiles.filter(file => file.path !== 'skill.yaml'), entry('skill.yaml', 'name: [\n')] })
  assert.equal(record.readiness.ready, false)
  record = await draft(service, record, [{ path: 'skill.yaml', content: `identity: ${record.bundle.name}\n` + textOf(originalFiles, 'skill.yaml') }])
  assert.equal(record.readiness.ready, true)
  await assert.rejects(service.exportArchive({ id: record.id, expectedRevision: 0 }), /revision changed/)
  await assert.rejects(service.prepareChanges({ id: record.id, expectedRevision: 0, changes: [{ path: 'reference/new.md', content: 'stale' }] }), /changed elsewhere/)
  const copy = await service.copy({ kind: 'bundle', sourceId: record.id, expectedRevision: record.revision })
  assert.equal(copy.readiness.ready, true)
})


const conversationSources = (record, presentation = { mode: 'none' }) => [
  { path: 'skill.yaml', content: `identity: ${record.bundle.name}\nname: grill-me\nversion: "1.0"\ntitle: {zh: 对话方法, en: Conversation method}\nlabel: {zh: 对话方法, en: Conversation method}\nexecution: {mode: main, handoff: none}\n` + (presentation === null ? '' : `presentation: ${JSON.stringify(presentation)}\n`) },
  { path: 'schema.yaml', content: 'type: object\nproperties:\n  topic: {type: string}\n' },
  { path: 'validation.yaml', content: 'skill: grill-me\nrules:\n  - id: topic\n    scope: [completion]\n    code: grill-me.topic\n    message: Supply a topic.\n    check: {non_empty_string: topic}\n' },
]
const conversationMethod = '---\nname: grill-me\ndescription: Ask useful questions without rewriting the supplied method.\n---\n# My original method\nPreserve the exact wording.\n'

test('import retains a Core-compatible hyphenated runtime name and exact method bytes', async t => {
  const { service, options } = await fixture(t)
  const record = await service.importSources({ kind: 'bundle', files: [entry('SKILL.md', conversationMethod)] })
  assert.equal(record.runtimeName, 'grill-me')
  assert.notEqual(record.bundle.name, record.runtimeName)
  assert.equal((await service.readFile({ id: record.id, path: 'SKILL.md' })).content, conversationMethod)
  const reopened = await createStudioInstances(options)
  assert.equal((await reopened.read(record.id)).runtimeName, 'grill-me')
})

test('a no-panel definition prepares and explicitly saves without Panel/sample validation', async t => {
  for (const presentation of [{ mode: 'none' }, null]) {
    const { service, options } = await fixture(t)
    const record = await service.importSources({ kind: 'bundle', files: [entry('SKILL.md', conversationMethod)] })
    const changes = conversationSources(record, presentation)
    const request = { id: record.id, expectedRevision: record.revision, changes, bundle: record.bundle }
    const candidate = await service.prepareChanges(request)
    assert.equal(candidate.valid, true, JSON.stringify(candidate.diagnostics))
    assert.equal(candidate.preview, undefined, 'a conversation method has no fabricated Panel preview')
    assert.equal((await service.read(record.id)).revision, record.revision)
    for (const change of changes) assert.equal(candidate.diff.find(file => file.path === change.path).after, change.content)
    const saved = await service.saveChanges({ ...request, mode: 'validated', digest: candidate.digest })
    assert.equal(saved.changeReceipt.validation, 'definition_passed')
    assert.deepEqual(saved.readiness, { ready: true, diagnostics: [] })
    assert.equal(saved.runtimeName, 'grill-me')
    const reopened = await createStudioInstances(options)
    assert.equal((await reopened.readFile({ id: saved.id, path: 'SKILL.md' })).content, conversationMethod)
    for (const change of changes) assert.equal((await reopened.readFile({ id: saved.id, path: change.path })).content, change.content)
    const copy = await reopened.copy({ sourceId: saved.id, expectedRevision: saved.revision, kind: 'bundle' })
    assert.equal(copy.runtimeName, 'grill-me')
    assert.equal((await reopened.readFile({ id: copy.id, path: 'SKILL.md' })).content, conversationMethod)
    assert.deepEqual(await reopened.preview({ id: saved.id, expectedRevision: saved.revision }), { diagnostics: [] })
    delete options.composition.preview
    assert.deepEqual(await reopened.preview({ id: saved.id, expectedRevision: saved.revision }), { diagnostics: [] },
      'no-panel reading uses Core definition validation without a Panel adapter')
    const broken = await reopened.saveFile({ id: saved.id, expectedRevision: saved.revision, path: 'schema.yaml', content: 'type: [\n' })
    const invalidView = await reopened.preview({ id: broken.id, expectedRevision: broken.revision })
    assert.equal(invalidView.preview, undefined)
    assert.ok(invalidView.diagnostics.length > 0, 'reopening invalid no-panel source still reports real Core diagnostics')
    await assert.rejects(reopened.preview({ id: broken.id, expectedRevision: saved.revision }), /changed elsewhere/)
  }
})

test('no-panel validated saves retain identity, definition, digest and stale-revision guards', async t => {
  const { service } = await fixture(t)
  const record = await service.importSources({ kind: 'bundle', files: [entry('SKILL.md', conversationMethod)] })
  const changes = conversationSources(record)
  const request = { id: record.id, expectedRevision: record.revision, changes }
  for (const replacements of [
    changes.map(file => file.path === 'skill.yaml' ? { ...file, content: file.content.replace(record.bundle.name, 'wrong_identity') } : file),
    changes.map(file => file.path === 'schema.yaml' ? { ...file, content: 'type: [\n' } : file),
    changes.map(file => file.path === 'validation.yaml' ? { ...file, content: 'skill: grill-me\nrules: []\n' } : file),
    changes.filter(file => file.path !== 'schema.yaml'),
  ]) {
    const invalidRequest = { ...request, changes: replacements }
    const invalid = await service.prepareChanges(invalidRequest)
    assert.equal(invalid.valid, false)
    await assert.rejects(service.saveChanges({ ...invalidRequest, mode: 'validated', digest: invalid.digest }))
  }
  const candidate = await service.prepareChanges(request)
  assert.equal(candidate.valid, true, JSON.stringify(candidate.diagnostics))
  await assert.rejects(service.saveChanges({ ...request, mode: 'validated', digest: 'a'.repeat(64) }), /digest/)
  await service.saveChanges({ ...request, mode: 'validated', digest: candidate.digest })
  await assert.rejects(service.saveChanges({ ...request, mode: 'validated', digest: candidate.digest }), /changed elsewhere/)
})


test('no-panel support does not bypass declarative/native/auto preview requirements', async t => {
  const { service } = await fixture(t)
  const record = await service.importSources({ kind: 'bundle', files: [entry('SKILL.md', conversationMethod)] })
  for (const presentation of [{ mode: 'declarative' }, { mode: 'auto' }, { mode: 'native', renderer: 'test.native/v1' }]) {
    const request = { id: record.id, expectedRevision: record.revision, changes: conversationSources(record, presentation) }
    const candidate = await service.prepareChanges(request)
    assert.equal(candidate.valid, false, JSON.stringify(presentation))
    await assert.rejects(service.saveChanges({ ...request, mode: 'validated', digest: candidate.digest }))
  }
  const request = { id: record.id, expectedRevision: record.revision, changes: [...conversationSources(record), { path: 'panel.yaml', content: textOf(originalFiles, 'panel.yaml') }] }
  assert.equal((await service.prepareChanges(request)).valid, false, 'Core still rejects a contradictory no-panel declaration with Panel source')
})
