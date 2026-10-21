import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, writeFile, rm, symlink, cp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { createStudioPanelDrafts, createStudioKitDrafts, createStudioDraftPorts } from '../src/studio-panel-drafts.mjs'
import { loadStudioKit } from '../../studio/src/load.ts'
import { companionFs } from '../src/project.mjs'

const packageRoot = fileURLToPath(new URL('../../skills-web-app/', import.meta.url))
let kitRoot
before(async () => {
  // Preserve explicit legacy-layout coverage; official content stays independent.
  kitRoot = await mkdtemp(join(tmpdir(), 'studio-legacy-draft-kit-'))
  await cp(join(packageRoot, 'kits/web_app/mindset.md'), join(kitRoot, 'mindset.md'))
  if ((await readdir(join(packageRoot, 'kits/web_app'))).includes('relations.yaml')) {
    await cp(join(packageRoot, 'kits/web_app/relations.yaml'), join(kitRoot, 'relations.yaml'))
  }
  await cp(join(packageRoot, 'bundles'), join(kitRoot, 'skills'), { recursive: true })
})
after(async () => { if (kitRoot) await rm(kitRoot, { recursive: true, force: true }) })
const kit = { name: 'web_app', version: '1.0' }
const bundle = { name: 'business_rules', version: '1.0' }
const sampleSource = JSON.stringify({ schema_version: 4, rules: { r1: { id: 'r1', title: 'A sample rule' } }, rule_order: ['r1'] })

test('independent closure retains mounted source bytes, pins and trusted origins across reopen', async t => {
  const temporary = await mkdtemp(join(tmpdir(), 'studio-independent-snapshot-'))
  t.after(() => rm(temporary, { recursive: true, force: true }))
  const ownedKit = join(temporary, 'source/kits/web_app'), ownedBundles = join(temporary, 'source/bundles')
  await cp(join(packageRoot, 'kits/web_app'), ownedKit, { recursive: true })
  await cp(join(packageRoot, 'bundles'), ownedBundles, { recursive: true })
  const locations = (await readdir(ownedBundles)).map(name => ({ name, version: '1.0', rootDir: join(ownedBundles, name), sourceId: 'fixture:trusted-deployment' }))
  const installed = await loadStudioKit(companionFs, ownedKit, { bundles: locations })
  // The trusted port returns Core retained resource roots, not browser-selected paths.
  const options = { stateRoot: join(temporary, 'state'), kitRoot: ownedKit, readInstalledKit: () => installed,
    readInstalledBundle: pin => { const location = locations.find(location => location.name === pin.name && location.version === pin.version); return { resourceRoot: location.rootDir, sourceId: location.sourceId } } }
  const panels = await createStudioPanelDrafts(options), kits = await createStudioKitDrafts(options)
  const panel = await panels.create({ kit, bundle, sampleSource }), kitDraft = await kits.create({ kit })
  const ports = await createStudioDraftPorts(options, 'panel')
  const snapshot = await ports.sources.open(panel.baseSnapshot)
  assert.match(snapshot.root, /kits\/web_app$/)
  assert.equal(snapshot.loadOptions.bundles.length, installed.skills.length)
  assert.equal(snapshot.loadOptions.bundles.find(entry => entry.name === bundle.name).sourceId, 'fixture:trusted-deployment')
  assert.deepEqual((await loadStudioKit(snapshot.fs, snapshot.root, snapshot.loadOptions)).skills.map(skill => skill.authority), installed.skills.map(skill => skill.authority))
  await symlink(join(ownedKit, 'mindset.md'), join(ownedBundles, bundle.name, 'unexpected-link'))
  await assert.rejects(ports.sources.capture(kit), /symlinks/)
  await rm(join(ownedBundles, bundle.name, 'unexpected-link'))
  await assert.rejects(ports.sources.capture({ ...kit, version: 'unpublished' }), /exact installed/)
  await rm(join(temporary, 'source'), { recursive: true, force: true })
  const preview = await panels.preview({ ...panel, expectedRevision: 0, revision: 2 })
  assert.deepEqual(preview.diagnostics, [])
  assert.equal((await kits.validate({ id: kitDraft.id, expectedRevision: 0 })).valid, true)
  assert.deepEqual((await kits.preview({ id: kitDraft.id, expectedRevision: 0, bundle, sampleSource })).diagnostics, [])
  assert.deepEqual(await snapshot.fs.readText(join(snapshot.root, 'kit.yaml')), await (await ports.sources.open(panel.baseSnapshot)).fs.readText(join(snapshot.root, 'kit.yaml')))
  await assert.rejects(snapshot.fs.readText(join(snapshot.storageRoot, '..', 'outside')), /escapes/)
})

