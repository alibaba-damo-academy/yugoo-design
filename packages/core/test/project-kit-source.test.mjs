import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadDesignKit, loadDesignBundle } from '../src/kit-loader.ts'
import { contentNodeFs, DesignContentStore } from '../src/content-store.ts'
import { ensureProjectKit, loadProjectKit } from '../src/project-kit-source.ts'
import { composeProjectKit } from '../src/project-content.ts'
import { writeContentCatalog, writeContentBundle } from './fixtures/content-catalog.mjs'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'project-current-kit-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = await writeContentCatalog(join(root, 'library'), { bundles: [{ name: 'alpha', files: { 'reference/a.bin': Buffer.from([0,255,128]) } }] })
  const options = { sourceId: 'trusted:project-source-fixture' }
  const kit = await loadDesignKit(contentNodeFs, source.root, options)
  const project = join(root, 'project')
  await mkdir(project)
  return { root, source, options, kit, project }
}

test('project owns full current sources and resources, independent from later library edits', async t => {
  const f = await fixture(t)
  const initial = await ensureProjectKit(f.project, { loadSource: async () => f.kit })
  assert.equal(initial.kit.sourceRoot, join(f.project, 'design_kit/kit'))
  const skill = initial.kit.skills[0], bundleRoot = join(f.project, 'design_kit/bundles/alpha')
  assert.equal(skill.resourceRoot, bundleRoot)
  assert.equal(skill.authority, f.kit.skills[0].authority)
  assert.deepEqual(await readFile(join(bundleRoot, 'reference/a.bin')), Buffer.from([0,255,128]))
  await writeFile(join(f.source.bundlesRoot, 'alpha/SKILL.md'), 'broken library now')
  assert.equal((await ensureProjectKit(f.project, { loadSource: () => { throw new Error('must not consult library') } })).revision, initial.revision)
  const method = await readFile(join(bundleRoot, 'SKILL.md'), 'utf8')
  await writeFile(join(bundleRoot, 'SKILL.md'), method + '\nCurrent project instruction.\n')
  const next = await loadProjectKit(f.project)
  assert.notEqual(next.revision, initial.revision)
  assert.match(next.kit.skills[0].content, /Current project instruction/)
  assert.equal(next.kit.skills[0].resourceRoot, bundleRoot)
  await writeFile(join(bundleRoot, 'skill.yaml'), (await readFile(join(bundleRoot, 'skill.yaml'), 'utf8')).replace('0.1', '99.0'))
  assert.equal((await loadProjectKit(f.project)).kit.skills[0].version, '99.0', 'source version is provenance, not a mount lock')
  await writeFile(join(bundleRoot, 'skill.yaml'), (await readFile(join(bundleRoot, 'skill.yaml'), 'utf8')).replace(/^version:.*\n/m, ''))
  assert.ok((await loadProjectKit(f.project)).kit.skills[0], 'current source does not require release metadata')
})

test('a real retained closure with effective Bundle override materializes after library removal', async t => {
  const f = await fixture(t), store = new DesignContentStore(join(f.root, 'old-host'))
  const base = await store.retainKitClosure(f.source.root, f.options)
  const replacement = await writeContentBundle(join(f.root, 'replacement'), { name: 'alpha', version: '0.2', files: { 'reference/override.bin': Buffer.from([1,2,255]) } })
  const target = await store.retainBundle(replacement.root, f.options)
  const effective = composeProjectKit({ name: base.name, version: base.version, bundles: { alpha: '0.2' } }, base, [target])
  await rm(f.source.root, { recursive: true })
  await rm(replacement.root, { recursive: true })
  const result = await ensureProjectKit(f.project, { loadSource: async () => effective })
  assert.equal(result.kit.skills[0].version, '0.2')
  assert.deepEqual(await readFile(join(result.kit.skills[0].resourceRoot, 'reference/override.bin')), Buffer.from([1,2,255]))
})

test('existing empty or malformed project source reports actual errors without fallback', async t => {
  const f = await fixture(t)
  await mkdir(join(f.project, 'design_kit'))
  let fallback = 0
  await assert.rejects(ensureProjectKit(f.project, { loadSource: async () => { fallback++; return f.kit } }), /source.json/)
  assert.equal(fallback, 0)
  await rm(join(f.project, 'design_kit'), { recursive: true })
  const saved = await ensureProjectKit(f.project, { loadSource: async () => f.kit })
  await writeFile(join(saved.kit.skills[0].resourceRoot, 'schema.yaml'), 'type: [\n')
  await assert.rejects(ensureProjectKit(f.project, { loadSource: async () => { fallback++; return f.kit } }))
  assert.equal(fallback, 0)
})

test('source copying rejects symlinks and keeps project data intact on failure', async t => {
  const f = await fixture(t)
  await writeFile(join(f.project, 'human-data.json'), '{"keep":true}')
  await symlink(join(f.project, 'human-data.json'), join(f.source.bundlesRoot, 'alpha/reference/symlink'))
  await assert.rejects(ensureProjectKit(f.project, { loadSource: async () => f.kit }), /symlink/)
  assert.equal(await readFile(join(f.project, 'human-data.json'), 'utf8'), '{"keep":true}')
})
