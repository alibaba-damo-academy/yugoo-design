/** Real built Core service, native library Git, journal and project-owned records.
 * Supersedes turn/log/scope authentication tests under the authorized ordinary-report contract.
 * Project/Kit/checkpoint/schema/cancellation/concurrency and pre-write confinement remain tested.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { AsyncLocalStorage } from 'node:async_hooks'
import fsPromises, { mkdtemp, mkdir, readFile, writeFile, readdir, rm, symlink, cp } from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import { join, relative, sep } from 'node:path'
import { Worker } from 'node:worker_threads'
import DesignService, { DesignProjectRegistry, DesignProjectManager, nodeDesignProjectSpawn,
  DesignJournalRegistry, DesignJournalStorage, GitVersioning, commitDesignProjectRecords,
  designProjectRecordsRoot, designClarityDigest, parseDesignClarityReported,
  readDesignClarityAuthority, readCommittedDesignClarityAuthority, writeDesignClarityAuthority, projectKitContentHash,
  readDesignReviewPolicy, writeDesignReviewPolicy, createProducerProjectWorkspace } from '../lib/index.js'
const { register } = await import('tsx/esm/api'); register()
const { registerDesignClarityTool } = await import('../src/dsh-design-clarity-tool.ts')
const { parseDesignClarityMeta } = await import('../src/design-clarity-report.ts')
const { nodeFs } = await import('../src/service-tools.ts')
const { NativeGitExecutor } = await import('../src/git-native-executor.ts')

// Exercise actual commit preparation/native CAS, injecting only the competing
// publication or explicit I/O failure at its last boundary. No Host or model.
async function clarityPublisher(f, beforePublish, run) {
  const executor = new NativeGitExecutor(() => new Worker(new URL('../lib/git-native-worker.js', import.meta.url), { execArgv: [] }))
  let attempts = 0
  const spawn = Object.assign(request => nodeDesignProjectSpawn(request), { native: async request => {
    if (request.operation.kind === 'publish' && request.operation.message === 'Record Design clarity') await beforePublish(++attempts)
    return executor.execute(request)
  } })
  f.design.spawnAdapter = () => spawn
  try { await run(() => attempts) } finally { await executor.close() }
}

function report(kit, score = 60, extra = {}) {
  const input = { summary: 'One bounded design.', u: { score, evidence: 'Recorded intent.' },
    s: { score: 50, evidence: 'Recorded structure.' }, t: { score: 40, evidence: 'Observable outcome.' } }
  return parseDesignClarityReported({ ...input, origin: 'main-agent', kit: kit.name, version: kit.version,
    kitContentHash: projectKitContentHash(kit), digest: designClarityDigest(input, kit.name, kit.version), ...extra })
}
async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'clarity-project-records-'))
  const projects = new DesignProjectRegistry({ projectsRoot: join(root, 'projects'), stateRoot: join(root, 'state'),
    manager: new DesignProjectManager() })
  const journals = new DesignJournalRegistry(projectRoot => join(designProjectRecordsRoot(projectRoot), 'journal'),
    (projectRoot, file) => commitDesignProjectRecords({ projectRoot,
      paths: [relative(projectRoot, file).split(sep).join('/')], message: 'Record project journal' }).then(() => {}))
  try {
    const created = await projects.create('Clarity fixture', { provider: 'ladybug-wasm' })
    await projects.setKitPin(created.projectId, { name: 'fixture', version: '1.0' })
    const project = await projects.require(created.projectId)
    const git = new GitVersioning(nodeDesignProjectSpawn, project.root)
    const commit = await git.head()
    const kit = { name: 'fixture', version: '1.0', skills: [{ name: 'sample', version: '1.0' }] }
    const design = Object.create(DesignService.prototype)
    Object.assign(design, { projects, journals, projectMutations: new Map(), journalMutations: new Map(),
      projectMutationScope: new AsyncLocalStorage(), workspaceReadScope: new AsyncLocalStorage(), workspaceGitReaders: new Map(),
      activeWorkspaces: new WeakMap(), projectContentEpochs: new Map(), workspaceContentEpochs: new WeakMap(),
      resolveProjectKit: () => kit, spawnAdapter: () => nodeDesignProjectSpawn })
    const agent = id => {
      const value = { id, session: { header: {},
        snapshotEvents() { throw Error('Ordinary reports must not inspect native logs') } } }
      design.activeWorkspaces.set(value, { project, binding: { revision: 1 } })
      design.workspaceContentEpochs.set(value, 0)
      return value
    }
    const authority = () => design.readClarityAuthority(project.projectId)
    const journal = () => journals.read(project.root, String(project.projectId))
    const options = { expectedProjectId: project.projectId, assessedCheckpoint: commit }
    await run({ root, design, projects, project, git, commit, kit, agent, journals, authority, journal, options })
  } finally { journals.dispose(); await rm(root, { recursive: true, force: true }) }
}

test('ordinary report needs no native log/turn/call identity; exact repeats are no-ops and same-turn correction is allowed', async () => fixture(async f => {
  const agent = f.agent('first-conversation'), value = report(f.kit)
  const meta = parseDesignClarityMeta({ kind: 'design/clarity', v: 1, ...value })
  assert.deepEqual(meta, value)
  assert.equal(meta.turn, undefined); assert.equal(meta.callId, undefined)
  const first = await f.design.reportClarity(agent, value, f.options)
  assert.deepEqual(first, { journalRevision: 1, replayed: false })
  const saved = await f.git.head()
  assert.notEqual(saved, f.commit)
  assert.equal(await f.git.designEvidenceRevisionAt(saved), await f.git.designEvidenceRevisionAt(f.commit))
  assert.match(await f.git.readTextAt(saved, 'design_records/clarity.json'), /Recorded intent/)
  assert.equal((await f.design.reportClarity(agent, value, f.options)).replayed, true)
  assert.equal(await f.git.head(), saved)
  const corrected = report(f.kit, 75)
  assert.equal((await f.design.reportClarity(agent, corrected, f.options)).replayed, false)
  assert.equal((await f.authority()).report.u.score, 75)
  assert.equal((await f.journal()).revision, 2)
  assert.equal(await f.git.readTextAt(await f.git.head(), 'project.json') !== undefined, true)
}))

test('new conversations share project records, and copying project files preserves scores and reasons without external state', async () => fixture(async f => {
  await f.design.reportClarity(f.agent('conversation-a'), report(f.kit), f.options)
  const a = await f.design.readDesignJournal(f.agent('conversation-a'))
  const b = await f.design.readDesignJournal(f.agent('conversation-b'))
  assert.deepEqual(b, a)
  const copy = join(f.root, 'project-copy')
  await cp(f.project.root, copy, { recursive: true })
  assert.deepEqual(await readDesignClarityAuthority(designProjectRecordsRoot(copy), f.project.projectId), await f.authority())
  assert.deepEqual(await readCommittedDesignClarityAuthority(copy, f.project.projectId), await f.authority())
  const copiedJournal = new DesignJournalStorage(join(designProjectRecordsRoot(copy), 'journal'), {}, { projectRoot: copy })
  assert.deepEqual(await copiedJournal.read(String(f.project.projectId)), a)
}))

test('a concurrent KAG record after clarity preparation retries and returns an actually committed score', async () => fixture(async f => {
  const value = report(f.kit, 80), path = 'design_records/clarity.json'
  await clarityPublisher(f, async attempt => {
    if (attempt === 1) await f.git.commitExact('Concurrent KAG archive', new Map([
      ['design_records/knowledge/archive.json', '{}'],
    ]), await f.git.head())
  }, async attempts => {
    assert.equal((await f.design.reportClarity(f.agent('records-race'), value, f.options)).replayed, false)
    assert.equal(attempts(), 2)
    const committed = JSON.parse(await f.git.readTextAt(await f.git.head(), path))
    assert.equal(committed.report.digest, value.digest)
    assert.equal((await f.authority()).report.u.score, 80)
    assert.equal(await f.git.readTextAt(await f.git.head(), 'design_records/knowledge/archive.json'), '{}')
    assert.equal((await f.journal()).revision, 1)
  })
}))

for (const prior of [false, true]) test(`failed clarity publication ${prior ? 'preserves the last committed score' : 'remains unassessed'} until explicit retry`, async () => fixture(async f => {
  const agent = f.agent('failed-publication'), path = 'design_records/clarity.json'
  if (prior) await f.design.reportClarity(agent, report(f.kit, 60), f.options)
  let fail = true
  const value = report(f.kit, 80)
  await clarityPublisher(f, () => {
    if (fail) throw new Error('Injected clarity publication I/O failure')
  }, async attempts => {
    await assert.rejects(f.design.reportClarity(agent, value, f.options), /Injected clarity publication I\/O failure/)
    assert.equal(attempts(), 1, 'non-CAS failures must not retry')
    const auditRevision = (await f.journal()).revision
    assert.equal(auditRevision, prior ? 2 : 1, 'audit facts do not prove authority publication')
    assert.equal((await readDesignClarityAuthority(designProjectRecordsRoot(f.project.root), f.project.projectId)).report.u.score, 80,
      'the pending file remains available to the explicit report retry')
    const head = await f.git.head()
    assert.equal((await f.authority())?.report.u.score, prior ? 60 : undefined)
    assert.equal((await f.authority())?.report.u.score, prior ? 60 : undefined, 'reads never settle the pending publication')
    assert.equal(await f.git.head(), head)
    const committed = await f.git.readTextAt(head, path)
    assert.equal(committed === undefined ? undefined : JSON.parse(committed).report.u.score, prior ? 60 : undefined)
    fail = false
    const retried = await f.design.reportClarity(agent, value, f.options)
    assert.equal(retried.replayed, true)
    assert.equal((await f.journal()).revision, auditRevision, 'explicit retry must not duplicate the audit fact')
    assert.equal((await f.authority()).report.u.score, 80)
    assert.equal(JSON.parse(await f.git.readTextAt(await f.git.head(), path)).report.digest, value.digest)
  })
}))

test('project record reads do not fall back to old runtime authority or change Git', async () => fixture(async f => {
  await writeDesignClarityAuthority(f.project.stateRoot, { schemaVersion: 1, projectId: f.project.projectId,
    assessedCheckpoint: f.commit, report: report(f.kit) })
  assert.equal(await f.authority(), undefined)
  assert.equal((await f.design.readDesignJournal(f.agent('new-conversation'))).revision, 0)
  assert.equal(await f.git.head(), f.commit)
  assert.equal((await readdir(f.project.stateRoot)).includes('clarity.json'), true)
}))

test('concurrent identical reports serialize to one fact and preserve unrelated user work', async () => fixture(async f => {
  await writeFile(join(f.project.root, 'user-wip.txt'), 'Do not include or discard')
  const value = report(f.kit), agent = f.agent('concurrent')
  const results = await Promise.all(Array.from({ length: 4 }, () => f.design.reportClarity(agent, value, f.options)))
  assert.equal(results.filter(value => !value.replayed).length, 1)
  assert.equal((await f.journal()).revision, 1)
  assert.equal(await f.git.readTextAt(await f.git.head(), 'user-wip.txt'), undefined)
  assert.equal(await readFile(join(f.project.root, 'user-wip.txt'), 'utf8'), 'Do not include or discard')
}))

test('schema, exact Kit, selected project and cancellation reject without publishing a score', async () => fixture(async f => {
  const agent = f.agent('negative'), value = report(f.kit)
  const invalid = { ...value, u: { score: 101, evidence: 'Invalid' } }
  await assert.rejects(f.design.reportClarity(agent, invalid, f.options), /0.*100/)
  await assert.rejects(f.design.reportClarity(agent, { ...value, kitContentHash: 'f'.repeat(64) }, f.options), /Kit content changed/)
  const { kitContentHash, ...unknown } = value
  await assert.rejects(f.design.reportClarity(agent, unknown, f.options), /Kit content changed/)
  await assert.rejects(f.design.reportClarity(agent, value, { ...f.options,
    expectedProjectId: '22222222-2222-4222-8222-222222222222' }), /selected Design Project changed/)
  const signal = AbortSignal.abort()
  await assert.rejects(f.design.reportClarity(agent, value, { ...f.options, signal }), { name: 'AbortError' })
  assert.equal(await f.authority(), undefined)
  assert.equal((await f.journal()).revision, 0)
  assert.equal(await f.git.head(), f.commit)
}))

test('real Design changes reject the old assessment while record-only commits remain equivalent', async () => fixture(async f => {
  const agent = f.agent('design-change')
  await f.design.reportClarity(agent, report(f.kit), f.options)
  const files = await f.design.designFilesForProject(agent, f.project.projectId, nodeFs)
  await files.write('sample', { title: 'A newer Design fact' }, { origin: 'agent',
    validate: () => ({ ok: true }), settleEvent: async () => {}, expectedHead: f.commit })
  await assert.rejects(f.design.reportClarity(agent, report(f.kit, 80), f.options), /Design evidence changed/)
  assert.equal((await f.authority()).report.u.score, 60)
  assert.equal((await f.journal()).revision, 1)
}))

test('Kit changes while queued cannot append or replace an assessment', async () => fixture(async f => {
  const value = report(f.kit), mutate = f.journals.atomicMutate.bind(f.journals)
  f.journals.atomicMutate = async (...args) => {
    f.kit.mindset = 'A changed authored Kit closure'
    return mutate(...args)
  }
  await assert.rejects(f.design.reportClarity(f.agent('kit-change'), value, f.options), /Kit changed while awaiting persistence/)
  assert.equal(await f.authority(), undefined)
  assert.equal((await f.journal()).revision, 0)
}))

test('an active Producer may publish across record-only commits, but true Design changes still conflict', async () => fixture(async f => {
  const agent = f.agent('producer-records')
  const skill = { name: 'sample', version: '1.0', content: 'Save the bounded title.',
    execution: { mode: 'subagent', handoff: 'none' }, metadata: {
      schemaYaml: 'type: object\nrequired: [title]\nproperties:\n  title:\n    type: string\n' } }
  f.kit.skills[0] = skill
  const store = await f.design.designFilesForProject(agent, f.project.projectId, nodeFs)
  await store.write('sample', { title: 'First' }, { origin: 'agent', validate: () => ({ ok: true }), settleEvent: async () => {} })
  const open = () => createProducerProjectWorkspace({ store, signal: new AbortController().signal,
    invocationSkill: skill, resolveSkill: name => name === skill.name ? skill : undefined,
    ownsPath: path => path.startsWith('sample/'), settleEvent: async () => {},
    withMutation: operation => f.design.withProjectMutation(agent, operation) })
  const workspace = await open(), candidate = await workspace.openWorkingCopy()
  await candidate.writeText('sample/sample.json', JSON.stringify({ title: 'Second' }))
  const base = workspace.revision
  await f.design.reportClarity(agent, report(f.kit), { expectedProjectId: f.project.projectId, assessedCheckpoint: base })
  assert.notEqual(await store.head(), base)
  assert.equal(await store.sameDesignEvidenceAt(base, await store.head()), true)
  const saved = await candidate.publish('complete', 'complete')
  assert.equal(saved.state.title, 'Second')
  assert.equal((await store.readPublished('sample')).title, 'Second')
  const staleWorkspace = await open(), stale = await staleWorkspace.openWorkingCopy()
  await stale.writeText('sample/sample.json', JSON.stringify({ title: 'Unpublished candidate' }))
  await store.write('other', { title: 'Actual new Design evidence' }, { origin: 'agent',
    validate: () => ({ ok: true }), settleEvent: async () => {} })
  await assert.rejects(stale.publish('complete', 'complete'), /revision is stale/)
  assert.equal((await store.readPublished('sample')).title, 'Second')
  assert.equal((await store.readPublished('other')).title, 'Actual new Design evidence')
}))

test('structured main-Agent tool accepts ordinary calls, reuses only real call IDs, and never inspects native logs', async () => fixture(async f => {
  let tool
  registerDesignClarityTool({ tools: { register(value) { tool = value } } }, f.design)
  assert.ok(tool)
  const args = { input: { projectId: f.project.projectId, assessedCheckpoint: f.commit,
    kitContentHash: projectKitContentHash(f.kit) }, summary: 'A regular report.',
    u: { score: 60, evidence: 'Intent' }, s: { score: 50, evidence: 'Structure' }, t: { score: 40, evidence: 'Checks' } }
  const exec = { agent: f.agent('tool'), signal: new AbortController().signal }
  const first = await tool.execute(args, exec)
  assert.equal(first.turn, undefined); assert.equal(first.callId, undefined)
  const correction = await tool.execute({ ...args, u: { score: 65, evidence: 'Corrected intent' } }, { ...exec, callId: 'real-call' })
  assert.equal(correction.callId, 'real-call'); assert.equal(correction.turn, undefined)
  assert.equal((await f.authority()).report.u.score, 65)
  assert.equal((await f.journal()).revision, 2)
  await assert.rejects(tool.execute({ ...args, input: { ...args.input, kitContentHash: 'e'.repeat(64) } }, exec), /no longer current/)
  await assert.rejects(tool.execute(args, { ...exec, agent: { session: { header: { origin: 'subagent' } } } }), /unavailable to subagents/)
}))

test('pre-write symlink confinement protects project journal, clarity and review policy', async () => fixture(async f => {
  const external = join(f.root, 'outside')
  await mkdir(external)
  await writeFile(join(external, 'clarity.json'), 'External user file')
  await symlink(external, designProjectRecordsRoot(f.project.root))
  await assert.rejects(f.authority(), /symbolic link/)
  await assert.rejects(f.design.reportClarity(f.agent('symlink'), report(f.kit), f.options), /symbolic link/)
  await assert.rejects(f.journals.append(f.project.root, String(f.project.projectId),
    { type: 'design/clarity-reported', data: { assessedCheckpoint: f.commit, report: report(f.kit) } }), /symbolic link/)
  await assert.rejects(readDesignReviewPolicy(join(designProjectRecordsRoot(f.project.root), 'reviews'), f.project.root), /symbolic link/)
  await assert.rejects(writeDesignReviewPolicy(join(designProjectRecordsRoot(f.project.root), 'reviews'),
    { mode: 'off', autoMergeWindowMs: 30000 }, f.project.root), /symbolic link/)
  assert.equal(await readFile(join(external, 'clarity.json'), 'utf8'), 'External user file')
  assert.deepEqual(await readdir(external), ['clarity.json'])
  assert.equal(await f.git.head(), f.commit)
}))

test('failed Git publication is reported; pure reads do not settle it, explicit retry does not duplicate the fact', async () => fixture(async f => {
  let fail = true, notified = 0
  const root = join(designProjectRecordsRoot(f.project.root), 'journal')
  const storage = new DesignJournalStorage(root, {}, { projectRoot: f.project.root, afterAppend: async file => {
    if (fail) throw Error('Injected commit failure')
    await commitDesignProjectRecords({ projectRoot: f.project.root, paths: [relative(f.project.root, file).split(sep).join('/')], message: 'Retry records' })
  } })
  const key = String(f.project.projectId), fact = { type: 'design/clarity-reported', data: { assessedCheckpoint: f.commit, report: report(f.kit) } }
  storage.subscribe(key, () => { notified++ })
  await assert.rejects(storage.append(key, fact), /Injected commit failure/)
  assert.equal(notified, 0)
  assert.equal((await storage.read(key)).revision, 1)
  assert.equal(await f.git.head(), f.commit)
  fail = false
  assert.equal((await storage.atomicMutate(key, () => undefined)).changed, false)
  assert.equal((await storage.read(key)).revision, 1)
  assert.notEqual(await f.git.head(), f.commit)
}))

test('cancellation after authority temp preparation preserves the prior score and removes the temporary file', async () => fixture(async f => {
  const agent = f.agent('cancel-before-replace')
  await f.design.reportClarity(agent, report(f.kit), f.options)
  const before = await f.authority(), nativeWrite = fsPromises.writeFile
  const controller = new AbortController()
  let intercepted = false
  fsPromises.writeFile = async (file, ...args) => {
    const result = await nativeWrite(file, ...args)
    if (String(file).startsWith(join(designProjectRecordsRoot(f.project.root), '.clarity-'))) {
      intercepted = true
      controller.abort()
    }
    return result
  }
  syncBuiltinESMExports()
  try {
    await assert.rejects(f.design.reportClarity(agent, report(f.kit, 85), { ...f.options, signal: controller.signal }), { name: 'AbortError' })
    assert.equal(intercepted, true)
    assert.deepEqual(await f.authority(), before)
    assert.equal((await f.journal()).revision, 2, 'settled audit survives as history, not current authority')
    assert.deepEqual((await readdir(designProjectRecordsRoot(f.project.root))).filter(name => name.endsWith('.tmp')), [])
  } finally { fsPromises.writeFile = nativeWrite; syncBuiltinESMExports() }
}))
