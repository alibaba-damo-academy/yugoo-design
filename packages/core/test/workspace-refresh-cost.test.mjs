import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AsyncLocalStorage } from 'node:async_hooks'
import { mkdtemp, mkdir, readFile, writeFile, rename, rm, cp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const { register } = await import('tsx/esm/api'); register()
const { DesignProjectManager, nodeDesignProjectSpawn } = await import('../src/design-project.ts')
const { DesignProjectRegistry } = await import('../src/design-project-registry.ts')
const { GitVersioning } = await import('../src/git.ts')
const { default: DesignService } = await import('../src/design-service.ts')
const { DesignPanelRemote } = await import('../src/panel-remote.ts')
const { TYPERT_REMOTE } = await import('../src/typert.remote-client.ts')
const { DesignJournalRegistry } = await import('../src/design-journal-registry.ts')
const { DesignBundleContributionRegistry } = await import('../src/runtime-drivers.ts')

async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'workspace-refresh-cost-'))
  const previousBackend = process.env.YUGOO_GIT_BACKEND
  // Registry and service facades also construct Git readers within this fixture process.
  process.env.YUGOO_GIT_BACKEND = 'cli'
  const calls = []
  const spawn = request => { calls.push([...request.argv]); return nodeDesignProjectSpawn(request) }
  // These source fixtures count/inject CLI probes. Native defaults are checked by the built-worker regressions.
  const registry = new DesignProjectRegistry({ projectsRoot: join(root, 'projects'), stateRoot: join(root, 'state'), manager: new DesignProjectManager({ spawn, gitBackend: 'cli' }) })
  try {
    const project = await registry.create('fixture', { provider: 'ladybug-wasm' })
    await registry.setKitPin(project.projectId, { name: 'fixture', version: '1.0' })
    await run({ root, registry, project: await registry.require(project.projectId), spawn, calls })
  } finally {
    if (previousBackend === undefined) delete process.env.YUGOO_GIT_BACKEND
    else process.env.YUGOO_GIT_BACKEND = previousBackend
    await rm(root, { recursive: true, force: true })
  }
}

