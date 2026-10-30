import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStudioInstances } from '../src/node/studio-instances.mjs'
import { ensureProjectKit } from '../../core/src/project-kit-source.ts'
import { adapters, originalFiles, entry, pin, textOf } from '../../companion/test/fixtures/studio-changes-fixture.mjs'
const kitPin = { name: 'observations_kit', version: '1.0' }
const kitFiles = [
  entry('mindset.md', '---\nname: observations_kit\nversion: "1.0"\n---\nInspect evidence.\n<design_skills>\n## observations\nRecord evidence.\n</design_skills>\n'),
  entry('kit.yaml', 'version: 1\nmounts:\n  - {bindingKey: observations, name: observations, version: "1.0"}\n'),
]
async function fixture(t) {
  const stateRoot = await mkdtemp(join(tmpdir(), 'studio-current-'))
  t.after(() => rm(stateRoot, { recursive: true, force: true }))
  const options = { stateRoot, ...adapters({ captureKit: async () => ({ files: kitFiles }) }) }
  return { stateRoot, options, service: await createStudioInstances(options) }
}

test('catalog editing materializes same identity once; copy is explicitly independent', async t => {
  const { service, options } = await fixture(t)
  let current = await service.editCurrent({ kind: 'bundle', bundle: pin })
  assert.equal(current.current, true)
  assert.equal(current.bundle.name, pin.name)
  assert.equal((await service.editCurrent({ kind: 'bundle', bundle: { ...pin, version: '99.0' } })).id, current.id)
  const copy = await service.copy({ kind: 'bundle', sourceId: current.id, expectedRevision: 0 })
  assert.notEqual(copy.bundle.name, current.bundle.name)
  assert.notEqual(copy.sourceId, current.sourceId)
  current = await service.saveFile({ id: current.id, expectedRevision: 0, path: 'SKILL.md', content: textOf(originalFiles, 'SKILL.md') + '\nHuman original edit.\n' })
  const reopened = await createStudioInstances(options)
  assert.match((await reopened.readFile({ id: current.id, path: 'SKILL.md' })).content, /Human original edit/)
  assert.doesNotMatch((await reopened.readFile({ id: copy.id, path: 'SKILL.md' })).content, /Human original edit/)
  assert.equal((await reopened.listBundles()).filter(x => x.name === pin.name).length, 1)
  await assert.rejects(reopened.saveFile({ id: current.id, expectedRevision: 0, path: 'SKILL.md', content: 'stale' }), /changed elsewhere/)
})

test('Kit follows current Bundle edits; project receives a complete independent copy from S2 memory sources', async t => {
  const { service, stateRoot } = await fixture(t)
  const kit = await service.editCurrent({ kind: 'kit', kit: kitPin })
  const bundle = await service.editCurrent({ kind: 'bundle', bundle: pin })
  const old = await service.loadKit({ id: kit.id })
  const project = join(stateRoot, 'project'); await mkdir(project)
  const saved = await ensureProjectKit(project, { loadSource: () => service.loadKit({ id: kit.id }) })
  assert.deepEqual(await readFile(join(saved.kit.skills[0].resourceRoot, 'reference/preserved.bin')), Buffer.from([0,255,128,10]))
  await service.saveFile({ id: bundle.id, expectedRevision: bundle.revision, path: 'SKILL.md', content: textOf(originalFiles, 'SKILL.md') + '\nCurrent library instruction.\n' })
  assert.doesNotMatch(old.skills[0].content, /Current library instruction/)
  assert.match((await service.loadKit({ id: kit.id })).skills[0].content, /Current library instruction/)
  assert.doesNotMatch((await ensureProjectKit(project, { loadSource: () => service.loadKit({ id: kit.id }) })).kit.skills[0].content, /Current library instruction/)
  const empty = await service.updateMounts({ id: kit.id, expectedRevision: kit.revision, bundles: [] })
  assert.equal(empty.mounts.length, 0)
  await assert.rejects(service.loadKit({ id: kit.id }), /mount|catalog|Bundle/i)
})


test('a missing imported dependency stays visible while other mounts save', async t => {
  const { service } = await fixture(t)
  const missing = { name: 'missing_dependency', version: '1.0' }
  const record = await service.importSources({ kind: 'kit', files: kitFiles.map(file => entry(file.path, textOf(kitFiles, file.path).replaceAll('observations', 'missing_dependency'))) })
  assert.equal(record.readiness.ready, false)
  const saved = await service.updateMounts({ id: record.id, expectedRevision: record.revision, bundles: [{ ...missing, bindingKey: missing.name }, { ...pin, bindingKey: pin.name }] })
  assert.equal(saved.mounts.length, 2)
  assert.equal(saved.readiness.ready, false)
  assert.match((await service.readFile({ id: saved.id, path: 'kit.yaml' })).content, /missing_dependency/)
})

test('metadata discovery includes incomplete saved Kits without loading or validating mounted definitions', async t => {
  const { service, options } = await fixture(t)
  const record = await service.importSources({ kind: 'kit', files: kitFiles.map(file => entry(file.path, textOf(kitFiles, file.path).replaceAll('observations', 'missing_dependency'))) })
  await service.importSources({ kind: 'kit', files: [...kitFiles, ...originalFiles.map(file => ({ ...file, path: `bundles/${pin.name}/${pin.version}/${file.path}` }))] })
  let validations = 0
  const original = options.composition.validateKit
  options.composition.validateKit = async (...args) => { validations++; return original(...args) }
  const reopened = await createStudioInstances(options)
  const metadata = await reopened.list({ kind: 'kit', includeReadiness: false })
  const incomplete = metadata.find(item => item.id === record.id)
  assert.equal(incomplete.kit.name, record.kit.name)
  assert.ok(metadata.every(item => item.readiness === undefined))
  assert.equal(validations, 0)
  assert.equal((await reopened.list({ kind: 'kit' })).find(item => item.id === record.id).readiness.ready, false)
  assert.ok(validations > 0, 'the normal UI list still diagnoses incomplete content')
  await assert.rejects(reopened.loadKit({ id: record.id }), /missing|source|skill|schema|Bundle|manifest/i)
})
