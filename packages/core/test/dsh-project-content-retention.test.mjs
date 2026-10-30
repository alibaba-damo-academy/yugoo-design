/** Actual DSH Service constructor, loader and project selection over isolated Node storage/Git.
 * Host prompt/tool registration and knowledge lifecycle are finite fixtures; no model or running Host. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import DesignService from '../src/design-service.ts'
import { apply, loadConfiguredDesignKit } from '../src/kit-loader-plugin.ts'
import { contentNodeFs } from '../src/content-store.ts'
import { nodeDesignProjectSpawn } from '../src/design-project.ts'
import { DesignPanelRemote } from '../src/panel-remote.ts'
import { projectKitContentHash } from '../src/project-content.ts'
import { designClarityDigest, parseDesignClarityReported } from '../src/design-clarity-report.ts'
import { commitDesignProjectRecords } from '../src/design-project-records.ts'
import { nodeFs } from '../src/service-tools.ts'
import { writeContentCatalog, writeContentBundle } from './fixtures/content-catalog.mjs'

async function sourceFiles(root, prefix = '') {
  const files = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = prefix + entry.name
    if (entry.isDirectory()) files.push(...await sourceFiles(join(root, entry.name), path + '/'))
    else files.push({ path, base64: (await readFile(join(root, entry.name))).toString('base64') })
  }
  return files
}

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-accepted-content-'))
  const oldHome = process.env.DSH_HOME
  const oldGit = process.env.YUGOO_GIT_BACKEND
  process.env.DSH_HOME = join(root, 'home')
  process.env.YUGOO_GIT_BACKEND = 'cli' // Real Git; this source test does not build the unchanged worker entry.
  const stateRoot = join(root, 'runtime'), projectsRoot = join(root, 'projects'), sourceRoot = join(root, 'source')
  const definition = async (version = '1.1', bundleVersion = '1.0') => writeContentCatalog(sourceRoot, {
    version, bundles: [{ name: 'alpha', version: bundleVersion,
      files: { 'reference/preserved.bin': Buffer.from([0, 255, 128, bundleVersion === '1.0' ? 1 : 2]) } }, { name: 'beta', version: '1.0' }],
  })
  const source = await definition()
  const packageName = 'fixture-catalog_fixture', host = join(root, 'host')
  await mkdir(join(host, 'node_modules'), { recursive: true })
  await symlink(sourceRoot, join(host, 'node_modules', packageName), 'dir')
  const services = []
  t.after(async () => {
    for (const f of services.reverse()) await f.close()
    if (oldHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = oldHome
    if (oldGit === undefined) delete process.env.YUGOO_GIT_BACKEND; else process.env.YUGOO_GIT_BACKEND = oldGit
    await rm(root, { recursive: true, force: true })
  })
  let number = 0
  async function start({ contentStateRoot, legacyRoot, discovery = false, watch = false, extraBundles } = {}) {
    const ctx = new Context()
    ctx.provide('systemPrompt', { section() {}, context() {} })
    ctx.provide('tools', { register() {}, get() {} })
    let preExecute
    const on = ctx.on.bind(ctx)
    ctx.on = (name, ...args) => { if (name === 'tools/pre-execute') preExecute = args[0]; return on(name, ...args) }
    ctx.provide('subprocess', {})
    const service = new DesignService(ctx, { stateRoot, projectsRoot, hostInstanceId: 'isolated', ...(contentStateRoot ? { contentStateRoot } : {}) })
    service.spawnAdapter = () => nodeDesignProjectSpawn
    service.requireKnowledgeRuntime = () => ({ defaultProvider: 'fixture' })
    service.advisoryRuntimeStatus = () => undefined
    service.knowledgeLifecycleFor = () => ({ prepare: async () => ({ finalize: async () => ({}), abort: async () => {} }), close: async () => {}, restore: async () => {} })
    service.notifyWorkspaceChange = () => {}
    const agent = { id: `isolated-${++number}`, session: { header: {} } }, signal = new AbortController().signal
    const disposers = [], warnings = []
    const config = { watch, watchUsePolling: true, watchPollIntervalMs: 20, watchStabilityThresholdMs: 40, watchDebounceMs: 20,
      ...(legacyRoot ? { contentStateRoot: legacyRoot } : {}),
      ...(discovery ? { discoveryRoots: [join(sourceRoot, 'kits')], bundleRoots: [{ rootDir: source.bundlesRoot, sourceId: 'package:independent' }] }
        : { packageName, discoveryRoots: [], ...(extraBundles ? { bundleRoots: [{ rootDir: extraBundles, sourceId: 'package:fixture-catalog_fixture' }] } : {}) }) }
    const loader = { design: service, baseUrl: pathToFileURL(join(host, 'host.mjs')).href,
      effect: fn => disposers.push(fn()), logger: { warn: text => warnings.push(String(text)) } }
    const unload = async () => { for (const dispose of disposers.splice(0).reverse()) await dispose?.() }
    let closed = false
    const f = { service, agent, signal, warnings, unload, guard: execution => preExecute({ agent, signal, ...execution }, async () => ({ kind: 'allow' })), reload: async () => { await unload(); await apply(loader, config) },
      async create(name = 'saved project') {
        const result = await service.executeProjectCommand(agent, `new ${name}`, signal)
        assert.equal(result.kind, 'success', result.text)
        return service.projects.require((await service.currentSelection(agent)).projectId)
      },
      async open(id) { const result = await service.executeProjectCommand(agent, `open ${id}`, signal); assert.equal(result.kind, 'success', result.text) },
      async accept() { return service.selectProjectMindset(agent, 'catalog_fixture', signal) },
      async close() { if (!closed) { closed = true; await unload(); await ctx.fiber.dispose() } },
    }
    services.push(f)
    await apply(loader, config)
    return f
  }
  return { root, stateRoot, sourceRoot, source, start, definition,
    index: contentRoot => readFile(join(contentRoot ?? stateRoot, 'content/index.json'), 'utf8') }
}


for (const discovery of [false, true]) test(`${discovery ? 'discovered' : 'packaged'} project source survives library changes and fresh Service, without a local release`, async t => {
  const f = await fixture(t), first = await f.start({ discovery })
  const project = await first.create()
  await first.accept()
  const accepted = first.service.requireKitForAgent(first.agent)
  assert.equal(accepted.sourceRoot, join(project.root, 'design_kit/kit'))
  const alpha = accepted.skills.find(skill => skill.name === 'alpha')
  const oldMethod = alpha.content
  await first.close()
  await f.definition('1.2', '1.1')
  const restarted = await f.start({ discovery })
  await restarted.open(project.projectId)
  const old = restarted.service.requireKitForAgent(restarted.agent)
  assert.equal(old.skills.find(skill => skill.name === 'alpha').content, oldMethod)
  assert.deepEqual(await readFile(join(old.skills.find(skill => skill.name === 'alpha').resourceRoot, 'reference/preserved.bin')), Buffer.from([0, 255, 128, 1]))
  await restarted.accept()
  assert.equal(restarted.service.requireKitForAgent(restarted.agent).version, '1.1')
  const next = await restarted.create('next project')
  await restarted.accept()
  assert.equal(restarted.service.requireKitForAgent(restarted.agent).version, '1.2')
  assert.equal((await restarted.service.projects.require(project.projectId)).kit.version, '1.1')
  assert.notEqual(next.root, project.root)
})

test('current project source changes refresh subsequent methods and invalidate already issued stores without a reopen gate', async t => {
  const f = await fixture(t), host = await f.start()
  const project = await host.create(); await host.accept()
  const before = host.service.requireKitForAgent(host.agent), source = before.skills.find(skill => skill.name === 'alpha').resourceRoot
  const files = await host.service.designFilesForProject(host.agent, project.projectId, contentNodeFs)
  const method = await readFile(join(source, 'SKILL.md'), 'utf8')
  await writeFile(join(source, 'SKILL.md'), method + '\nNew project instruction.\n')
  await host.service.refreshProjectKit(host.agent)
  assert.match(host.service.requireKitForAgent(host.agent).skills.find(skill => skill.name === 'alpha').content, /New project instruction/)
  await assert.rejects(files.head(), /previous content/)
  assert.equal((await host.service.projectForAgent(host.agent)).projectId, project.projectId)
  await rm(f.sourceRoot, { recursive: true })
  await host.accept()
  assert.match(host.service.requireKitForAgent(host.agent).skills.find(skill => skill.name === 'alpha').content, /New project instruction/)
})

test('new project selection uses Host current-source port; existing projects never reconsult it', async t => {
  const f = await fixture(t), host = await f.start()
  const library = host.service.listKits()[0]
  let loads = 0
  const dispose = host.service.registerCurrentKitSource({ load: async name => { loads++; assert.equal(name, library.name); return library }, list: async () => [{ name: library.name, version: library.version }] })
  await host.create(); await host.accept()
  assert.equal(loads, 1)
  await host.accept()
  assert.equal(loads, 1)
  await host.create('another'); await host.accept()
  assert.equal(loads, 2)
  dispose()
})

test('Panel clarity follows project definitions after library removal; system records stay fresh and real changes expire it', async t => {
  const f = await fixture(t), host = await f.start()
  const project = await host.create(); await host.accept()
  const methodPath = join(project.root, 'design_kit/bundles/alpha/SKILL.md')
  const method = await readFile(methodPath, 'utf8')
  await writeFile(methodPath, method + '\nProject-owned instruction before assessment.\n')
  await host.service.refreshProjectKit(host.agent)
  const kit = host.service.requireKitForAgent(host.agent)
  const pin = (await host.service.projects.require(project.projectId)).kit
  assert.notEqual(projectKitContentHash(kit), projectKitContentHash(host.service.resolveProjectKit(pin)),
    'the library and project have the same identity but different current content')
  const remote = Object.create(DesignPanelRemote.prototype)
  Object.assign(remote, { design: host.service, worktreeProjections: new Map() })
  const read = () => remote.readWorkspace(host.agent, host.signal)
  const files = () => host.service.designFilesForProject(host.agent, project.projectId, nodeFs)
  const report = async () => {
    const checkpoint = await (await files()).head()
    const input = { summary: 'Saved project evidence.', u: { score: 72, evidence: 'User intent.' },
      s: { score: 55, evidence: 'Saved structure.' }, t: { score: 40, evidence: 'Observable outcome.' } }
    const current = host.service.requireKitForAgent(host.agent)
    await host.service.reportClarity(host.agent, parseDesignClarityReported({ ...input, origin: 'main-agent',
      kit: current.name, version: current.version, kitContentHash: projectKitContentHash(current),
      digest: designClarityDigest(input, current.name, current.version) }),
    { expectedProjectId: project.projectId, assessedCheckpoint: checkpoint, signal: host.signal })
    return checkpoint
  }
  const assessedCheckpoint = await report()
  let snapshot = await read()
  assert.equal(snapshot.publicationError, undefined)
  assert.equal(snapshot.access.mode, 'writable')
  assert.equal(snapshot.clarity.needsReassessment, false, 'the report used the project content, not the library copy')
  assert.deepEqual(snapshot.clarity.assessment, { kit: kit.name, version: kit.version, u: 72, s: 55, t: 40 })

  await host.unload()
  assert.equal(host.service.resolveProjectKit(pin), undefined, 'the library source is no longer registered')
  assert.equal((await read()).clarity.needsReassessment, false, 'project content remains sufficient without the library')
  const recordPaths = ['design_records/reviews/fixture.json', 'design_records/knowledge/archive.json']
  for (const path of recordPaths) {
    await mkdir(join(project.root, path, '..'), { recursive: true })
    await writeFile(join(project.root, path), '{}\n')
  }
  await commitDesignProjectRecords({ projectRoot: project.root, paths: recordPaths, message: 'Record fixture decisions' })
  snapshot = await read()
  assert.notEqual(snapshot.checkpoint, assessedCheckpoint)
  assert.equal(await (await files()).sameDesignEvidenceAt(assessedCheckpoint, snapshot.checkpoint), true)
  assert.equal(snapshot.clarity.needsReassessment, false, 'clarity, journal, review and knowledge commits do not change design evidence')
  assert.equal(snapshot.clarity.explanation.assessedCheckpoint, assessedCheckpoint, 'reading never rewrites the assessment pin')

  await (await files()).write('alpha', { summary: 'New product decision.' }, { origin: 'agent', settleEvent: async () => {} })
  assert.equal((await read()).clarity.needsReassessment, true, 'a real saved product fact expires the assessment')
  const reassessed = await report()
  assert.equal((await read()).clarity.needsReassessment, false)
  await writeFile(methodPath, method + '\nChanged project instruction after assessment.\n')
  snapshot = await read()
  assert.equal(snapshot.checkpoint, await (await files()).head())
  assert.equal(await (await files()).sameDesignEvidenceAt(reassessed, snapshot.checkpoint), true)
  assert.equal(snapshot.clarity.needsReassessment, true, 'changed project definitions expire it even without a Design commit')
})

// Real selected project, actual canonical filesystem paths and registered Core guard.
test('ordinary definition edits pass the Service guard while data, patch moves and symlink escapes remain protected', async t => {
  const f = await fixture(t), active = await f.start()
  const project = await active.create(); await active.accept()
  active.agent.ctx = { tools: { get: () => undefined } }
  active.agent.session.header.cwd = project.root
  const file = join(project.root, 'design_kit/bundles/alpha/SKILL.md')
  const before = await readFile(file, 'utf8')
  assert.equal((await active.guard({ name: 'edit', arguments: { file_path: file, old_string: before, new_string: before + '\nUser definition amendment.\n' } })).kind, 'allow')
  assert.equal((await active.guard({ name: 'write', arguments: { file_path: 'design_kit/bundles/alpha/reference/new.md', content: 'Definition resource' } })).kind, 'allow')
  for (const path of ['design_files/alpha/alpha.json', 'design_records/log.json', 'project.json', '.git/config']) {
    assert.equal((await active.guard({ name: 'edit', arguments: { file_path: path, old_string: '', new_string: 'x' } })).kind, 'deny')
  }
  await symlink(join(project.root, 'design_files'), join(project.root, 'design_kit/alias'))
  assert.equal((await active.guard({ name: 'write', arguments: { file_path: 'design_kit/alias/new.json', content: '{}' } })).kind, 'deny')
  await symlink(f.root, join(project.root, 'design_kit/outside'))
  assert.equal((await active.guard({ name: 'write', arguments: { file_path: 'design_kit/outside/new.txt', content: 'x' } })).kind, 'deny')
  assert.equal((await active.guard({ name: 'apply_patch', arguments: { patch: '*** Update File: design_kit/kit/mindset.md\n*** Move to: project.json' } })).kind, 'deny')
  assert.equal(await readFile(file, 'utf8'), before, 'pre-execute admission itself writes no files')
})
