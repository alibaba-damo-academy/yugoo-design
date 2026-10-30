import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStudioInstances } from '../src/node/studio-instances.mjs'
import { createStudioInstanceAdapters } from '../src/node/studio-instance-composition.mjs'
import { createStudioDraftPorts } from '../src/node/studio-panel-drafts.mjs'
import { ensureProjectKit } from '../../core/src/project-kit-source.ts'
import { originalFiles, entry, textOf, pin } from '../../companion/test/fixtures/studio-changes-fixture.mjs'

const kit = { name: 'current_mount_fixture', version: '1.0' }
const kitFiles = [
  entry('mindset.md', '---\nname: current_mount_fixture\nversion: "1.0"\n---\n<design_skills>\n## observations\nRecord supplied evidence.\n## research\nRead current research.\n</design_skills>\n'),
  entry('kit.yaml', 'version: 1\nmounts:\n  - {bindingKey: observations, name: observations, version: "1.0"}\n  - {bindingKey: research, name: research, version: "1.1"}\n'),
]
function researchFiles(version) {
  return originalFiles.map(file => file.path === 'reference/preview.json' ? entry(file.path, JSON.stringify({ items: { item_01: { title: 'Research sample ' + version, status: 'open' } } })) : file.path.endsWith('.bin') ? file : entry(file.path,
    textOf(originalFiles, file.path).replaceAll('observations', 'research').replaceAll('Observations', 'Research').replaceAll('观察记录', '调研')
      .replace('version: "1.0"', 'version: "' + version + '"') + (file.path === 'SKILL.md' ? '\nResearch source ' + version + '.\n' : '')))
}
async function fixture(t) {
  const stateRoot = await mkdtemp(join(tmpdir(), 'studio-current-mount-'))
  t.after(() => rm(stateRoot, { recursive: true, force: true }))
  const old = researchFiles('1.0'), current = researchFiles('1.1')
  const captures = []
  const captureBundle = async requested => {
    captures.push({ ...requested })
    if (requested.name === pin.name) return { files: originalFiles, sourceId: 'trusted:mount-fixture' }
    if (requested.name === 'research' && ['1.0', '1.1'].includes(requested.version)) return { files: requested.version === '1.0' ? old : current, sourceId: 'trusted:mount-fixture' }
    throw new Error('Unavailable declared source.')
  }
  const adapters = createStudioInstanceAdapters({
    listBundles: async () => [pin, { name: 'research', version: '1.0' }, { name: 'research', version: '1.1' }],
    captureKit: async () => ({ files: kitFiles }),
    captureBundle,
  })
  const options = { stateRoot, ...adapters }, service = await createStudioInstances(options)
  const questions = await service.editCurrent({ kind: 'bundle', bundle: pin })
  await service.saveFile({ id: questions.id, expectedRevision: questions.revision, path: 'SKILL.md', content: textOf(originalFiles, 'SKILL.md') + '\n<!-- CURRENT_CONTENT_UI -->\n' })
  return { stateRoot, options, service, adapters, old, captures, captureBundle }
}

test('first Kit activation preserves its declared source when the catalog also contains an older version', async t => {
  const f = await fixture(t)
  const selected = await f.service.editCurrent({ kind: 'kit', kit })
  assert.equal(selected.mounts.find(mount => mount.bundle.name === 'research').bundle.version, '1.1')
  const loaded = await f.service.loadKit({ id: selected.id, expectedRevision: selected.revision })
  assert.match(loaded.skills.find(skill => skill.name === pin.name).content, /CURRENT_CONTENT_UI/)
  assert.match(loaded.skills.find(skill => skill.name === 'research').content, /Research source 1\.1/)
  const project = join(f.stateRoot, 'project'); await mkdir(project)
  const saved = await ensureProjectKit(project, { loadSource: () => f.service.loadKit({ id: selected.id }) })
  assert.match(await readFile(join(saved.kit.skills.find(skill => skill.name === pin.name).resourceRoot, 'SKILL.md'), 'utf8'), /CURRENT_CONTENT_UI/)
  assert.match(await readFile(join(saved.kit.skills.find(skill => skill.name === 'research').resourceRoot, 'SKILL.md'), 'utf8'), /Research source 1\.1/)
})

test('an already captured current Kit uses its authoritative declaration without rewriting the saved source record', async t => {
  const f = await fixture(t), selected = await f.service.editCurrent({ kind: 'kit', kit })
  const { repository } = await createStudioDraftPorts(f.options, 'instance')
  const stale = await repository.transaction(async tx => {
    const record = await tx.read(selected.id), old = await tx.retainTree(f.old)
    return tx.replace(record.id, record.revision, { ...record, mounts: record.mounts.map(mount => mount.bundle.name === 'research'
      ? { ...mount, bundle: { ...mount.bundle, version: '1.0', source: { ...mount.bundle.source, snapshot: old.id } } } : mount) })
  })
  const file = join(f.stateRoot, 'studio-instance-drafts', stale.id + '.json'), before = await readFile(file)
  const reopened = await createStudioInstances(f.options)
  const loaded = await reopened.loadKit({ id: stale.id, expectedRevision: stale.revision })
  assert.equal(loaded.skills.find(skill => skill.name === 'research').version, '1.1')
  assert.match(loaded.skills.find(skill => skill.name === 'research').content, /Research source 1\.1/)
  assert.match(loaded.skills.find(skill => skill.name === pin.name).content, /CURRENT_CONTENT_UI/)
  assert.deepEqual(await readFile(file), before, 'no implicit migration, save or source rewrite')
})

