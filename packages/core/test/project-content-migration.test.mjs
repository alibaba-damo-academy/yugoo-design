import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ProjectContentMigration, DesignProjectManager, GitVersioning, nodeDesignProjectSpawn } from '../lib/index.js'

async function fixture(t) {
  const base = await mkdtemp(join(tmpdir(), 'native-content-migration-'))
  t.after(() => rm(base, { recursive: true, force: true }))
  const root = join(base, 'project'), stateRoot = join(base, 'runtime'), manager = new DesignProjectManager()
  const project = await manager.create({ root, name: 'saved user project', knowledge: { provider: 'ladybug-wasm' }, kit: { name: 'fixture', version: '1.0' } })
  const file = 'design_files/example/example.json', asset = 'design_files/example/visual.bin'
  await mkdir(join(root, 'design_files', 'example'))
  await writeFile(join(root, file), JSON.stringify({ id: 'stable-id', userFact: 'keep my intent', oldName: 'label' }))
  await writeFile(join(root, asset), Buffer.from([0, 255, 16]))
  const git = new GitVersioning(nodeDesignProjectSpawn, root)
  await git.commitExact('saved source', new Map([[file, await readFile(join(root, file))], [asset, await readFile(join(root, asset))]]), await git.head())
  const kit = version => ({ name: 'fixture', version, mindset: 'complete mindset method', mindsetSource: 'complete source', resources: { 'shared/contract.md': 'preserve facts and references' },
    skills: [{ name: 'example', version, content: `complete professional ${version} method`, metadata: { schemaYaml: `target schema ${version}`, panelYaml: `target UI ${version}` } }] })
  const source = kit('1.0'); let target = kit('1.1'), dirty = false, running = false
  const receipts = [], ports = { root, stateRoot, spawn: nodeDesignProjectSpawn, mutate: fn => fn(),
    resolveKit: pin => pin.version === '1.0' ? source : pin.version === '1.1' ? target : undefined,
    assertCompatible: () => {}, assertQuiescent: async () => { if (dirty || running) throw new Error('actual draft or native run') },
    verifyNativeProducer: async proof => { if (proof !== 'host-verified-receipt') throw new Error('not a native receipt') },
    validate: async (_kit, files) => {
      const data = JSON.parse(Buffer.from(files.get(file)).toString())
      assert.equal(data.id, 'stable-id'); assert.equal(data.userFact, 'keep my intent'); assert.equal(data.newName, 'label')
    }, record: async receipt => receipts.push(receipt) }
  const migration = new ProjectContentMigration(ports)
  const evidence = { status: 'equivalent', summary: 'renamed the field without changing its meaning', sources: [{ file, explanation: 'stable identity and saved intent preserved' }], unresolvedFacts: [] }
  const prepare = () => migration.prepare({ name: 'fixture', version: '1.1' })
  const translate = plan => writeFile(join(plan.candidateRoot, file), JSON.stringify({ id: 'stable-id', userFact: 'keep my intent', newName: 'label' }))
  return { project, root, stateRoot, manager, git, migration, prepare, translate, evidence, receipts, file, asset, ports,
    dirty: value => dirty = value, running: value => running = value, drift: () => target = { ...target, mindset: 'changed after authorization' } }
}

test('semantic candidate contains full definitions; only accepted native evidence adopts the same project', async t => {
  const f = await fixture(t), originalHead = await f.git.head(), plan = await f.prepare()
  const definitions = JSON.parse(await readFile(plan.definitions, 'utf8'))
  assert.match(definitions.source.skills[0].content, /complete professional 1.0/)
  assert.match(definitions.target.skills[0].content, /complete professional 1.1/)
  await f.translate(plan)
  assert.equal(await f.git.head(), originalHead, 'candidate conversion never touches the live project')
  await assert.rejects(f.migration.finish(plan.id, 'fabricated-id', f.evidence), /native receipt/)
  const receipt = await f.migration.finish(plan.id, 'host-verified-receipt', f.evidence)
  const reopened = await f.manager.open(f.root)
  assert.equal(reopened.metadata.id, f.project.metadata.id)
  assert.equal(reopened.root, f.root); assert.equal(reopened.metadata.kit.version, '1.1')
  assert.equal(receipt.checkpoint, await f.git.head())
  assert.deepEqual(await readFile(join(f.root, f.asset)), Buffer.from([0, 255, 16]))
  assert.equal((await f.manager.status(reopened)).dirty, false)
})

test('drafts, running work, unresolved facts, missing accounting and target drift cannot repin', async t => {
  const f = await fixture(t), head = await f.git.head()
  f.dirty(true); await assert.rejects(f.prepare(), /draft/); f.dirty(false)
  f.running(true); await assert.rejects(f.prepare(), /native run/); f.running(false)
  const plan = await f.prepare(); await f.translate(plan)
  await assert.rejects(f.migration.finish(plan.id, 'host-verified-receipt', { ...f.evidence, unresolvedFacts: ['new required domain fact'] }), /user input/)
  await assert.rejects(f.migration.finish(plan.id, 'host-verified-receipt', { ...f.evidence, sources: [] }), /every saved canonical/)
  f.dirty(true); await assert.rejects(f.migration.finish(plan.id, 'host-verified-receipt', f.evidence), /draft/); f.dirty(false)
  f.drift(); await assert.rejects(f.migration.finish(plan.id, 'host-verified-receipt', f.evidence), /definitions changed/)
  assert.equal(await f.git.head(), head)
  assert.equal((await f.manager.open(f.root)).metadata.kit.version, '1.0')
})

test('assets, exact authorized target and outside-project candidate boundary are preserved', async t => {
  const f = await fixture(t), plan = await f.prepare(); await f.translate(plan)
  await writeFile(join(plan.candidateRoot, f.asset), 'rewritten asset')
  await assert.rejects(f.migration.finish(plan.id, 'host-verified-receipt', f.evidence), /preserve existing asset/)
  assert.throws(() => new ProjectContentMigration({ ...f.ports, stateRoot: join(f.root, 'runtime') }), /outside the live project/)
  await assert.rejects(f.migration.prepare({ name: 'fork', version: '1.1' }), /catalog identity/)
  assert.equal((await f.manager.open(f.root)).metadata.kit.version, '1.0')
})