test('real Kit snapshot → edit → preview → durable reopen → confirm → fork; no installed mutation', async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), 'yugoo-studio-drafts-'))
  const options = { stateRoot, kitRoot, readInstalledKit: () => kit }
  const original = await readFile(join(kitRoot, 'skills/business_rules/panel.yaml'), 'utf8')
  try {
    const service = await createStudioPanelDrafts(options)
    const created = await service.create({ kit, bundle, sampleSource })
    assert.equal(created.revision, 0)
    assert.equal(created.panelSource, original)
    const edit = { id: created.id, expectedRevision: 0, panelSource: original + '\n# sample author edit\n', sampleSource }
    const saved = await service.save(edit)
    assert.equal(saved.revision, 1)
    const reopenedService = await createStudioPanelDrafts(options)
    assert.deepEqual(await reopenedService.read(created.id), saved)
    await assert.rejects(service.save(edit), /changed/)
    const preview = await reopenedService.preview({ ...edit, expectedRevision: 1, revision: 8 })
    assert.equal(preview.preview.revision, 8)
    assert.equal(preview.diagnostics.length, 0)
    const confirmed = await reopenedService.confirm({ id: saved.id, expectedRevision: 1 })
    assert.equal(confirmed.draft.confirmed, true)
    assert.equal(confirmed.draft.revision, 2)
    await assert.rejects(service.save({ ...edit, expectedRevision: 2 }), /locked/)
    const fork = await service.fork(created.id)
    assert.notEqual(fork.id, created.id)
    assert.equal(fork.confirmed, false)
    assert.equal(fork.baseSnapshot, created.baseSnapshot)
    const another = await service.create({ kit, bundle, sampleSource })
    assert.equal(another.baseSnapshot, created.baseSnapshot)
    assert.equal((await readdir(join(stateRoot, 'studio-panel-drafts/snapshots'))).length, 1, 'copies deduplicate complete source bytes')
    assert.equal(await readFile(join(kitRoot, 'skills/business_rules/panel.yaml'), 'utf8'), original)
    assert.equal((await service.list()).length, 3)

    // Broken edits can be recovered after reopen, but cannot be confirmed.
    const broken = await service.save({ id: fork.id, expectedRevision: 0, panelSource: 'invalid: [', sampleSource })
    const rejected = await service.confirm({ id: broken.id, expectedRevision: 1 })
    assert.equal(rejected.draft, undefined)
    assert.ok(rejected.diagnostics.length > 0)
    assert.equal((await service.read(fork.id)).confirmed, false)
    await assert.rejects(service.read('../escape'), /identity/)

    // Separate service instances must not silently overwrite a concurrent save.
    const attempts = await Promise.allSettled([
      service.save({ id: another.id, expectedRevision: 0, panelSource: original + '\n# left', sampleSource }),
      reopenedService.save({ id: another.id, expectedRevision: 0, panelSource: original + '\n# right', sampleSource }),
    ])
    assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1)
    assert.equal((await service.read(another.id)).revision, 1)
    // A corrupted snapshot never falls back to the live installed tree.
    await writeFile(join(stateRoot, 'studio-panel-drafts/snapshots', `${created.baseSnapshot}.json`), '[]')
    await assert.rejects(service.preview({ ...edit, expectedRevision: 2, revision: 0 }), /integrity/)
  } finally { await rm(stateRoot, { recursive: true, force: true }) }
})

test('authoring store rejects installed-root writes and symlinked storage', async () => {
  await assert.rejects(createStudioPanelDrafts({ stateRoot: kitRoot, kitRoot, readInstalledKit: () => kit }), /inside/)
  const root = await mkdtemp(join(tmpdir(), 'yugoo-studio-boundary-'))
  try {
    await symlink(kitRoot, join(root, 'studio-panel-drafts'))
    await assert.rejects(createStudioPanelDrafts({ stateRoot: root, kitRoot, readInstalledKit: () => kit }), /symlink/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Kit-owned draft persists independently, previews retained Bundle, confirms and reopens', async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), 'yugoo-studio-kit-draft-'))
  const options = { stateRoot, kitRoot, readInstalledKit: () => kit }
  const original = await readFile(join(kitRoot, 'mindset.md'), 'utf8')
  try {
    const service = await createStudioKitDrafts(options)
    const created = await service.create({ kit })
    const saved = await service.save({ id: created.id, expectedRevision: 0,
      mindsetSource: created.mindsetSource + '\n<!-- Kit author working copy -->\n', relationsSource: created.relationsSource })
    const reopened = await createStudioKitDrafts(options)
    assert.deepEqual(await reopened.read(saved.id), saved)
    assert.equal((await reopened.validate({ id: saved.id, expectedRevision: 1 })).valid, true)
    const preview = await reopened.preview({ id: saved.id, expectedRevision: 1, bundle, sampleSource })
    assert.deepEqual(preview.diagnostics, [])
    assert.equal(preview.preview.revision, 1)
    assert.equal(preview.preview.sample.rules.r1.title, 'A sample rule')
    const confirmed = await reopened.confirm({ id: saved.id, expectedRevision: 1 })
    assert.equal(confirmed.draft.confirmed, true)
    assert.equal((await service.read(saved.id)).revision, 2)
    await assert.rejects(service.save({ id: saved.id, expectedRevision: 2, mindsetSource: original, relationsSource: null }), /locked/)
    const fork = await reopened.fork(saved.id)
    assert.equal(fork.baseSnapshot, saved.baseSnapshot)
    assert.equal(fork.confirmed, false)
    assert.equal((await readdir(join(stateRoot, 'studio-kit-drafts/snapshots'))).length, 1)
    const panels = await createStudioPanelDrafts(options)
    assert.deepEqual(await panels.list(), [], 'Kit records must not appear in Panel draft listing')
    assert.equal(await readFile(join(kitRoot, 'mindset.md'), 'utf8'), original)
    await writeFile(join(stateRoot, 'studio-kit-drafts/snapshots', `${saved.baseSnapshot}.json`), '[]')
    const rejected = await reopened.confirm({ id: fork.id, expectedRevision: 0 })
    assert.equal(rejected.valid, false)
    assert.match(rejected.diagnostics[0].message, /integrity/)
    assert.equal(rejected.draft, undefined)
  } finally { await rm(stateRoot, { recursive: true, force: true }) }
})