test('Kit capture still rejects changed members, order, runtime bindings and duplicate selections', async t => {
  const f = await fixture(t), selected = await f.service.editCurrent({ kind: 'kit', kit }), input = await f.service.captureKit({ id: selected.id })
  const [first, second] = input.mounts
  for (const mounts of [
    [second, first], [first], [first, first],
    [first, { ...second, bindingKey: 'other_runtime' }],
    [first, { ...second, bundle: { ...second.bundle, name: 'unlisted_bundle' } }],
  ]) await assert.rejects(f.adapters.composition.loadKit({ ...input, mounts }), /Selected mounts differ from authoritative kit\.yaml/)
  const provenanceOnly = input.mounts.map(mount => ({ ...mount, bundle: { ...mount.bundle, version: '99.0' } }))
  assert.equal((await f.adapters.composition.loadKit({ ...input, mounts: provenanceOnly })).skills.length, 2)
})


test('candidate preview and projected mounts use their supplied Kit declaration, never an older owner or preview hint', async t => {
  const f = await fixture(t), selected = await f.service.editCurrent({ kind: 'kit', kit }), input = await f.service.captureKit({ id: selected.id })
  const targetFiles = kitFiles.map(file => file.path === 'kit.yaml' ? entry(file.path, textOf(kitFiles, file.path).replace('version: "1.1"', 'version: "1.0"')) : file)
  f.captures.length = 0
  const preview = await f.adapters.composition.preview({ ...input, kind: 'kit', kitFiles: targetFiles, bundle: { name: 'research', version: '1.1' }, revision: 1, resolveBundle: f.captureBundle })
  assert.deepEqual(preview.diagnostics, [])
  assert.equal(preview.preview.sample.items.item_01.title, 'Research sample 1.0')
  assert.ok(f.captures.some(pin => pin.name === 'research' && pin.version === '1.0'))
  assert.equal(f.captures.some(pin => pin.name === 'research' && pin.version === '1.1'), false)
  f.captures.length = 0
  const projected = await f.adapters.composition.projectMounts({ kit, kitFiles, mounts: [{ ...pin, bindingKey: pin.name }, { name: 'research', version: '1.0', bindingKey: 'research' }], resolveBundle: f.captureBundle })
  assert.match(textOf(projected, 'kit.yaml'), /version: "1.0"/)
  const loaded = await f.adapters.composition.loadKit({ kit, kitFiles: projected, mounts: [{ ...pin, bindingKey: pin.name }, { name: 'research', version: '1.0', bindingKey: 'research' }], resolveBundle: f.captureBundle })
  assert.match(loaded.skills.find(skill => skill.name === 'research').content, /Research source 1\.0/)
  assert.ok(f.captures.some(pin => pin.name === 'research' && pin.version === '1.0'))
  assert.equal(f.captures.some(pin => pin.name === 'research' && pin.version === '1.1'), false)
})


test('imported missing mounts do not block draft edits to other Kit files', async t => {
  const f = await fixture(t)
  const files = kitFiles.map(file => entry(file.path, textOf(kitFiles, file.path) + (file.path === 'kit.yaml' ? '  - {bindingKey: missing_source, name: missing_source, version: "1.0"}\n' : '')))
  const imported = await f.service.importSources({ kind: 'kit', files })
  assert.equal(imported.readiness.ready, false)
  const method = await f.service.readFile({ id: imported.id, path: 'mindset.md' })
  const request = { id: imported.id, expectedRevision: imported.revision, changes: [{ path: 'mindset.md', content: method.content + '\nHuman draft guidance.\n' }] }
  const candidate = await f.service.prepareChanges(request)
  assert.equal(candidate.valid, false)
  const saved = await f.service.saveChanges({ ...request, mode: 'draft', digest: candidate.digest })
  assert.match((await f.service.readFile({ id: saved.id, path: 'mindset.md' })).content, /Human draft guidance/)
  assert.equal(saved.mounts.some(mount => mount.bundle.name === 'missing_source'), true)
  await assert.rejects(f.service.loadKit({ id: saved.id }))
})

test('a Bundle kit.yaml resource is saved as ordinary source rather than parsed as Kit membership', async t => {
  const f = await fixture(t), current = await f.service.editCurrent({ kind: 'bundle', bundle: pin })
  const content = 'version: 1\nmounts:\n  - {bindingKey: unrelated, name: unrelated, version: "1.0"}\n'
  const request = { id: current.id, expectedRevision: current.revision, changes: [{ path: 'kit.yaml', content }] }
  const candidate = await f.service.prepareChanges(request)
  assert.equal(candidate.valid, true, JSON.stringify(candidate.diagnostics))
  const saved = await f.service.saveChanges({ ...request, mode: 'draft', digest: candidate.digest })
  assert.equal((await f.service.readFile({ id: saved.id, path: 'kit.yaml' })).content, content)
})