test('unchanged panel reads share one bounded HEAD probe; edits and external commits stay visible', async () => fixture(async ({ registry, project, spawn, calls }) => {
  const exec = async argv => { const result = await spawn({ argv: ['git', ...argv], cwd: project.root }); assert.equal(result.exitCode, 0, result.stderr); return result.stdout.trim() }
  await mkdir(join(project.designFilesRoot, 'research'))
  await writeFile(join(project.designFilesRoot, 'research/research.json'), '{"title":"original"}')
  await exec(['add', 'design_files'])
  const publication = { skill: 'research', bundleVersion: '1.0', invocationId: 'run-1', stateStatus: 'complete', handoff: 'user_continue' }
  await exec(['-c', 'user.name=Test', '-c', 'user.email=test@local', 'commit', '-qm', `Published\n\nDSH-Design-Skill: "research"\nDSH-Design-Execution: ${Buffer.from(JSON.stringify(publication)).toString('base64url')}`])
  const baseline = await exec(['rev-parse', 'HEAD'])
  const agent = { id: 'fixture-conversation' }
  const kit = { name: 'fixture', version: '1.0', skills: [{ name: 'research', title: 'Research', version: '1.0', execution: { handoff: 'user_continue' } }] }
  const design = Object.create(DesignService.prototype)
  Object.assign(design, {
    projects: registry, workspaceReadScope: new AsyncLocalStorage(), workspaceGitReaders: new Map(),
    projectKits: new Map(), contributions: new DesignBundleContributionRegistry(),
    activeWorkspaces: new WeakMap([[agent, { project, binding: { revision: 1 }, values: {} }]]),
    workspaceContentEpochs: new WeakMap([[agent, 0]]), projectContentEpochs: new Map(), contentPanelGuards: new Map(),
    selectedAgents: new Set(), selectedAgentRefs: new WeakMap(),
    journalMutations: new Map(), journals: new DesignJournalRegistry(state => join(state, 'journal')),
    resolveKit: () => kit, resolveProjectKit: () => kit, latestKit: () => kit, spawnAdapter: () => spawn, executionAttemptsFor: () => [],
  })
  design.readClarityAuthority = async id => {
    await registry.require(id)
    return { assessedCheckpoint: baseline, report: { kit: kit.name, version: kit.version, summary: 'Fixture assessment',
      u: { score: 60, evidence: 'Fixture intent' }, s: { score: 40, evidence: 'Fixture structure' }, t: { score: 20, evidence: 'Fixture checks' } } }
  }
  const remote = Object.create(DesignPanelRemote.prototype)
  Object.assign(remote, { design, worktreeProjections: new Map() })
  const read = () => remote.readWorkspace(agent, new AbortController().signal)
  const first = await read()
  assert.equal(first.publicationError, undefined)
  const initialPoll = await remote.pollWorkspace(agent, null, new AbortController().signal)
  assert.equal(initialPoll.unchanged, false)
  assert.equal((await remote.pollWorkspace(agent, initialPoll.revision, new AbortController().signal)).unchanged, true)
  calls.length = 0
  assert.deepEqual(await read(), first)
  assert.ok(calls.length <= 1, JSON.stringify(calls))
  assert.ok(calls.every(argv => argv[1] === 'rev-parse'), JSON.stringify(calls))
  assert.equal(calls.filter(argv => ['log', 'show', 'ls-tree', 'cat-file'].includes(argv[1])).length, 0)
  calls.length = 0
  await Promise.all(Array.from({ length: 12 }, read))
  assert.ok(calls.length <= 1, `multiple readers multiplied Git probes: ${JSON.stringify(calls)}`)
  assert.equal(first.advisoryRuntime.available, false, 'an omitted scheduler is not idle and healthy')
  let runtimeStatus = { available: true, profiles: ['grounding', 'reflection', 'alignment'], phase: 'idle' }
  const releaseRuntime = design.registerAdvisoryRuntime({ status: () => runtimeStatus })
  let priorPoll = initialPoll
  const codec = TYPERT_REMOTE.descriptors.find(d => d.method === 'readWorkspace').result.create()
  for (const phases of [['scheduled', 'scheduled', 'scheduled'], ['running', 'running', 'running'],
    ['running', 'idle', 'failed'], ['idle', 'idle', 'failed'], []]) {
    runtimeStatus = { ...runtimeStatus,
      phase: phases.includes('running') ? 'running' : phases.includes('scheduled') ? 'scheduled' : phases.includes('failed') ? 'failed' : 'idle',
      profileStatus: phases.map((phase, index) => ({ profile: runtimeStatus.profiles[index], phase, latestRevision: 1 })),
    }
    const observed = await remote.pollWorkspace(agent, priorPoll.revision, new AbortController().signal)
    assert.equal(observed.unchanged, false, 'runtime-only transitions survive conditional workspace transport')
    assert.deepEqual(observed.workspace.advisoryRuntime, runtimeStatus)
    assert.deepEqual(codec.parse(observed.workspace).advisoryRuntime, runtimeStatus, 'the actual shared Remote codec preserves status')
    assert.equal(observed.workspace.checkpoint, first.checkpoint)
    assert.equal(observed.workspace.journalRevision, first.journalRevision)
    assert.equal((await remote.pollWorkspace(agent, observed.revision, new AbortController().signal)).unchanged, true)
    priorPoll = observed
  }
  releaseRuntime()
  assert.equal((await read()).advisoryRuntime.available, false, 'runtime disposal clears a retained running projection')
  const oldAuthority = design.readClarityAuthority
  design.readClarityAuthority = async id => {
    const authority = await oldAuthority(id)
    return { ...authority, report: { ...authority.report, u: { score: 75 } } }
  }
  design.executionAttemptsFor = () => [{ sequence: 1, projectId: project.projectId, phase: 'working' }]
  const liveState = await read()
  assert.equal(liveState.checkpoint, first.checkpoint)
  assert.equal(liveState.clarity.assessment.u, 75, 'score changes do not depend on Git HEAD')
  assert.equal(liveState.executionRevision, 1, 'progress changes do not depend on file changes')
  assert.equal((await remote.pollWorkspace(agent, initialPoll.revision, new AbortController().signal)).unchanged, false)
  await design.withWorkspaceRead(agent, new AbortController().signal, async () => {
    const active = design.activeWorkspaces.get(agent)
    design.activeWorkspaces.set(agent, { ...active, binding: { revision: 2 } })
    return registry.require(project.projectId)
  })
  await assert.rejects(design.withWorkspaceRead(agent, new AbortController().signal, async () => {
    const active = design.activeWorkspaces.get(agent)
    design.activeWorkspaces.set(agent, { ...active, project: { ...project, projectId: 'different-project' } })
  }), /selection changed/)
  design.activeWorkspaces.set(agent, { project, binding: { revision: 3 }, values: {} })
  const beforeConfig = [...design.workspaceGitReaders.values()][0].git
  await exec(['config', 'test.cache-invalidation', 'updated'])
  await read()
  assert.notEqual([...design.workspaceGitReaders.values()][0].git, beforeConfig)
  await writeFile(join(project.designFilesRoot, 'research/research.json'), '{"title":"edited without commit"}')
  assert.equal((await read()).design.research.state.title, 'edited without commit')
  await exec(['add', 'design_files'])
  await exec(['-c', 'user.name=Test', '-c', 'user.email=test@local', 'commit', '-qm', 'External edit'])
  await new Promise(resolve => setTimeout(resolve, 1050))
  const changed = await read()
  assert.notEqual(changed.checkpoint, first.checkpoint)
  assert.equal(changed.clarity.needsReassessment, true)
  // Replacing the repository invalidates the retained reader, even at the same path.
  const previous = [...design.workspaceGitReaders.values()][0].git
  await rename(join(project.root, '.git'), join(project.root, '.git-original'))
  await mkdir(join(project.root, '.git'))
  await new Promise(resolve => setTimeout(resolve, 1050))
  const degraded = await read()
  assert.match(degraded.publicationError, /git|checkpoint/)
  assert.equal(degraded.access.writable, false)
  assert.equal(degraded.design.research.state.title, 'edited without commit')
  assert.deepEqual(degraded.continuations, [])
  assert.deepEqual(degraded.mustEditHandoffs, [])
  await rm(join(project.root, '.git'), { recursive: true })
  await cp(join(project.root, '.git-original'), join(project.root, '.git'), { recursive: true })
  assert.equal((await read()).checkpoint, changed.checkpoint)
  assert.notEqual([...design.workspaceGitReaders.values()][0].git, previous)
  design.journals.dispose()
}))

