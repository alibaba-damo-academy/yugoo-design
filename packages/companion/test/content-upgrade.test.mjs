/** HTTP candidate boundary with fixture Host receipts; not native CLI confinement acceptance. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { stringify } from 'yaml'
import { writeContentBundle } from '../../core/test/fixtures/content-catalog.mjs'
import { questionSchema } from '../../core/test/fixtures/declarative-question.mjs'
import { DesignContentStore, DesignProjectManager, GitVersioning, contentNodeFs, loadDesignBundle, nodeDesignProjectSpawn } from '../../core/lib/index.js'
import { startCompanion } from '../src/server.mjs'
import { runCompanionCommand } from '../src/project-commands.mjs'
import { callCompanion } from '../src/connection-file.mjs'
import { staticFixture } from './static-fixture.mjs'

async function fixture(t, adapter) {
  const root = await mkdtemp(join(tmpdir(), 'companion-content-upgrade-'))
  let server
  t.after(async () => { await server?.close(); await rm(root, { recursive: true, force: true }) })
  const sourceId = 'companion:explicit-kit', stateRoot = join(root, 'state'), bundleRoot = join(root, 'bundles')
  await mkdir(bundleRoot)
  for (const version of ['1.0', '1.1']) {
    const path = join(bundleRoot, version)
    await writeContentBundle(path, { name: 'alpha', version, files: {
      'SKILL.md': '---\nname: alpha\ndescription: Retain supplied questions and saved responses.\n---\nRead [the output contract](reference/artifact-contract.md). Preserve saved facts in alpha/alpha.json.\n',
      'skill.yaml': stringify({ name: 'alpha', version, title: { en: 'Alpha', zh: '问题夹具' },
        label: { en: 'Edit Alpha', zh: '编辑问题' }, presentation: { mode: 'declarative' },
        execution: { mode: 'main', handoff: 'none' }, summary: { collections: [{ source: 'questions',
          title: 'Saved questions', title_fields: ['prompt'], fields: ['answer'] }] } }),
      'schema.yaml': stringify({ ...questionSchema, required: ['schema_version', 'questions'] }),
      'validation.yaml': stringify({ skill: 'alpha', rules: [{ id: 'questions', scope: ['completion'],
        code: 'alpha.questions', message: 'Saved questions are required.', check: { non_empty_map: 'questions' } }] }),
      'reference/artifact-contract.md': '# Saved questions\n\nalpha/alpha.json retains schema_version and questions keyed by stable identity, each with prompt and answer.\n',
    } })
  }
  const store = new DesignContentStore(stateRoot)
  const resolver = pin => loadDesignBundle(contentNodeFs, { rootDir: join(bundleRoot, pin.version), sourceId }, pin)
  let kitRoot
  for (const version of ['1.9', '1.10']) {
    kitRoot = join(root, 'installed/kits', `kit-${version}`); await mkdir(kitRoot, { recursive: true })
    await writeFile(join(kitRoot, 'mindset.md'), `---\nname: version_fixture\nversion: "${version}"\n---\n<design_skills>\n\n## alpha\n\nQuestions and saved decisions.\n\n</design_skills>\n`)
    await writeFile(join(kitRoot, 'kit.yaml'), `version: 1\nmounts: [{bindingKey: alpha, name: alpha, version: "${version === '1.9' ? '1.0' : '1.1'}"}]\n`)
    await store.retainKitClosure(kitRoot, { sourceId, resolveBundle: resolver })
  }
  // The configured installation may be older than a separately published retained version.
  await cp(join(bundleRoot, '1.0'), join(root, 'installed/bundles/alpha'), { recursive: true })
  kitRoot = join(root, 'installed/kits/kit-1.9')
  const projectRoot = join(root, 'project'), manager = new DesignProjectManager()
  const project = await manager.create({ root: projectRoot, name: 'Saved decisions', kit: { name: 'version_fixture', version: '1.9' }, knowledge: { provider: 'ladybug-wasm' } })
  const file = 'design_files/alpha/alpha.json'
  await mkdir(join(projectRoot, 'design_files/alpha'))
  const state = { schema_version: 1, questions: { stable: { prompt: 'Saved user fact?', answer: 'preserve me' } } }
  await writeFile(join(projectRoot, file), JSON.stringify(state))
  const git = new GitVersioning(nodeDesignProjectSpawn, projectRoot)
  await git.commitExact('saved answers', new Map([[file, await readFile(join(projectRoot, file))]]), await git.head())
  const threadId = randomUUID()
  server = await startCompanion({ ...await staticFixture(root), projectRoot, stateRoot, kitRoot, host: 'codex', threadId,
    contentUpgradeAdapter: adapter, knowledgeAutoRefresh: false, embedding: { provider: 'disabled' },
    knowledgeRuntime: async () => { throw new Error('KAG disabled in candidate boundary fixture') },
    connection: { host: 'codex', threadId, send: async () => ({ accepted: true }) },
  })
  return { root, projectRoot, project, stateRoot, kitRoot, threadId, git, state, file, call: (method, params = {}) => callCompanion(server.connectionPath, { method, params }) }
}

test('unverified CLI adapter rejects only upgrade; ordinary methods and exact retained project remain usable', async t => {
  const f = await fixture(t)
  await assert.rejects(f.call('prepareContentUpgrade', { target: { name: 'version_fixture', version: '1.10' } }), /no verified.*migration Producer/)
  assert.equal((await f.call('prepareBundle', { skill: 'alpha' })).execution.mode, 'main')
  assert.equal(JSON.parse(await readFile(join(f.projectRoot, 'project.json'), 'utf8')).kit.version, '1.9')
})

test('candidate HTTP tools preserve live bytes, reject escapes and enforce full methods and actual draft observations', async t => {
  let projectGuard = 0
  const f = await fixture(t, { assertProjectQuiescent: async () => { projectGuard++ }, verifyNativeConfinement: async () => { throw new Error('Fixture does not prove native confinement') } })
  await f.call('readWorkspace')
  const target = { name: 'version_fixture', version: '1.10' }
  assert.ok((await f.call('prepareContentUpgrade', { target })).id, 'status/readWorkspace without an actual page creates no phantom draft')
  const pageId = randomUUID(), projectId = f.project.metadata.id
  await f.call('observePanelDraft', { projectId, pageId, sequence: 1, dirty: false, saving: false, lifecycle: 'opened' })
  await assert.rejects(f.call('prepareContentUpgrade', { target }), /observation is missing/)
  await f.call('observePanelDraft', { projectId, pageId, sequence: 2, dirty: true, saving: false })
  await assert.rejects(f.call('prepareContentUpgrade', { target }), /every Panel draft/)
  await f.call('observePanelDraft', { projectId, pageId, sequence: 3, dirty: false, saving: false })
  const head = await f.git.head(), before = await readFile(join(f.projectRoot, f.file))
  const plan = await f.call('prepareContentUpgrade', { target })
  const evidence = { status: 'equivalent', summary: 'Compatible version; accepted facts unchanged.', sources: [{ file: f.file, explanation: 'stable key and saved answer preserved' }], unresolvedFacts: [] }
  await assert.rejects(f.call('validateContentUpgrade', { id: plan.id, evidence }), /both complete/)
  for (const side of ['source', 'target']) {
    let offset = 0
    do { offset = (await f.call('readContentUpgradeDefinition', { id: plan.id, side, offset })).nextOffset } while (offset !== null)
  }
  assert.deepEqual((await f.call('listContentUpgradeFiles', { id: plan.id })).files, ['alpha/alpha.json'])
  await assert.rejects(f.call('writeContentUpgradeFile', { id: plan.id, path: '../project.json', content: '{}' }), /relative path/)
  await f.call('writeContentUpgradeFile', { id: plan.id, path: 'alpha/alpha.json', content: '{}' })
  assert.equal((await f.call('validateContentUpgrade', { id: plan.id, evidence })).accepted, false)
  await f.call('writeContentUpgradeFile', { id: plan.id, path: 'alpha/alpha.json', content: JSON.stringify(f.state) })
  assert.deepEqual(await f.call('validateContentUpgrade', { id: plan.id, evidence }), { accepted: true, published: false })
  assert.equal(await f.git.head(), head)
  assert.deepEqual(await readFile(join(f.projectRoot, f.file)), before)
  assert.equal(JSON.parse(await readFile(join(f.projectRoot, 'project.json'), 'utf8')).kit.version, '1.9')
  assert.ok(projectGuard > 0)
})

test('new project selects newest complete installed composition while the old project stays pinned', async t => {
  const f = await fixture(t)
  const options = { host: 'codex', threadId: randomUUID(), projectsRoot: join(f.root, 'new-projects'), stateRoot: f.stateRoot, kitRoot: f.kitRoot }
  await runCompanionCommand({ ...options, input: 'new Fresh' })
  const selected = await runCompanionCommand({ ...options, input: 'mindset version_fixture' })
  assert.equal(selected.selected.kit.version, '1.10')
  assert.equal(JSON.parse(await readFile(join(f.projectRoot, 'project.json'), 'utf8')).kit.version, '1.9')
})
