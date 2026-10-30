/** Real Core/S2 filesystem integration; no native model, browser or installed-package claim. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DesignProjectManager } from '../../core/lib/index.js'
import { writeContentCatalog } from '../../core/test/fixtures/content-catalog.mjs'
import { createCompanionContentLibrary } from '../src/content-library.mjs'
import { companionFs, openCompanionProject } from '../src/project.mjs'
import { runCompanionCommand } from '../src/project-commands.mjs'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'companion-project-current-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = await writeContentCatalog(join(root, 'library'), { bundles: [{ name: 'alpha', files: {
    'assets/opaque.bin': Buffer.from([0, 255, 128, 7]),
  } }] })
  const stateRoot = join(root, 'state')
  const library = createCompanionContentLibrary({ fs: companionFs, kitRoot: source.root, stateRoot })
  const original = await library.loadInstalled()
  const pin = { name: original.name, version: String(original.version) }
  const projectRoot = join(root, 'project')
  await new DesignProjectManager().create({ root: projectRoot, name: 'Owned project', kit: pin, knowledge: { provider: 'ladybug-wasm' } })
  const options = { projectRoot, stateRoot, kitRoot: source.root,
    connection: { host: 'codex', threadId: '11111111-1111-4111-8111-111111111111' }, statusEntryPath: '/fixture/installed-cli.mjs' }
  return { root, source, stateRoot, library, original, pin, projectRoot, options }
}

test('methods, Panel and CLI use current project files; library changes and removal preserve the project', async t => {
  const f = await fixture(t)
  const api = await openCompanionProject(f.options)
  const prepared = await api.prepareBundle({ skill: 'alpha' })
  assert.ok(prepared.resources.startsWith(join(f.projectRoot, 'design_kit', 'bundles')))
  assert.ok(prepared.mindset.startsWith(join(f.projectRoot, 'design_kit', 'kit')))
  const argv = prepared.executionContract.validation.argv
  assert.equal(argv[argv.indexOf('--kit') + 1], api.kit.sourceRoot)
  assert.deepEqual(await readFile(join(prepared.resources, 'assets/opaque.bin')), Buffer.from([0, 255, 128, 7]))
  await api.store.writeWorktreeText('alpha/alpha.json', JSON.stringify({ summary: 'Preserve original project facts' }))
  const method = await readFile(join(prepared.resources, 'SKILL.md'), 'utf8')
  await writeFile(join(f.source.bundlesRoot, 'alpha', 'SKILL.md'), method + '\nLibrary-only changed method.\n')
  assert.equal((await api.prepareBundle({ skill: 'alpha' })).definitionRevision, prepared.definitionRevision)
  assert.doesNotMatch((await api.prepareBundle({ skill: 'alpha' })).method, /Library-only changed/)
  await writeFile(join(prepared.resources, 'SKILL.md'), method + '\nProject-local changed method.\n')
  const panel = await readFile(join(prepared.resources, 'panel.yaml'), 'utf8')
  await writeFile(join(prepared.resources, 'panel.yaml'), panel.replace('Synthetic catalog evidence', 'Project-local Panel'))
  const changed = await api.prepareBundle({ skill: 'alpha' })
  assert.notEqual(changed.definitionRevision, prepared.definitionRevision)
  assert.match(changed.method, /Project-local changed/)
  const workspace = await api.readWorkspace()
  assert.match(workspace.design.alpha.panelYaml, /Project-local Panel/)
  assert.equal(workspace.design.alpha.state.summary, 'Preserve original project facts')
  await rm(f.source.root, { recursive: true })
  const reopened = await openCompanionProject({ ...f.options, stateRoot: join(f.root, 'fresh-state') })
  assert.match((await reopened.prepareBundle({ skill: 'alpha' })).method, /Project-local changed/)
  assert.deepEqual(await readFile(join(reopened.kit.skills[0].resourceRoot, 'assets/opaque.bin')), Buffer.from([0, 255, 128, 7]))
  // An existing malformed project source is a real error, never a library fallback.
  await writeFile(join(prepared.resources, 'schema.yaml'), 'type: [broken')
  await assert.rejects(reopened.prepareBundle({ skill: 'alpha' }))
  assert.equal((await reopened.store.read('alpha')).summary, 'Preserve original project facts')
})

test('settlement detects real project-definition changes without blocking on library changes', async t => {
  const f = await fixture(t), api = await openCompanionProject(f.options)
  await api.store.writeWorktreeText('alpha/alpha.json', '{"summary":"Existing facts"}')
  const initial = await api.prepareBundle({ skill: 'alpha' })
  await writeFile(join(f.source.bundlesRoot, 'alpha', 'SKILL.md'), 'Library changed independently.')
  const saved = await api.settleBundle({ skill: 'alpha', invocationId: 'same-project-source', definitionRevision: initial.definitionRevision })
  assert.ok(saved.commit)
  const before = await api.store.head()
  await writeFile(join(initial.resources, 'SKILL.md'), (await readFile(join(initial.resources, 'SKILL.md'), 'utf8')) + '\nConcurrent project edit.\n')
  await assert.rejects(api.settleBundle({ skill: 'alpha', invocationId: 'concurrent-project-source', definitionRevision: initial.definitionRevision }), /definitions changed/)
  assert.equal(await api.store.head(), before)
  assert.equal((await api.store.read('alpha')).summary, 'Existing facts')
  const next = await api.prepareBundle({ skill: 'alpha' })
  assert.match(next.method, /Concurrent project edit/)
  assert.notEqual(next.definitionRevision, initial.definitionRevision)
})

test('current library edits initialize a new project while copied identities remain independent', async t => {
  const f = await fixture(t), studio = await f.library.studio()
  const bundlePin = { name: 'alpha', version: String(f.original.skills[0].version) }
  const current = await studio.editCurrentInstance({ kind: 'bundle', bundle: bundlePin })
  const file = await studio.readInstanceFile({ id: current.id, path: 'SKILL.md' })
  const saved = await studio.saveInstanceFile({ id: current.id, expectedRevision: current.revision, path: file.path, content: file.content + '\nCurrent library method.\n' })
  assert.equal((await studio.editCurrentInstance({ kind: 'bundle', bundle: bundlePin })).id, current.id)
  const copy = await studio.copyInstance({ kind: 'bundle', sourceId: current.id, expectedRevision: saved.revision })
  assert.notEqual(copy.id, current.id)
  const options = { host: 'codex', threadId: '11111111-1111-4111-8111-111111111111',
    projectsRoot: join(f.root, 'new-projects'), stateRoot: f.stateRoot, kitRoot: f.source.root }
  await runCompanionCommand({ ...options, input: 'new From current library' })
  const selected = await runCompanionCommand({ ...options, input: `kit ${f.pin.name}` })
  const api = await openCompanionProject({ ...f.options, projectRoot: selected.selected.root })
  assert.match((await api.prepareBundle({ skill: 'alpha' })).method, /Current library method/)
  await studio.saveInstanceFile({ id: current.id, expectedRevision: saved.revision, path: file.path, content: file.content + '\nLater library method.\n' })
  assert.doesNotMatch((await api.prepareBundle({ skill: 'alpha' })).method, /Later library method/)
  assert.match((await studio.readInstanceFile({ id: copy.id, path: 'SKILL.md' })).content, /Current library method/)
  assert.doesNotMatch((await studio.readInstanceFile({ id: copy.id, path: 'SKILL.md' })).content, /Later library method/)
})

test('a saved library object remains editable after its installed sources disappear', async t => {
  const f = await fixture(t), studio = await f.library.studio()
  const current = await studio.editCurrentInstance({ kind: 'bundle', bundle: { name: 'alpha', version: String(f.original.skills[0].version) } })
  await rm(f.source.root, { recursive: true })
  await rm(join(f.stateRoot, 'content'), { recursive: true, force: true })
  const fresh = createCompanionContentLibrary({ fs: companionFs, kitRoot: f.source.root, stateRoot: f.stateRoot })
  const reopened = await fresh.studio()
  const file = await reopened.readInstanceFile({ id: current.id, path: 'SKILL.md' })
  const saved = await reopened.saveInstanceFile({ id: current.id, expectedRevision: current.revision, path: file.path, content: file.content + '\nStill editable.\n' })
  assert.match((await reopened.readInstanceFile({ id: saved.id, path: file.path })).content, /Still editable/)
  await assert.rejects(reopened.workspace({}))
})
