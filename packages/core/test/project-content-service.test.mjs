import test from 'node:test'
import assert from 'node:assert/strict'
import { AsyncLocalStorage } from 'node:async_hooks'
import { mkdtemp, mkdir, rm, readFile, writeFile, stat, lstat, readdir, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import DesignService, { DesignProjectRegistry, DesignJournalRegistry, DesignBundleContributionRegistry,
  nodeDesignProjectSpawn, ProjectContentPanelGuard } from '../lib/index.js'
const nodeFs = { readText: async path => { try { return await readFile(path, 'utf8') } catch (error) { if (error.code === 'ENOENT') return undefined; throw error } },
  writeText: (path, text) => writeFile(path, text), mkdir: path => mkdir(path, { recursive: true }), stat, lstat, listDir: readdir, realPath: realpath }

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'project-content-service-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const projects = new DesignProjectRegistry({ projectsRoot: join(root, 'projects'), stateRoot: join(root, 'runtime') })
  let project = await projects.create('same identity', { provider: 'ladybug-wasm' })
  await projects.setKitPin(project.projectId, { name: 'fixture', version: '1.0' })
  project = await projects.require(project.projectId)
  const owner = { id: 'owner' }, other = { id: 'other' }, binding = { projectId: project.projectId, revision: 1 }
  const service = Object.create(DesignService.prototype), changes = []
  Object.assign(service, { projects, bindings: { read: async () => binding }, hostInstanceId: 'isolated',
    activeWorkspaces: new WeakMap(), contentRecoveryLocations: new WeakMap(), workspaceContentEpochs: new WeakMap(), projectContentEpochs: new Map(),
    selectedAgents: new Set(), selectedAgentRefs: new WeakMap(), contentPanelGuards: new Map(),
    projectMutations: new Map(), projectMutationScope: new AsyncLocalStorage(), workspaceReadScope: new AsyncLocalStorage(),
    workspaceGitReaders: new Map(), knowledgeLifecycles: new Map(), executionObservations: new WeakMap(),
    kits: new Map(), retainedKits: new Map(), independentBundles: new Map(), contributions: new DesignBundleContributionRegistry(),
    journals: new DesignJournalRegistry(state => join(state, 'journal')), spawnAdapter: () => nodeDesignProjectSpawn,
    notifyWorkspaceChange: change => changes.push(change) })
  for (const version of ['1.0', '1.1']) service.registerRetainedKit({ name: 'fixture', version,
    mindset: 'Complete unchanged professional method.', mindsetSource: 'Complete unchanged professional method.', skills: [], resources: {} })
  for (const agent of [owner, other]) service.setActiveWorkspace(agent, { binding, project, checkpoint: '', values: {} })
  const migrate = () => service.contentMigrationFor(owner, { assertQuiescent: () => service.assertContentUpgradeQuiescent(project.projectId),
    verifyNativeProducer: async proof => { assert.equal(proof, 'trusted-host-test-receipt') } })
  return { root, project, service, owner, other, changes, migrate }
}

test('same-project adoption invalidates every selected session; old stores remain rejected after reopen', async t => {
  const f = await fixture(t)
  const old = await f.service.designFilesForProject(f.owner, f.project.projectId, nodeFs)
  const display = await f.service.displayFilesForProject(f.other, f.project, nodeFs)
  const migration = await f.migrate(), plan = await migration.prepare({ name: 'fixture', version: '1.1' })
  const receipt = await migration.finish(plan.id, 'trusted-host-test-receipt', { status: 'equivalent', summary: 'UI/method compatible; no saved data needs rewriting.', sources: [], unresolvedFacts: [] })
  assert.equal(receipt.projectId, f.project.projectId)
  assert.throws(() => f.service.requireKitForAgent(f.other), /content changed/)
  await assert.rejects(old.head(), /content changed/)
  await assert.rejects(display.head(), /content changed/)
  for (const agent of [f.owner, f.other]) {
    assert.equal((await f.service.projectForAgent(agent)).kit.version, '1.1')
    assert.equal(f.service.requireKitForAgent(agent).version, '1.1')
  }
  await assert.rejects(old.head(), /previous content version/)
  await assert.rejects(old.writeWorktreeText('anything/new.json', '{}'), /previous content version/)
  await assert.rejects(display.head(), /previous content version/)
  assert.ok(await (await f.service.designFilesForProject(f.owner, f.project.projectId, nodeFs)).head())
  assert.equal((await f.service.projectForAgent(f.owner)).root, f.project.root)
  assert.equal(f.changes.filter(change => change.kind === 'selection-changed').length, 2)
})