test('unbound workspace omits the prior conversation scheduler observation', async () => {
  const remote = Object.create(DesignPanelRemote.prototype)
  remote.design = { refreshProjectKit: async () => undefined, selectedProjectForAgent: async () => undefined, withWorkspaceRead: (_agent, _signal, read) => read(),
    advisoryRuntimeStatus: () => { throw new Error('unbound reads must not reuse a scheduler snapshot') } }
  const workspace = await remote.readWorkspace({ id: 'unbound' }, new AbortController().signal)
  assert.equal(workspace.projectId, null)
  assert.equal(workspace.advisoryRuntime, undefined)
})

test('strict workspace codecs reject invented review phases and authority fields', () => {
  const schema = TYPERT_REMOTE.descriptors.find(d => d.method === 'readWorkspace').result.create()
  const workspace = { projectId: 'fixture', projectName: 'Fixture', projectPath: '/fixture', checkpoint: 'commit',
    worktreeRevision: 'tree', executionRevision: 0, executionAttempts: [], access: { mode: 'unconfigured', writable: false },
    journalRevision: 1, design: {}, continuations: [], mustEditHandoffs: [], clarity: { assessment: null, needsReassessment: false } }
  assert.equal(schema.safeParse(workspace).success, true, 'older workspace senders remain compatible')
  const runtime = { available: true, profiles: ['grounding'], phase: 'running',
    profileStatus: [{ profile: 'grounding', phase: 'running', latestRevision: 1 }] }
  assert.deepEqual(schema.parse({ ...workspace, advisoryRuntime: runtime }).advisoryRuntime, runtime)
  for (const invalid of [{ ...runtime, phase: 'completed' }, { ...runtime, launch: true },
    { ...runtime, profileStatus: [{ profile: 'grounding', phase: 'cancelled' }] },
    { ...runtime, profileStatus: [{ profile: 'grounding', phase: 'running', percent: 60 }] }]) {
    assert.equal(schema.safeParse({ ...workspace, advisoryRuntime: invalid }).success, false)
  }
})

