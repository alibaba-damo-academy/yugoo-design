/** Finite source fixtures, real retained storage and Core; no development Kit, Host or model. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStudioInstances } from '../src/node/studio-instances.mjs'
import { createStudioAuthoring } from '../src/node/studio-authoring.mjs'
import { adapters, originalFiles, entry, pin } from '../../companion/test/fixtures/studio-changes-fixture.mjs'

const kitFiles = [entry('mindset.md', '---\nname: fixture_kit\nversion: "1.0"\n---\nPreserve confirmed evidence.\n<design_skills>\n## observations\nRecord observations.\n</design_skills>\n'),
  entry('kit.yaml', 'version: 1\nmounts:\n  - {bindingKey: observations, name: observations, version: "1.0"}\n')]
const components = () => ({ components: [{ name: 'record_form' }] })
const authoring = (instances, record) => createStudioAuthoring({ instances, readComponents: components,
  scope: { id: record.id, expectedRevision: record.revision, allowedPaths: ['mindset.md'] } })
async function fixture(t) {
  const stateRoot = await mkdtemp(join(tmpdir(), 'studio-mounted-authoring-'))
  t.after(() => rm(stateRoot, { recursive: true, force: true }))
  const options = { stateRoot, ...adapters() }, instances = await createStudioInstances(options)
  return { stateRoot, options, instances }
}

test('Kit author discovers and reads a local mount current save while preparing only Kit source', async t => {
  const { stateRoot, instances } = await fixture(t)
  const bundle = await instances.copy({ kind: 'bundle', bundle: pin })
  const blank = await instances.create({ kind: 'kit', title: { zh: '证据工作台', en: 'Evidence workspace' } })
  const kit = await instances.updateMounts({ id: blank.id, expectedRevision: blank.revision, bundles: [{ ...bundle.bundle, bindingKey: 'observations', instanceId: bundle.id }] })
  const original = await instances.readFile({ id: bundle.id, path: 'SKILL.md' })
  await instances.saveFile({ id: bundle.id, expectedRevision: original.revision, path: original.path, content: original.content + '\nCURRENT_SAVED_BUNDLE_METHOD\n' })
  const before = await Promise.all([kit.id, bundle.id].map(id => readFile(join(stateRoot, 'studio-instance-drafts', id + '.json'))))
  const api = authoring(instances, kit), own = await api.read()
  assert.equal(own.scope.bundle, undefined, 'dependency reads do not select a preview Bundle')
  assert.deepEqual(own.mounts, [{ bindingKey: 'observations', bundle: bundle.bundle }])
  assert.ok(own.availableFiles.some(file => file.path === 'kit.yaml'))
  const index = await api.read({ mount: { bindingKey: own.mounts[0].bindingKey } })
  assert.deepEqual(index.files, []); assert.equal(index.mountedBundle.readOnly, true)
  assert.ok(index.mountedBundle.availableFiles.some(file => file.path === 'SKILL.md' && file.readable))
  const current = await api.read({ mount: { bindingKey: 'observations', paths: ['SKILL.md', 'reference/absent.md'] } })
  assert.match(current.files[0].content, /CURRENT_SAVED_BUNDLE_METHOD/)
  assert.deepEqual(current.files[1], { path: 'reference/absent.md', exists: false })
  assert.equal(current.mountedBundle.files, undefined, 'text is returned once within the bounded tool receipt')
  const method = own.files[0].content
  const prepared = await api.prepare({ changes: [{ path: 'mindset.md', content: method + '\nPreserve the confirmed method.\n' }] })
  assert.equal(prepared.request.id, kit.id); assert.equal(prepared.request.bundle, undefined)
  assert.deepEqual(prepared.request.changes.map(file => file.path), ['mindset.md'])
  assert.deepEqual(await Promise.all([kit.id, bundle.id].map(id => readFile(join(stateRoot, 'studio-instance-drafts', id + '.json')))), before, 'reads and prepare never save either source')
})

test('imported Kit reads its supplied snapshot with no installed catalog or extracted Bundle copy', async t => {
  const { options } = await fixture(t)
  options.catalog.listBundles = async () => []
  options.catalog.captureBundle = async () => { throw new Error('No installed Bundle catalog') }
  const instances = await createStudioInstances(options)
  const closure = originalFiles.map(file => ({ ...file, path: `bundles/${pin.name}/${pin.version}/${file.path}` }))
  const kit = await instances.importSources({ kind: 'kit', files: [...kitFiles, ...closure] })
  assert.equal(kit.mounts[0].bundle.instanceId, undefined)
  assert.ok(kit.mounts[0].bundle.source.snapshot)
  const result = await authoring(instances, kit).read({ mount: { bindingKey: 'observations', paths: ['SKILL.md', 'panel.yaml'] } })
  assert.match(result.files[0].content, /Preserve observation text/)
  assert.match(result.files[1].content, /component: record_form/)
  assert.equal((await instances.list({ kind: 'bundle' })).length, 0)
})

test('unmounted sources, binary text and authority overrides are rejected; missing files remain explicit', async t => {
  const { instances } = await fixture(t)
  const kit = await instances.importSources({ kind: 'kit', files: [...kitFiles, ...originalFiles.map(file => ({ ...file, path: `bundles/${pin.name}/${pin.version}/${file.path}` }))] })
  const api = authoring(instances, kit)
  await assert.rejects(api.read({ mount: { bindingKey: 'unmounted', paths: ['SKILL.md'] } }), /mounted by this Kit/)
  await assert.rejects(api.read({ mount: { bindingKey: 'observations', paths: ['reference/preserved.bin'] } }), /UTF-8 text/)
  await assert.rejects(api.read({ mount: { bindingKey: 'observations', paths: ['../SKILL.md'] } }))
  await assert.rejects(api.read({ mount: { bindingKey: 'observations', id: 'other' } }), /authority/)
  await assert.rejects(api.read({ paths: ['mindset.md'], mount: { bindingKey: 'observations' } }), /separately/)
  await assert.rejects(api.prepare({ id: 'other', changes: [{ path: 'SKILL.md', content: 'overwrite mount' }] }), /authority/)
  const missing = await instances.importSources({ kind: 'kit', files: kitFiles.map(file => file.path === 'kit.yaml' ? entry(file.path, 'version: 1\nmounts:\n  - {bindingKey: absent, name: absent, version: "1.0"}\n') : file) })
  const unavailable = await authoring(instances, missing).read({ mount: { bindingKey: 'absent', paths: ['SKILL.md'] } })
  assert.deepEqual(unavailable.files, [{ path: 'SKILL.md', exists: false }], 'an incomplete imported mount retains an explicit missing file without substituting a catalog method')
})

test('a changed Kit revision during a dependency read cannot return a stale bound receipt', async t => {
  const { instances } = await fixture(t)
  const kit = await instances.importSources({ kind: 'kit', files: [...kitFiles, ...originalFiles.map(file => ({ ...file, path: `bundles/${pin.name}/${pin.version}/${file.path}` }))] })
  const api = authoring({ ...instances, async readMountedBundle(input) {
    const result = await instances.readMountedBundle(input)
    const saved = await instances.readFile({ id: kit.id, path: 'mindset.md' })
    await instances.saveFile({ id: kit.id, expectedRevision: saved.revision, path: saved.path, content: saved.content + '\nHuman edit.\n' })
    return result
  } }, kit)
  await assert.rejects(api.read({ mount: { bindingKey: 'observations', paths: ['SKILL.md'] } }), /Reopen/)
})