test('recovery marker blocks cached Kit and existing scoped reads/writes before metadata refresh', async t => {
  const f = await fixture(t), store = await f.service.designFilesForProject(f.owner, f.project.projectId, nodeFs)
  await mkdir(join(f.project.root, '.git/design-system-content-adoption'))
  assert.throws(() => f.service.requireKitForAgent(f.owner), /requires recovery/)
  await assert.rejects(store.head(), /requires recovery/)
  await assert.rejects(store.writeWorktreeText('anything/new.json', '{}'), /requires recovery/)
})

test('other-session real execution observations and missing/dirty Panel observations block both upgrade boundaries', async t => {
  const f = await fixture(t)
  f.service.executionObservations.set(f.other, { revision: 1, attempts: [{ projectId: f.project.projectId, attemptId: 'owned-run', phase: 'working' }] })
  await assert.rejects((await f.migrate()).prepare({ name: 'fixture', version: '1.1' }), /still running/)
  f.service.executionObservations.set(f.other, { revision: 2, attempts: [{ projectId: f.project.projectId, attemptId: 'owned-run', phase: 'working' }, { projectId: f.project.projectId, attemptId: 'owned-run', phase: 'completed' }] })
  const migration = await f.migrate(), plan = await migration.prepare({ name: 'fixture', version: '1.1' })
  await f.service.observeProjectPanel(f.other, { projectId: f.project.projectId, pageId: '11111111-1111-4111-8111-111111111111', sequence: 1, dirty: false, saving: false, lifecycle: 'opened' })
  await assert.rejects(migration.finish(plan.id, 'trusted-host-test-receipt', { status: 'equivalent', summary: 'unchanged', sources: [], unresolvedFacts: [] }), /missing/)
  await f.service.observeProjectPanel(f.other, { projectId: f.project.projectId, pageId: '11111111-1111-4111-8111-111111111111', sequence: 2, dirty: true, saving: false })
  await assert.rejects(migration.finish(plan.id, 'trusted-host-test-receipt', { status: 'equivalent', summary: 'unchanged', sources: [], unresolvedFacts: [] }), /draft/)
  assert.equal((await f.service.projectForAgent(f.owner)).kit.version, '1.0')
})

test('a still-running native attempt remains a guard after bounded display history evicts its row', async t => {
  const f = await fixture(t), projectId = f.project.projectId
  f.service.recordExecutionAttempt(f.other, { projectId, attemptId: 'long-running', phase: 'working' })
  for (let i = 0; i < 501; i++) f.service.recordExecutionAttempt(f.other, { projectId, attemptId: `terminal-${i}`, phase: 'completed' })
  assert.equal(f.service.executionAttemptsFor(f.other, projectId).some(item => item.attemptId === 'long-running'), false)
  await assert.rejects(f.service.assertContentUpgradeQuiescent(projectId), /still running/)
  f.service.recordExecutionAttempt(f.other, { projectId, attemptId: 'long-running', phase: 'completed' })
  await f.service.assertContentUpgradeQuiescent(projectId)
})

test('abandoned pages require a real Host user-question answer and exact still-disconnected observation version', async t => {
  const f = await fixture(t), projectId = f.project.projectId
  let time = 0, answer = '保留并返回原页面', reconnect = false, asked = 0
  const guard = new ProjectContentPanelGuard(projectId, 1000, () => time)
  f.service.contentPanelGuards.set(projectId, guard)
  const page = { projectId, pageId: '11111111-1111-4111-8111-111111111111', dirty: true, saving: false }
  guard.observe({ ...page, sequence: 1 }); time += 1001
  f.service.context = { userQuestions: { async ask(input) {
    asked++; assert.equal(input.agent, f.owner)
    if (reconnect) guard.observe({ ...page, sequence: 2 })
    return { answers: [{ id: input.questions[0].id, selected: [answer] }] }
  } } }
  assert.deepEqual(await f.service.resolveDisconnectedProjectPanels(f.owner, new AbortController().signal), { discarded: 0 })
  assert.throws(() => guard.assertQuiescent(), /disconnected/)
  answer = '确认放弃未保存编辑'; reconnect = true
  await assert.rejects(f.service.resolveDisconnectedProjectPanels(f.owner, new AbortController().signal), /changed/)
  assert.throws(() => guard.assertQuiescent(), /draft/)
  reconnect = false; time += 1001
  assert.deepEqual(await f.service.resolveDisconnectedProjectPanels(f.owner, new AbortController().signal), { discarded: 1 })
  guard.assertQuiescent(); assert.equal(asked, 3)
  assert.equal((await f.service.projectForAgent(f.owner)).kit.version, '1.0', 'disposition never adopts or saves project content')
})