test('workspace projects only real edit gates with the exact owner and invalidates them with publication and selection', async () => fixture(async ({ registry, project, spawn, calls }) => {
  const exec = async argv => {
    const result = await spawn({ argv: ['git', ...argv], cwd: project.root })
    assert.equal(result.exitCode, 0, result.stderr); return result.stdout.trim()
  }
  const skills = [
    { name: 'review', handoff: 'must_edit', stateStatus: 'pending' },
    { name: 'continue', handoff: 'user_continue', stateStatus: 'pending' },
    { name: 'finished', handoff: 'must_edit', stateStatus: 'complete' },
    { name: 'ordinary', handoff: 'none', stateStatus: 'pending' },
  ]
  for (const skill of skills) {
    await mkdir(join(project.designFilesRoot, skill.name))
    await writeFile(join(project.designFilesRoot, `${skill.name}/${skill.name}.json`), JSON.stringify({ title: skill.name, stage: 'pending', answers: [] }))
    await exec(['add', 'design_files'])
    const execution = { skill: skill.name, bundleVersion: '1.0', invocationId: `run-${skill.name}`, stateStatus: skill.stateStatus, handoff: skill.handoff }
    await exec(['-c', 'user.name=Test', '-c', 'user.email=test@local', 'commit', '-qm',
      `Published\n\nDSH-Design-Skill: ${JSON.stringify(skill.name)}\nDSH-Design-Execution: ${Buffer.from(JSON.stringify(execution)).toString('base64url')}`])
  }
  const head = await exec(['rev-parse', 'HEAD'])
  const kit = { name: 'fixture', version: '1.0', skills: skills.map(skill => ({ name: skill.name, version: '1.0',
    title: { zh: '示例', en: 'Example' }, execution: { handoff: skill.handoff,
      ...(skill.handoff === 'user_continue' ? { resumeAction: { routeId: 'continue_review', label: { zh: '继续', en: 'Continue' } } } : {}) } })) }
  const agent = { id: 'edit-gate-conversation' }
  const design = Object.create(DesignService.prototype)
  Object.assign(design, {
    projects: registry, workspaceReadScope: new AsyncLocalStorage(), workspaceGitReaders: new Map(),
    projectKits: new Map(), contributions: new DesignBundleContributionRegistry(),
    activeWorkspaces: new WeakMap([[agent, { project, binding: { revision: 1 }, values: {} }]]),
    workspaceContentEpochs: new WeakMap([[agent, 0]]), projectContentEpochs: new Map(), contentPanelGuards: new Map(),
    selectedAgents: new Set(), selectedAgentRefs: new WeakMap(),
    journalMutations: new Map(), journals: new DesignJournalRegistry(state => join(state, 'journal')),
    resolveKit: () => kit, resolveProjectKit: () => kit, latestKit: () => kit, spawnAdapter: () => spawn,
    executionAttemptsFor: () => [], readClarityAuthority: async () => undefined,
  })
  const remote = Object.create(DesignPanelRemote.prototype)
  Object.assign(remote, { design, worktreeProjections: new Map() })
  const read = () => remote.readWorkspace(agent, new AbortController().signal)
  try {
    const first = await read()
    assert.equal(first.publicationError, undefined)
    assert.deepEqual(first.mustEditHandoffs, [{ skill: 'review', pin: { projectId: project.projectId,
      kitName: 'fixture', kitVersion: '1.0', skillName: 'review', bundleVersion: '1.0', stateRevision: head, invocationId: 'run-review' } }])
    assert.ok(Object.isFrozen(first.mustEditHandoffs)); assert.ok(Object.isFrozen(first.mustEditHandoffs[0].pin))
    assert.deepEqual(first.continuations.map(entry => entry.skill), ['continue'], 'continue and edit gates are not interchangeable')
    calls.length = 0
    const unchanged = await read()
    assert.strictEqual(unchanged.mustEditHandoffs, first.mustEditHandoffs, 'reuse the existing continuation read cache')
    assert.ok(calls.length <= 1, JSON.stringify(calls))
    assert.ok(calls.every(argv => argv[1] === 'rev-parse'), JSON.stringify(calls))
    // A no-op observation is not a save or a new publication.
    assert.equal((await read()).mustEditHandoffs.length, 1)
    await writeFile(join(project.designFilesRoot, 'review/review.json'), '{"title":"Edited by user"}')
    await exec(['add', 'design_files'])
    await exec(['-c', 'user.name=Test', '-c', 'user.email=test@local', 'commit', '-qm', 'Panel edit\n\nDSH-Design-Skill: "review"'])
    await new Promise(resolve => setTimeout(resolve, 1050))
    const edited = await read()
    assert.notEqual(edited.checkpoint, head)
    assert.deepEqual(edited.mustEditHandoffs, [], 'an edited publication cannot retain the old edit instruction')
    assert.deepEqual(edited.continuations.map(entry => entry.skill), ['continue'], 'sibling continuation stays authoritative')
    const other = await registry.create('Other isolated project', { provider: 'ladybug-wasm' })
    await registry.setKitPin(other.projectId, { name: kit.name, version: kit.version })
    design.activeWorkspaces.set(agent, { project: await registry.require(other.projectId), binding: { revision: 2 }, values: {} })
    const switched = await read()
    assert.equal(switched.projectId, other.projectId)
    assert.deepEqual(switched.mustEditHandoffs, []); assert.deepEqual(switched.continuations, [])
  } finally { design.journals.dispose() }
}))

