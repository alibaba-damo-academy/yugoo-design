import test from 'node:test'
import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { stringify } from 'yaml'
import { writeContentCatalog } from '../../core/test/fixtures/content-catalog.mjs'
import { DesignProjectManager, loadDesignKit } from '../../core/lib/index.js'
import { companionFs, openCompanionProject } from '../src/project.mjs'
import { assertCompanionKitContributions, createCompanionContentLibrary } from '../src/content-library.mjs'
import { createCompanionStudio } from '../src/studio.mjs'

test('Companion reopens the retained exact closure after editable Kit and Bundle sources disappear', async t => {
  const root = await mkdtemp(join(tmpdir(), 'companion-content-library-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const original = join(root, 'source')
  const source = await writeContentCatalog(original)
  const compiled = await loadDesignKit(companionFs, original, { sourceId: 'companion:explicit-kit' })
  const kitRoot = join(root, 'installed/kits/catalog_fixture')
  await cp(source.kitRoot, kitRoot, { recursive: true })
  await cp(join(original, 'bundles'), join(root, 'installed/bundles'), { recursive: true })
  await writeFile(join(kitRoot, 'kit.yaml'), stringify({ version: 1, mounts: compiled.skills.map(skill => ({
    bindingKey: skill.name, name: skill.name, version: String(skill.version),
  })) }))
  const options = { fs: companionFs, kitRoot, stateRoot: join(root, 'state') }
  const library = createCompanionContentLibrary(options)
  const kit = await library.store.retainKitClosure(kitRoot, { sourceId: 'companion:explicit-kit', resolveBundle: async pin => (await import('../../core/lib/index.js')).loadDesignBundle(companionFs, { rootDir: join(root, 'installed/bundles', pin.name), sourceId: 'companion:explicit-kit' }, pin) })
  const pin = { name: kit.name, version: String(kit.version) }
  const first = kit.skills[0], before = await readFile(join(first.resourceRoot, 'SKILL.md'))
  await rm(join(root, 'installed'), { recursive: true })
  const reopened = await createCompanionContentLibrary(options).resolveProject(pin)
  assert.equal(reopened.name, pin.name)
  assert.equal(String(reopened.version), pin.version)
  assert.equal(reopened.skills.length, compiled.skills.length)
  assert.deepEqual(await readFile(join(reopened.skills[0].resourceRoot, 'SKILL.md')), before)
  assert.equal(reopened.skills[0].authority, first.authority)
  for (const name of ['LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md']) {
    const expected = await readFile(join(original, name))
    assert.deepEqual(await readFile(join(reopened.sourceRoot, name)), expected)
    for (const bundle of reopened.skills) assert.deepEqual(await readFile(join(bundle.resourceRoot, name)), expected)
  }
})

test('Bundle catalog exposes the retained Mindset for an explicit package root with nested content', async t => {
  const root = await mkdtemp(join(tmpdir(), 'companion-package-mindset-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = await writeContentCatalog(join(root, 'installed-package'), { name: 'nested_fixture' })
  const kitRoot = source.root
  const sourceMindset = await readFile(join(source.kitRoot, 'mindset.md'), 'utf8')
  await assert.rejects(readFile(join(kitRoot, 'mindset.md')), { code: 'ENOENT' })
  const installed = await loadDesignKit(companionFs, kitRoot, { sourceId: 'companion:explicit-kit' })
  const projectRoot = join(root, 'project')
  await new DesignProjectManager().create({ root: projectRoot, name: 'Nested package Mindset',
    knowledge: { provider: 'ladybug-wasm' }, kit: { name: installed.name, version: installed.version } })
  const api = await openCompanionProject({ projectRoot, kitRoot, stateRoot: join(root, 'state'),
    connection: { host: 'codex', threadId: 'package-mindset-test', send: async () => ({ accepted: true }) } })
  const catalog = await api.listSkills()
  assert.equal(catalog.mindset, installed.name)
  assert.equal(catalog.skills.length, installed.skills.length)
  assert.equal(catalog.mindsetMethod, join(api.installedKit.sourceRoot, 'mindset.md'))
  assert.notEqual(catalog.mindsetMethod, join(kitRoot, 'mindset.md'))
  assert.equal(await readFile(catalog.mindsetMethod, 'utf8'), sourceMindset)
  const prepared = await api.prepareBundle({ skill: catalog.skills[0].id })
  assert.equal(catalog.mindsetMethod, prepared.mindset)
})

// Real source adapters and a fresh CLI process; no native model or installed-package claim.
const execute = promisify(execFile)
const cli = fileURLToPath(new URL('../src/plugin-cli.mjs', import.meta.url))
async function contentFixture(root, name, { version = '1.9', native = false, sentinel, bundleName = `${name}_alpha` } = {}) {
  const kitRoot = join(root, name, version)
  const files = {
    'package.json': JSON.stringify({ name: `fixture-${name}`, designSystem: { kit: {
      root: `kits/${name}`, mindset: `kits/${name}/mindset.md`, manifest: `kits/${name}/kit.yaml`, bundles: 'bundles',
    } } }),
    [`kits/${name}/mindset.md`]: `---\nname: ${name}\nversion: "${version}"\n---\n<design_skills>\n## alpha\nRead the retained alpha method.\n</design_skills>\n`,
    [`kits/${name}/kit.yaml`]: `version: 1\nmounts:\n  - {bindingKey: alpha, name: ${bundleName}, version: "1.0"}\n`,
    [`kits/${name}/LICENSE`]: 'Synthetic fixture license\n',
    [`kits/${name}/NOTICE`]: 'Synthetic fixture notice\n',
    [`bundles/${bundleName}/SKILL.md`]: '---\nname: alpha\ndescription: Retained alpha fixture\n---\nRead [output](reference/artifact-contract.md).\n',
    [`bundles/${bundleName}/skill.yaml`]: stringify({ identity: bundleName, name: 'alpha', version: '1.0',
      title: { zh: 'Alpha', en: 'Alpha' }, label: { zh: 'Alpha', en: 'Alpha' },
      presentation: native ? { mode: 'native', renderer: 'fixture.alpha.panel/v1' } : { mode: 'declarative' },
      execution: { handoff: 'none' },
    }),
    [`bundles/${bundleName}/schema.yaml`]: 'type: object\nproperties:\n  summary: {type: string}\n',
    [`bundles/${bundleName}/validation.yaml`]: 'skill: alpha\nrules:\n  - id: summary\n    scope: [completion]\n    code: alpha.summary\n    message: Summary required\n    check: {non_empty_string: summary}\n',
    [`bundles/${bundleName}/reference/artifact-contract.md`]: '# Retained output\r\nCanonical alpha/alpha.json contains summary.\r\n',
    [`bundles/${bundleName}/reference/sample.bin`]: Buffer.from([0, 255, 128, 42]),
    [`bundles/${bundleName}/assets/pixel.png`]: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
    [`bundles/${bundleName}/LICENSE`]: 'Synthetic fixture license\n',
    [`bundles/${bundleName}/NOTICE`]: 'Synthetic fixture notice\n',
    ...(sentinel ? { [`bundles/${bundleName}/scripts/never-run.mjs`]: `import { writeFileSync } from 'node:fs'\nwriteFileSync(${JSON.stringify(sentinel)}, 'unexpected execution')\nthrow new Error('Content adoption must stay inert')\n` } : {}),
    ...(!native ? { [`bundles/${bundleName}/panel.yaml`]: stringify({ version: 1, panel_kind: 'document', sections: [], fields: [],
      ui: { component: 'stack', id: 'alpha', children: [{ component: 'text_block', id: 'guidance', text: 'Retained fixture panel' }] },
    }) } : {}),
  }
  for (const [path, bytes] of Object.entries(files)) {
    await mkdir(dirname(join(kitRoot, path)), { recursive: true })
    await writeFile(join(kitRoot, path), bytes)
  }
  return { kitRoot, files, bundleName }
}
async function studioFixture(kitRoot, stateRoot) {
  const library = createCompanionContentLibrary({ fs: companionFs, kitRoot, stateRoot })
  const kit = await library.loadInstalled()
  return { library, kit, studio: await createCompanionStudio(kit, kitRoot, stateRoot, library) }
}
async function exportAndImport(author, receiver) {
  const source = await author.studio.exportContentArchive({ kind: 'kit', pin: { name: author.kit.name, version: author.kit.version },
    provenance: { source: 'fixture:independent-author', license: 'Synthetic fixture only' } })
  const archive = receiver.studio.readArchive({ source })
  return { instance: await receiver.studio.importInstanceSources({ kind: archive.kind, title: archive.title,
    files: archive.files.map(({ path, base64 }) => ({ path, base64 })) }) }
}
function commandFixture(kitRoot, stateRoot, projectsRoot) {
  return async input => JSON.parse((await execute(process.execPath, ['--experimental-transform-types', cli, 'command',
    '--kit', kitRoot, '--state-root', stateRoot, '--projects-root', projectsRoot,
    '--host', 'codex', '--thread', 'isolated-retained-selection', '--input', input], { timeout: 30_000 })).stdout)
}

test('ordinary binary assets survive source import, S2 Kit edit, preview and durable reopen', async t => {
  const root = await mkdtemp(join(tmpdir(), 'companion-binary-draft-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const base = await contentFixture(root, 'receiver_base')
  const sentinel = join(root, 'script-executed')
  const donor = await contentFixture(root, 'binary_donor', { bundleName: 'alpha', sentinel })
  const stateRoot = join(root, 'receiver-state')
  const receiver = await studioFixture(base.kitRoot, stateRoot)
  const author = await studioFixture(donor.kitRoot, join(root, 'author-state'))
  const adopted = await exportAndImport(author, receiver)
  const mindset = await receiver.studio.readInstanceFile({ id: adopted.instance.id, path: 'mindset.md' })
  const copy = await receiver.studio.saveInstanceFile({ id: adopted.instance.id, expectedRevision: 0,
    path: 'mindset.md', content: mindset.content + '\n<!-- Retained binary working-copy edit -->\n' })
  await rm(donor.kitRoot, { recursive: true })
  await rm(join(root, 'author-state'), { recursive: true })
  const reopened = await studioFixture(base.kitRoot, stateRoot)
  assert.deepEqual(await reopened.studio.readInstance({ id: copy.id }), copy)
  const preview = await reopened.studio.previewInstance({ id: copy.id, expectedRevision: 1,
    bundle: { name: 'alpha', version: '1.0' }, sampleSource: '{"summary":"Binary retained"}' })
  assert.deepEqual(preview.diagnostics, [])
  assert.equal(preview.preview.sample.summary, 'Binary retained')
  const exported = JSON.parse(await reopened.studio.exportContentArchive({ id: copy.id, expectedRevision: copy.revision, provenance: { source: 'fixture:binary', license: 'Synthetic fixture' } }))
  for (const path of ['reference/sample.bin', 'assets/pixel.png']) {
    const file = exported.files.find(file => file.path.endsWith('/' + path))
    assert.deepEqual(Buffer.from(file.base64, 'base64'), donor.files[`bundles/alpha/${path}`])
  }
  await assert.rejects(readFile(sentinel), { code: 'ENOENT' }, 'export/import/adopt/preview never execute scripts')
})

test('adopting native IDs stays inert and cannot borrow another Bundle authority at selection', async t => {
  const root = await mkdtemp(join(tmpdir(), 'companion-adopt-native-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const base = await contentFixture(root, 'receiver_native', { native: true })
  const donor = await contentFixture(root, 'untrusted_native', { native: true })
  const stateRoot = join(root, 'receiver-state')
  const receiver = await studioFixture(base.kitRoot, stateRoot)
  const adopted = await exportAndImport(await studioFixture(donor.kitRoot, join(root, 'author-state')), receiver)
  const command = commandFixture(base.kitRoot, stateRoot, join(root, 'projects'))
  await command('new Native trust')
  await assert.rejects(command('mindset ' + adopted.instance.kit.name), /required Host native Panel contribution.*Bundle authority/)
  assert.equal((await command('status')).selected.kit, undefined)
  assert.equal((await command('mindset receiver_native')).selected.kit.name, 'receiver_native')
})

test('selection contribution guard binds every executable reference to its installed authority', () => {
  const references = [
    { skillManifest: { runtime: { driver: 'fixture.runtime/v1' } } },
    { skillManifest: { presentation: { mode: 'native', renderer: 'fixture.panel/v1' } } },
    { skillManifest: { capabilities: ['fixture.capability/v1'] } },
    { validationDocument: { rules: [{ check: { driver: 'fixture.validation/v1' } }] } },
  ]
  for (const metadata of references) {
    const kit = authority => ({ skills: [{ authority, metadata }] })
    assert.doesNotThrow(() => assertCompanionKitContributions(kit('trusted'), kit('trusted')))
    assert.throws(() => assertCompanionKitContributions(kit('imported'), kit('trusted')), /required Host.*contribution/)
    assert.throws(() => assertCompanionKitContributions(kit('trusted'), { skills: [] }), /required Host.*contribution/)
  }
  assert.doesNotThrow(() => assertCompanionKitContributions({ skills: [{ authority: 'imported', metadata: {
    skillManifest: { presentation: { mode: 'declarative' }, semantic_capabilities: ['fixture.semantic/v1'] },
  } }] }, { skills: [] }))
})

test('mindset name discovery tolerates conflicting same-pin source without retaining it', async t => {
  const root = await mkdtemp(join(tmpdir(), 'companion-readonly-catalog-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = await writeContentCatalog(join(root, 'content'))
  const library = createCompanionContentLibrary({ fs: companionFs, kitRoot: source.kitRoot, stateRoot: join(root, 'state') })
  const installed = await library.loadInstalled()
  const mindset = join(source.kitRoot, 'mindset.md')
  const original = await readFile(mindset, 'utf8')
  await writeFile(mindset, original + '\nChanged mutable method at the same version.\n')
  const reader = createCompanionContentLibrary({ fs: companionFs, kitRoot: source.kitRoot, stateRoot: join(root, 'state') })
  assert.ok((await reader.availableMindsetNames()).includes(installed.name))
  assert.match((await reader.loadInstalled()).mindsetSource, /Changed mutable method/)
})
