import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { createStudioInstances } from '../src/studio-instances.mjs'
import { createStudioDraftPorts } from '../src/studio-panel-drafts.mjs'

const kitRoot = fileURLToPath(new URL('../../skills-web-app/', import.meta.url))
const kit = { name: 'fixture_kit', version: '1.0' }
const alpha = { name: 'alpha', version: '1.0' }, beta = { name: 'beta', version: '2.0' }
const title = { zh: '测试规则', en: 'Fixture rules' }
const entry = (path, text) => ({ path, base64: Buffer.from(text).toString('base64') })
const textOf = (files, path) => Buffer.from(files.find(file => file.path === path).base64, 'base64').toString('utf8')
const method = 'Complete method. Preserve domain reasoning, failures, and output protocols.\n'
const initialMindset = '---\nname: fixture_kit\n---\n\nUser-owned prose.\n<design_skills>\n## alpha\n</design_skills>\nTrailing custom prose.\n'
const projectedMindset = (text, mounts) => text.replace(/<design_skills>[\s\S]*?<\/design_skills>/, `<design_skills>\n${mounts.map(mount => `## ${mount.bindingKey}\n`).join('')}</design_skills>`)

// Deliberate fixture ports: these prove storage contracts, not Core composition or native trust.
function ports() {
  const installed = new Map([alpha, beta].map(pin => [pin.name, [entry('skill.yaml', JSON.stringify(pin)), entry('SKILL.md', method), entry('schema.yaml', '{}'), entry('validation.yaml', `skill: ${pin.name}\n`)]]))
  const captured = [], composed = []
  const catalog = {
    async listBundles() { return [alpha, beta].map(pin => ({ ...pin, title, runtimeName: pin.name })) },
    async captureKit(requested) {
      assert.deepEqual(requested, kit)
      return { files: [entry('mindset.md', initialMindset), entry('kit.yaml', JSON.stringify({ version: 1, mounts: [{ bindingKey: 'alpha', ...alpha }] }))], mounts: [{ bindingKey: 'alpha', ...alpha }], title }
    },
    async captureBundle(requested) {
      const found = [alpha, beta].find(pin => pin.name === requested.name && pin.version === requested.version)
      if (!found) throw new Error('Missing installed Bundle')
      captured.push(requested.name)
      return { files: structuredClone(installed.get(requested.name)), title, sourceId: `trusted:fixture:${requested.name}`, runtimeName: requested.name }
    },
  }
  const composition = {
    async forkBundle({ files, from, to, runtimeName }) {
      const manifest = JSON.parse(textOf(files, 'skill.yaml'))
      assert.deepEqual({ name: manifest.identity ?? manifest.name, version: manifest.version }, from)
      assert.equal(manifest.name, runtimeName)
      if (textOf(files, 'SKILL.md') === 'REJECT_FORK') throw new Error('Unsupported fork identity/trust')
      return files.map(file => file.path === 'skill.yaml' ? entry(file.path, JSON.stringify({ ...manifest, identity: to.name })) : file)
    },
    async projectMounts({ kit: _kit, kitFiles, mounts }) {
      const projected = kitFiles.map(file => file.path === 'mindset.md' ? entry(file.path, projectedMindset(textOf(kitFiles, file.path), mounts)) : file)
      const declaration = entry('kit.yaml', JSON.stringify({ version: 1, mounts }))
      return [...projected.filter(file => file.path !== 'kit.yaml'), declaration]
    },
    async validateKit({ kitFiles, mounts, resolveBundle }) {
      assert.deepEqual(JSON.parse(textOf(kitFiles, 'kit.yaml')).mounts, mounts.map(mount => ({ bindingKey: mount.bindingKey, name: mount.bundle.name, version: mount.bundle.version })))
      for (const mount of mounts) {
        const resolved = await resolveBundle(mount.bundle)
        const manifest = JSON.parse(textOf(resolved.files, 'skill.yaml'))
        assert.deepEqual({ name: manifest.identity ?? manifest.name, version: manifest.version }, { name: mount.bundle.name, version: mount.bundle.version })
        assert.equal(mount.bindingKey, manifest.name)
        if (textOf(resolved.files, 'SKILL.md') === 'INVALID') throw new Error('Fixture loader rejected Bundle')
        composed.push({ name: mount.bundle.name, sourceId: resolved.sourceId, method: textOf(resolved.files, 'SKILL.md') })
      }
      await assert.rejects(resolveBundle({ name: 'outside', version: '1.0' }), /outside/)
    },
    async preview(input) {
      if (input.kind === 'kit') await composition.validateKit(input)
      return { preview: { revision: input.revision }, diagnostics: [] }
    },
  }
  return { catalog, composition, installed, captured, composed }
}
async function fixture(t) {
  const stateRoot = await mkdtemp(join(tmpdir(), 'studio-independent-'))
  t.after(() => rm(stateRoot, { recursive: true, force: true }))
  const adapters = ports(), options = { stateRoot, kitRoot, readInstalledKit: () => kit, ...adapters }
  return { ...adapters, options, service: await createStudioInstances(options), stateRoot }
}

test('local display copy follows retained source and saved edits, not the mutable installed base', async t => {
  const { service, installed, catalog } = await fixture(t)
  const captureKit = catalog.captureKit
  const original = initialMindset.replace('\n---', '\ndescription: Original routing\ndisplay_description: {zh: 中文套件, en: Kit introduction}\n---')
  catalog.captureKit = async request => { const value = await captureKit(request); return { ...value, files: value.files.map(file => file.path === 'mindset.md' ? entry(file.path, original) : file) } }
  const copied = await service.copy({ kind: 'kit', kit })
  assert.deepEqual(copied.displayDescription, { zh: '中文套件', en: 'Kit introduction' })
  const before = await service.readFile({ id: copied.id, path: 'mindset.md' })
  const saved = await service.saveFile({ id: copied.id, expectedRevision: copied.revision, path: 'mindset.md', content: before.content.replace('中文套件', '修改后的套件') })
  assert.equal(saved.displayDescription.zh, '修改后的套件')
  assert.equal(saved.description, 'Original routing')
  assert.equal((await service.list()).find(item => item.id === copied.id).displayDescription.zh, '修改后的套件')
  const files = installed.get('beta')
  files.find(file => file.path === 'SKILL.md').base64 = entry('SKILL.md', '---\nname: beta\ndescription: Original method routing\n---\n' + method).base64
  files.push(entry('panel.yaml', 'i18n:\n  locales:\n    zh-CN: locales/zh-CN.json\n    en-US: locales/en-US.json\n'), entry('locales/zh-CN.json', '{"bundleDescription":"中文技能包"}'), entry('locales/en-US.json', '{"bundleDescription":"Bundle introduction"}'))
  const bundleCopy = await service.copy({ kind: 'bundle', bundle: beta })
  assert.deepEqual(bundleCopy.displayDescription, { zh: '中文技能包', en: 'Bundle introduction' })
  files.find(file => file.path === 'locales/en-US.json').base64 = entry('', '{"bundleDescription":"changed installed source"}').base64
  assert.equal((await service.read({ id: bundleCopy.id })).displayDescription.en, 'Bundle introduction')
  const changed = await service.saveFile({ id: bundleCopy.id, expectedRevision: bundleCopy.revision, path: 'locales/en-US.json', content: '{"bundleDescription":"my SAME wording"}' })
  assert.equal(changed.displayDescription.en, 'my SAME wording')
  const invalid = await service.saveFile({ id: changed.id, expectedRevision: changed.revision, path: 'locales/en-US.json', content: '{' })
  assert.equal(invalid.displayDescription, undefined)
  assert.equal(invalid.description, 'Original method routing')
})

test('local Bundle descriptions follow declared locale paths and ignore undeclared conventional files', async t => {
  const { service, installed } = await fixture(t)
  const files = installed.get('beta')
  const manifest = files.find(file => file.path === 'skill.yaml')
  manifest.base64 = entry('', JSON.stringify({ ...beta, description: { zh: '声明简介', en: 'Manifest introduction' } })).base64
  files.push(entry('locales/zh-CN.json', '{"bundleDescription":"undeclared Chinese"}'), entry('locales/en-US.json', '{"bundleDescription":"undeclared English"}'))
  const manifestOnly = await service.copy({ kind: 'bundle', bundle: beta })
  assert.deepEqual(manifestOnly.displayDescription, { zh: '声明简介', en: 'Manifest introduction' })
  files.push(entry('panel.yaml', 'i18n:\n  locales:\n    zh-CN: locales/chinese.json\n    en-US: locales/english.json\n'), entry('locales/chinese.json', '{"bundleDescription":"自定义路径"}'), entry('locales/english.json', '{"bundleDescription":"Custom declared path"}'))
  manifest.base64 = entry('', JSON.stringify(beta)).base64
  const declared = await service.copy({ kind: 'bundle', bundle: beta })
  assert.deepEqual(declared.displayDescription, { zh: '自定义路径', en: 'Custom declared path' })
  const badPath = await service.saveFile({ id: declared.id, expectedRevision: declared.revision, path: 'panel.yaml', content: 'i18n:\n  locales:\n    zh-CN: ../outside.json\n    en-US: /outside.json\n' })
  assert.equal(badPath.displayDescription, undefined, 'invalid paths never escape the retained Bundle snapshot')
})

test('independent global Bundle fork retains method, unique identity, CAS and durable edits', async t => {
  const { service, options, installed } = await fixture(t)
  const before = structuredClone([...installed])
  const created = await service.copy({ kind: 'bundle', bundle: beta })
  assert.ok(created.bundle.name.startsWith('local_bundle_'))
  assert.notEqual(created.bundle.name, beta.name)
  assert.equal(created.sourceId, `local:bundle:${created.bundle.name}`)
  assert.deepEqual(created.source, { bundle: beta })
  assert.equal(created.runtimeName, beta.name)
  assert.deepEqual(created.files.map(file => file.path), ['schema.yaml', 'skill.yaml', 'SKILL.md', 'validation.yaml'].sort((a, b) => a.localeCompare(b)))
  const manifest = JSON.parse((await service.readFile({ id: created.id, path: 'skill.yaml' })).content)
  assert.equal(manifest.name, beta.name)
  assert.equal(manifest.identity, created.bundle.name)
  assert.equal((await service.readFile({ id: created.id, path: 'validation.yaml' })).content, `skill: ${beta.name}\n`)
  assert.equal((await service.readFile({ id: created.id, path: 'SKILL.md' })).content, method)
  const renamed = await service.rename({ id: created.id, expectedRevision: 0, title: { zh: '自定义', en: 'Custom' } })
  assert.deepEqual(renamed.bundle, created.bundle)
  await service.saveFile({ id: created.id, expectedRevision: 1, path: 'SKILL.md', content: 'Edited independently' })
  const reopened = await createStudioInstances({ ...options, kitRoot: undefined, readInstalledKit: undefined })
  assert.equal((await reopened.readFile({ id: created.id, path: 'SKILL.md' })).content, 'Edited independently')
  await assert.rejects(reopened.rename({ id: created.id, expectedRevision: 0, title }), /changed/)
  for (const path of ['../mindset.md', '/root', 'a/../b', '.git/config', 'a\\b', 'C:/file']) await assert.rejects(reopened.readFile({ id: created.id, path }), /path/)
  const fork = await reopened.copy({ kind: 'bundle', sourceId: created.id, expectedRevision: 2 })
  assert.notEqual(fork.bundle.name, created.bundle.name)
  assert.equal((await reopened.readFile({ id: fork.id, path: 'SKILL.md' })).content, 'Edited independently')
  await reopened.remove({ id: created.id, expectedRevision: 2 })
  assert.equal((await reopened.readFile({ id: fork.id, path: 'SKILL.md' })).content, 'Edited independently')
  assert.deepEqual([...installed], before)
})

test('Kit copies reference global Bundles without owning their files; local revisions remain pinned', async t => {
  const { service, options, composed, captured } = await fixture(t)
  const working = await service.copy({ kind: 'bundle', bundle: beta })
  const kitCopy = await service.copy({ kind: 'kit', kit })
  assert.deepEqual(kitCopy.files.map(file => file.path).sort(), ['kit.yaml', 'mindset.md'])
  assert.ok(kitCopy.availableBundles.some(candidate => candidate.name === beta.name), 'global candidate not in original Kit')
  assert.ok(kitCopy.availableBundles.some(candidate => candidate.name === working.bundle.name))
  const selected = { ...working.bundle, instanceId: working.id, revision: 0, bindingKey: 'beta' }
  const mounted = await service.updateMounts({ id: kitCopy.id, expectedRevision: 0, bundles: [alpha, selected] })
  const receipt = mounted.mounts[1].bundle.source
  assert.equal(mounted.mounts[1].bundle.revision, 0)
  assert.equal(mounted.mounts[1].bindingKey, 'beta')
  assert.equal(mounted.mounts[1].bundle.source.sourceId, working.sourceId)
  assert.ok(!mounted.files.some(file => file.path.startsWith('skills/')))
  await service.saveFile({ id: working.id, expectedRevision: 0, path: 'SKILL.md', content: 'Changed after mounting' })
  composed.length = 0
  await service.preview({ id: kitCopy.id, expectedRevision: 1, bundle: working.bundle })
  assert.equal(composed.find(item => item.name === working.bundle.name).method, method)
  const count = captured.length
  const secondKit = await service.copy({ kind: 'kit', sourceId: kitCopy.id, expectedRevision: 1 })
  assert.equal(captured.length, count, 'copy Kit does not recapture or duplicate Bundle sources')
  assert.deepEqual(secondKit.mounts, mounted.mounts)
  assert.deepEqual(secondKit.mounts[1].bundle.source, receipt)
  await assert.rejects(service.remove({ id: working.id, expectedRevision: 1 }), /referenced/)
  await service.remove({ id: kitCopy.id, expectedRevision: 1 })
  assert.equal((await service.read({ id: working.id })).id, working.id)
  await assert.rejects(service.remove({ id: working.id, expectedRevision: 1 }), /referenced/)
  const reopened = await createStudioInstances(options)
  await reopened.updateMounts({ id: secondKit.id, expectedRevision: 0, bundles: [beta] })
  await reopened.remove({ id: working.id, expectedRevision: 1 })
  assert.deepEqual((await reopened.read({ id: secondKit.id })).mounts.map(item => ({ name: item.bundle.name, version: item.bundle.version })), [beta])
})

test('negative ports fail without visible half-copies; invalid mounts and stale revisions do not persist', async t => {
  const { service, options, installed, stateRoot } = await fixture(t)
  installed.set('beta', installed.get('beta').map(file => file.path === 'SKILL.md' ? entry(file.path, 'REJECT_FORK') : file))
  await assert.rejects(service.copy({ kind: 'bundle', bundle: beta }), /Unsupported/)
  assert.deepEqual(await service.list(), [])
  await assert.rejects(createStudioInstances({ stateRoot, kitRoot, readInstalledKit: () => kit }), /ports are required/)
  const created = await service.copy({ kind: 'kit', kit })
  const local = await service.copy({ kind: 'bundle', bundle: alpha })
  await assert.rejects(service.updateMounts({ id: created.id, expectedRevision: 0, bundles: [local.bundle] }), /exact local Bundle revision/)
  await assert.rejects(service.updateMounts({ id: created.id, expectedRevision: 0, bundles: [{ ...local.bundle, revision: 0, bindingKey: local.bundle.name }] }), /preserve its runtime name/)
  await assert.rejects(service.updateMounts({ id: created.id, expectedRevision: 0, bundles: [{ ...alpha, instanceId: local.id }] }), /Installed Bundle/)
  await assert.rejects(service.updateMounts({ id: created.id, expectedRevision: 0, bundles: [{ name: 'missing', version: '1.0' }] }), /unavailable/)
  await service.saveFile({ id: local.id, expectedRevision: 0, path: 'SKILL.md', content: 'INVALID' })
  await assert.rejects(service.updateMounts({ id: created.id, expectedRevision: 0, bundles: [{ ...local.bundle, revision: 1 }] }), /loader rejected/)
  assert.equal((await service.read({ id: created.id })).revision, 0)
  await assert.rejects(service.updateMounts({ id: created.id, expectedRevision: 99, bundles: [] }), /changed/)
  await assert.rejects(service.saveFile({ id: created.id, expectedRevision: 0, path: 'kit.yaml', content: '{}' }), /mount management/)
  const corrupt = { ...options, catalog: { ...options.catalog, async captureBundle() { return { files: [entry('../escape', 'bad')], title, sourceId: 'trusted:fixture:alpha' } } } }
  const unsafe = await createStudioInstances(corrupt)
  await assert.rejects(unsafe.copy({ kind: 'kit', kit }), /source tree/)
  const wholeTree = await createStudioInstances({ ...options, catalog: { ...options.catalog, async captureKit(requested) {
    const captured = await options.catalog.captureKit(requested)
    return { ...captured, files: [...captured.files, entry('skills/alpha/SKILL.md', method)] }
  } } })
  await assert.rejects(wholeTree.copy({ kind: 'kit', kit }), /only Kit-owned files/)
  assert.equal((await service.list()).length, 2)
})

test('Kit generated catalog projection preserves prose and mount refs across reopen', async t => {
  const { service, options } = await fixture(t)
  const created = await service.copy({ kind: 'kit', kit })
  const original = (await service.readFile({ id: created.id, path: 'mindset.md' })).content
  const custom = original + '\nAdditional method guidance.\n'
  await service.saveFile({ id: created.id, expectedRevision: 0, path: 'mindset.md', content: custom })
  const next = await service.updateMounts({ id: created.id, expectedRevision: 1, bundles: [beta] })
  const read = (await service.readFile({ id: created.id, path: 'mindset.md' })).content
  const outside = text => [text.split('<design_skills>')[0], text.split('</design_skills>')[1]]
  assert.deepEqual(outside(read), outside(custom))
  await assert.rejects(service.saveFile({ id: created.id, expectedRevision: 2, path: 'mindset.md', content: original }), /mount management/)
  const reopened = await createStudioInstances(options)
  assert.deepEqual((await reopened.read({ id: created.id })).mounts, next.mounts)
  assert.ok((await reopened.read({ id: created.id })).availableBundles.some(item => item.name === alpha.name))
})

test('explicit legacy migration retains recoverable original and independently scoped Bundle bytes', async t => {
  const { service, options, installed, stateRoot } = await fixture(t)
  const ports = await createStudioDraftPorts(options, 'instance')
  const legacyFiles = [entry('mindset.md', initialMindset), ...installed.get('alpha').map(file => ({ ...file, path: `skills/alpha/${file.path}` }))]
  const snapshot = await ports.sources.retainTree(legacyFiles)
  const legacy = await ports.repository.create({ kind: 'bundle', source: { kit, bundle: alpha }, title, baseSnapshot: snapshot.id,
    bundlePath: 'skills/alpha', overlays: { 'skills/alpha/SKILL.md': method + 'Legacy edits.\n' }, mounts: [], confirmed: false })
  assert.equal((await service.read({ id: legacy.id })).requiresMigration, true)
  await assert.rejects(service.readFile({ id: legacy.id, path: 'SKILL.md' }), /migration/)
  const migrated = await service.migrate({ id: legacy.id, expectedRevision: 0 })
  assert.equal(migrated.recordVersion, 2)
  assert.equal(migrated.revision, 1)
  assert.ok(migrated.files.every(file => !file.path.startsWith('skills/') && file.path !== 'mindset.md'))
  assert.equal((await service.readFile({ id: legacy.id, path: 'SKILL.md' })).content, method + 'Legacy edits.\n')
  const backup = JSON.parse(await readFile(join(stateRoot, 'studio-instance-drafts', `${legacy.id}.legacy-v1.json`), 'utf8'))
  assert.equal(backup.overlays['skills/alpha/SKILL.md'], method + 'Legacy edits.\n')
  assert.equal((await ports.sources.open(snapshot.id)).id, snapshot.id)
  await assert.rejects(service.migrate({ id: legacy.id, expectedRevision: 1 }), /already migrated/)
})

test('snapshot writer bounds/canonicalizes independent trees and rejects unsafe entries', async t => {
  const { options, stateRoot } = await fixture(t)
  const { sources } = await createStudioDraftPorts(options, 'instance')
  const first = await sources.retainTree([entry('z.md', 'z'), entry('a.md', 'a')])
  const second = await sources.retainTree([entry('a.md', 'a'), entry('z.md', 'z')])
  assert.equal(first.id, second.id)
  assert.equal((await readdir(join(stateRoot, 'studio-instance-drafts/snapshots'))).length, 1)
  for (const entries of [[entry('../escape', '')], [entry('same', '1'), entry('same', '2')], [{ path: 'a', base64: '!!!' }], Array.from({ length: 4097 }, (_, index) => entry(`f${index}`, ''))]) {
    await assert.rejects(sources.retainTree(entries), /entry|4096/)
  }
})

test('legacy Kit migration preserves linked Bundle identity and refuses orphan edits or changed trusted bytes', async t => {
  const { service, options, installed, stateRoot } = await fixture(t)
  const ports = await createStudioDraftPorts(options, 'instance')
  const wholeKit = [entry('mindset.md', initialMindset), ...installed.get('alpha').map(file => ({ ...file, path: `skills/alpha/${file.path}` }))]
  const snapshot = await ports.sources.retainTree(wholeKit)
  const legacyBundle = await ports.repository.create({ kind: 'bundle', source: { kit, bundle: alpha }, title, baseSnapshot: snapshot.id,
    bundlePath: 'skills/alpha', overlays: {}, mounts: [], confirmed: false })
  const legacyKit = await ports.repository.create({ kind: 'kit', source: { kit }, title, baseSnapshot: snapshot.id,
    overlays: {}, mounts: [{ bundle: alpha, instanceId: legacyBundle.id, revision: 0 }], confirmed: false })
  const migratedKit = await service.migrate({ id: legacyKit.id, expectedRevision: 0 })
  const migratedBundle = await service.migrate({ id: legacyBundle.id, expectedRevision: 0 })
  assert.deepEqual(migratedKit.mounts[0].bundle.name, migratedBundle.bundle.name)
  assert.equal(migratedKit.mounts[0].bundle.source.sourceId, migratedBundle.sourceId)
  assert.ok(migratedKit.files.every(file => !file.path.startsWith('skills/')))
  await assert.rejects(service.remove({ id: legacyBundle.id, expectedRevision: 1 }), /referenced/)
  await service.remove({ id: legacyKit.id, expectedRevision: 1 })
  assert.equal((await service.read({ id: legacyBundle.id })).recordVersion, 2)
  const orphan = await ports.repository.create({ kind: 'kit', source: { kit }, title, baseSnapshot: snapshot.id,
    overlays: { 'skills/alpha/SKILL.md': 'Orphan authored methods' }, mounts: [{ bundle: alpha }], confirmed: false })
  await assert.rejects(service.migrate({ id: orphan.id, expectedRevision: 0 }), /independent Bundle edits/)
  assert.equal((await ports.repository.read(orphan.id)).revision, 0)
  await assert.rejects(readFile(join(stateRoot, 'studio-instance-drafts', `${orphan.id}.legacy-v1.json`)), { code: 'ENOENT' })
  const changed = await ports.sources.retainTree(wholeKit.map(file => file.path === 'skills/alpha/SKILL.md' ? entry(file.path, 'Unrecognized methods') : file))
  const untrusted = await ports.repository.create({ kind: 'kit', source: { kit }, title, baseSnapshot: changed.id, overlays: {}, mounts: [{ bundle: alpha }], confirmed: false })
  await assert.rejects(service.migrate({ id: untrusted.id, expectedRevision: 0 }), /differ from the trusted catalog/)
  assert.equal((await ports.repository.read(untrusted.id)).revision, 0)
})