test('read scope deduplicates concurrently, detects identity changes and never escapes its lifetime', async () => fixture(async ({ registry, project, calls }) => {
  calls.length = 0
  let detached
  let release
  const gate = new Promise(resolve => { release = resolve })
  await registry.withReadSnapshot(async () => {
    await Promise.all(Array.from({ length: 8 }, () => registry.require(project.projectId)))
    detached = gate.then(() => registry.require(project.projectId))
  })
  assert.equal(calls.length, 4)
  release(); await detached
  assert.equal(calls.length, 6)
  const metadataPath = join(project.root, 'project.json')
  const metadata = JSON.parse(await readFile(metadataPath, 'utf8'))
  await assert.rejects(registry.withReadSnapshot(async () => {
    await registry.require(project.projectId)
    await writeFile(metadataPath, JSON.stringify({ ...metadata, kit: { name: 'changed', version: '1.0' } }))
  }), /identity or Kit changed/)
  const controller = new AbortController()
  await assert.rejects(registry.withReadSnapshot(async () => {
    await registry.require(project.projectId)
    controller.abort()
    await registry.require(project.projectId, controller.signal)
  }, controller.signal), { name: 'AbortError' })
}))

test('pinned cache is bounded, isolated and does not retain errors or mutable HEAD', async () => {
  let calls = 0, failed = false
  const spawn = async ({ argv }) => {
    calls++
    if (failed) return { exitCode: 1, stdout: '', stderr: 'transient failure' }
    if (argv[1] === 'log') return { exitCode: 0, stdout: '', stderr: '' }
    return { exitCode: 0, stdout: argv[1] === 'show' ? `message:${argv.at(-1)}` : 'a'.repeat(40), stderr: '' }
  }
  const git = new GitVersioning(spawn, '/fixture', undefined, true, 'cli')
  const oid = 'a'.repeat(40)
  await git.commitMessageAt(oid); await git.commitMessageAt(oid)
  assert.equal(calls, 1)
  await git.head(); await git.head()
  assert.equal(calls, 3)
  assert.equal(await git.latestCommitWithMessage(oid, 'not-published'), undefined)
  assert.equal(await git.latestCommitWithMessage(oid, 'not-published'), undefined)
  assert.equal(calls, 4, 'successful missing publication is immutable at this OID')
  const cancelled = AbortSignal.abort()
  await assert.rejects(git.commitMessageAt(oid, cancelled), { name: 'AbortError' })
  failed = true
  await assert.rejects(git.commitMessageAt('b'.repeat(40)), /transient/)
  failed = false
  assert.match(await git.commitMessageAt('b'.repeat(40)), /message/)
  for (let i = 1; i <= 257; i++) await git.commitMessageAt(i.toString(16).padStart(40, '0'))
  const before = calls
  await git.commitMessageAt(oid)
  assert.equal(calls, before + 1)
  await new GitVersioning(spawn, '/other', undefined, true, 'cli').commitMessageAt(oid)
  assert.equal(calls, before + 2)
})

test('shared HEAD polling coalesces in-flight probes, isolates cancellation and never caches failures', async () => {
  const root = await mkdtemp(join(tmpdir(), 'head-poll-'))
  try {
    let calls = 0, complete
    const pending = new Promise(resolve => { complete = resolve })
    const spawn = async () => { calls++; return pending }
    const first = new GitVersioning(spawn, root, undefined, false, 'cli'), second = new GitVersioning(spawn, root, undefined, false, 'cli')
    const cancelled = new AbortController()
    const a = first.pollHead(cancelled.signal).catch(error => error)
    const b = second.pollHead()
    await new Promise(resolve => setTimeout(resolve, 1100))
    const c = second.pollHead()
    await new Promise(resolve => setTimeout(resolve, 10))
    assert.equal(calls, 1, 'slow in-flight probe remains single-flight beyond TTL')
    cancelled.abort()
    complete({ exitCode: 0, stdout: 'a'.repeat(40), stderr: '' })
    assert.equal((await a).name, 'AbortError')
    assert.equal(await b, 'a'.repeat(40)); assert.equal(await c, 'a'.repeat(40))
    await second.head()
    assert.equal(calls, 2, 'action head() must not use polling cache')
    first.invalidatePolledHead()
    let failCalls = 0
    const failing = new GitVersioning(async () => { failCalls++; return { exitCode: 128, stdout: '', stderr: 'broken' } }, root, undefined, false, 'cli')
    await assert.rejects(failing.pollHead(), /broken/)
    await assert.rejects(failing.pollHead(), /broken/)
    assert.equal(failCalls, 2)
  } finally { await rm(root, { recursive: true, force: true }) }
})
