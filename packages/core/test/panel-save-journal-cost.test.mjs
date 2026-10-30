/** Built DesignService/worker and real Journal files; no installed Host or model. */
import assert from 'node:assert/strict'
import test from 'node:test'
import { AsyncLocalStorage } from 'node:async_hooks'
import { mkdtemp, readFile, writeFile, rename, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import DesignService, { DesignJournalRegistry, DesignProjectRegistry, DesignProjectManager,
  nodeDesignProjectSpawn, DesignFilesStore, DesignWriteSettlementError, GitVersioning,
  DESIGN_PANEL_SAVE_ASSESSMENT_GUIDANCE, DESIGN_CORE_PROGRESSION_PROMPT,
  renderDesignClarityUserContext } from '../lib/index.js'
import { nodeFs } from '../src/service-tools.ts'
import { DesignPanelRemote } from '../lib/panel-remote.js'
import { LocalSubprocessRuntime } from '@deepseek-ai/dsh-subprocess-local'
import { Duplex, PassThrough } from 'node:stream'
import { readGitFrames, writeGitFrame } from '../src/dsh-git-protocol.ts'
import { registerDesignClarityTool } from '../src/dsh-design-clarity-tool.ts'

async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'save-journal-cost-'))
  const agent = { id: 'one-session' }
  const project = { projectId: '11111111-1111-4111-8111-111111111111', root, stateRoot: join(root, 'state'), kit: { name: 'fixture', version: '1.0' } }
  const design = Object.create(DesignService.prototype)
  let resolutions = 0
  Object.assign(design, { projectMutationScope: new AsyncLocalStorage(),
    activeWorkspaces: new WeakMap([[agent, { project, binding: { revision: 1 } }]]),
    projectContentEpochs: new Map(), workspaceContentEpochs: new WeakMap([[agent, 0]]),
    journalMutations: new Map(), journals: new DesignJournalRegistry(state => join(state, 'journal')),
    async projectForAgent() { resolutions++; return project },
  })
  try { await run({ design, agent, project, resolutions: () => resolutions }) }
  finally { design.journals.dispose(); await rm(root, { recursive: true, force: true }) }
}

test('the held project mutation reuses its authorized Journal identity without registry/Git reopen', async () => fixture(async ({ design, agent, project, resolutions }) => {
  await design.projectMutationScope.run(project.projectId, async () => {
    const read = await design.readDesignJournal(agent)
    assert.equal(read.revision, 0)
    await design.withJournal(agent, (state, conversation) => design.journals.append(state, conversation,
      { type: 'design/kit-selected', data: { kit: 'fixture', version: '1.0', operation: 'activate' } }))
    assert.equal((await design.readDesignJournal(agent)).revision, 1)
  })
  assert.equal(resolutions(), 0)
  assert.equal((await design.readDesignJournal(agent)).revision, 1)
  assert.equal(resolutions(), 1, 'ordinary reads still resolve the registered project')
}))

test('a different mutation owner cannot use the fast path', async () => fixture(async ({ design, agent, resolutions }) => {
  await design.projectMutationScope.run('another-project', () => design.readDesignJournal(agent))
  assert.equal(resolutions(), 1)
}))

test('selection and content changes during the Journal operation are still rejected', async () => fixture(async ({ design, agent, project }) => {
  await design.projectMutationScope.run(project.projectId, async () => {
    await assert.rejects(design.withJournal(agent, async () => {
      design.projectContentEpochs.set(project.projectId, 1)
    }), /content changed/)
    design.projectContentEpochs.set(project.projectId, 0)
    await assert.rejects(design.withJournal(agent, async () => {
      design.activeWorkspaces.delete(agent)
    }), /selected Design Project|selection changed/)
  })
}))

test('native Git diagnostics preserve adapter behavior and contain no arguments, output or credentials', async () => {
  const messages = [], requests = []
  const design = Object.create(DesignService.prototype)
  const bytes = Uint8Array.from([0, 255, 13, 10])
  Object.assign(design, { context: { logger: { info: text => messages.push(JSON.parse(text)) },
    subprocess: { spawn: request => {
      requests.push(request)
      return { done: Promise.resolve({ exitCode: 0 }),
        stdout: (async function* () { yield bytes })(),
        collected: { stdout: { readFrom: () => ({ text: 'private output' }) },
          stderr: { readFrom: () => ({ text: 'private stderr' }) } } }
    } } } })
  const controller = new AbortController(), adapter = design.spawnAdapter()
  const argv = ['git', 'cat-file', 'blob', 'private-object-argument']
  const result = await adapter({ argv, cwd: '/private/project', env: { PRIVATE_KEY: 'private-key' },
    signal: controller.signal, binaryStdout: { maxBytes: bytes.length } })
  assert.deepEqual(Buffer.from(result.stdoutBytes), Buffer.from(bytes))
  assert.equal(result.stdout, '', 'binary capture keeps bytes separate from decoded stdout')
  assert.equal(result.stderr, 'private stderr')
  assert.deepEqual(requests[0], { argv, cwd: '/private/project', env: { PRIVATE_KEY: 'private-key' },
    signal: controller.signal, graceMs: 5000,
    stdio: { stdin: 'ignore', stdout: 'pipe', stderr: { maxBytes: 1 << 18 } } })
  assert.equal(messages.length, 1)
  assert.deepEqual(Object.keys(messages[0]).sort(), ['at', 'cancelled', 'completed', 'elapsedMs', 'exitCode', 'operation', 'spawnMs', 'tag'])
  assert.equal(messages[0].operation, 'cat-file'); assert.equal(messages[0].completed, true)
  assert.ok(messages[0].elapsedMs >= messages[0].spawnMs)
  assert.doesNotMatch(JSON.stringify(messages), /private/i)
  // A failing logger is never allowed to turn a completed Git operation into a
  // rejected publication, and subprocess failure retains its original error.
  design.context.logger.info = () => { throw Error('logger unavailable') }
  const textResult = await adapter({ argv, cwd: '/private/project' })
  assert.equal(textResult.exitCode, 0); assert.equal(textResult.stdout, 'private output')
  const failure = new Error('original native spawn failure')
  design.context.subprocess.spawn = () => { throw failure }
  await assert.rejects(adapter({ argv, cwd: '/private/project' }), error => error === failure)
  design.context.logger.info = text => messages.push(JSON.parse(text))
  controller.abort(failure)
  await assert.rejects(adapter({ argv, cwd: '/private/project', signal: controller.signal }), error => error === failure)
  assert.equal(messages.at(-1).completed, false)
  assert.equal(messages.at(-1).cancelled, true)
  assert.equal(messages.at(-1).spawnMs, undefined)
  assert.doesNotMatch(JSON.stringify(messages), /private|original native spawn failure/i)
})
/** Actual shared Remote/Service/registry/store/Git/Journal, isolated from any Host. */
async function saveFixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'panel-save-transaction-'))
  const calls = [], hooks = {}
  const spawn = async request => {
    calls.push([...request.argv])
    await hooks.beforeGit?.(request)
    const result = await nodeDesignProjectSpawn(request)
    await hooks.afterGit?.(request, result)
    return result
  }
  const registry = new DesignProjectRegistry({ projectsRoot: join(root, 'projects'), stateRoot: join(root, 'state'), manager: new DesignProjectManager({ spawn }) })
  let design
  try {
    const created = await registry.create('Save cost fixture', { provider: 'ladybug-wasm' })
    await registry.setKitPin(created.projectId, { name: 'fixture', version: '1.0' })
    const project = await registry.require(created.projectId)
    const events = [{ type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'A bounded fixture.' }] } }]
    const agent = { id: 'save-cost-session', session: { header: { origin: 'user' }, snapshotEvents: () => events },
      notices: [], inject(notice) { this.notices.push(notice) } }
    const skill = { name: 'sample', version: '1.0', execution: { handoff: 'none' }, metadata: {
      schemaYaml: 'type: object\nrequired: [title]\nproperties:\n  title:\n    type: string\n',
    } }
    const kit = { name: 'fixture', version: '1.0', skills: [skill] }
    const store = new DesignFilesStore(nodeFs, new GitVersioning(spawn, project.root, 'design_files'), project.designFilesRoot)
    const initial = await store.write('sample', { title: 'Initial' }, { origin: 'agent', settleEvent: async () => {} })
    design = Object.create(DesignService.prototype)
    Object.assign(design, {
      context: { get: () => undefined },
      projects: registry, projectMutationScope: new AsyncLocalStorage(), projectMutations: new Map(),
      workspaceReadScope: new AsyncLocalStorage(), workspaceGitReaders: new Map(),
      activeWorkspaces: new WeakMap([[agent, { project, binding: { revision: 1 }, values: {} }]]),
      workspaceContentEpochs: new WeakMap([[agent, 0]]), projectContentEpochs: new Map(),
      selectedAgents: new Set(), selectedAgentRefs: new WeakMap(),
      journalMutations: new Map(), journals: new DesignJournalRegistry(state => join(state, 'journal')),
      resolveProjectKit: () => kit, spawnAdapter: () => spawn, notifyWorkspaceChange() {},
    })
    await design.journals.append(project.stateRoot, String(agent.id), {
      type: 'design/kit-selected', data: { kit: kit.name, version: kit.version, operation: 'activate' },
    })
    const remote = Object.create(DesignPanelRemote.prototype)
    remote.design = design
    const save = (title, eventId, signal = new AbortController().signal) => remote.savePanel(agent, skill.name, { title }, [], eventId, signal)
    const command = async (...args) => {
      const result = await nodeDesignProjectSpawn({ argv: ['git', ...args], cwd: project.root })
      assert.equal(result.exitCode, 0, result.stderr)
      return result.stdout.trim()
    }
    calls.length = 0
    await run({ root, project, agent, skill, kit, store, design, remote, save, command, calls, hooks, initial })
  } finally { design?.journals.dispose(); await rm(root, { recursive: true, force: true }) }
}

test('ordinary single-file save counts its complete Git path and starts fresh on the next request', async () => saveFixture(async ({ save, calls, command, project, design, agent }) => {
  const first = await save('First edit', 'cost-first')
  const firstCalls = calls.splice(0)
  // Entry deduplication removes three calls; transaction-local tree metadata
  // reuse removes two more, committed text metadata removes one more, and
  // the combined format/HEAD probe removes one more.
  // This integrated exact bound is not a latency claim.
  assert.equal(firstCalls.length, 23, JSON.stringify(firstCalls))
  assert.equal(firstCalls.filter(argv => argv.includes('--show-toplevel')).length, 1)
  assert.equal(firstCalls.filter(argv => argv[1] === 'rev-parse' && argv.at(-1) === 'HEAD').length, 6)
  assert.equal(firstCalls.filter(argv => argv.includes('commit-tree')).length, 1)
  assert.equal(firstCalls.filter(argv => argv[1] === 'update-ref').length, 1)
  assert.equal(await command('rev-parse', 'HEAD'), first.commit)
  assert.deepEqual(JSON.parse(await readFile(join(project.designFilesRoot, 'sample/sample.json'), 'utf8')), { title: 'First edit' })
  const second = await save('Second edit', 'cost-second')
  assert.equal(calls.length, 23, JSON.stringify(calls))
  assert.notEqual(second.commit, first.commit)
  const history = await design.readDesignJournal(agent)
  assert.equal(history.records.filter(row => row.type === 'design/changed').length, 2)
}))

test('meaningful save injects exact main-report input after settlement and before returning; replay/noop does not score again', async () => saveFixture(async ({ save, project, design, agent }) => {
  let returned = false
  const inject = agent.inject.bind(agent)
  agent.inject = notice => { assert.equal(returned, false); inject(notice) }
  const first = await save('A meaningful answer', 'main-turn-save')
  returned = true
  const note = agent.notices.at(-1).content[0].text
  assert.ok(note.includes(DESIGN_PANEL_SAVE_ASSESSMENT_GUIDANCE))
  assert.ok(DESIGN_CORE_PROGRESSION_PROMPT.includes(DESIGN_PANEL_SAVE_ASSESSMENT_GUIDANCE), 'the Core entry and the saved-event instruction share one assessment contract')
  assert.match(note, /must assess.*call report_design_clarity.*before asking the next question/s)
  assert.match(note, /later user stop, cancellation or instruction not to assess takes priority/)
  assert.match(note, /reporting capability is unavailable or reporting fails/)
  assert.doesNotMatch(note, /ordinary main conversation when useful/)
  assert.match(note, /No second evaluator is required/)
  const input = JSON.parse(note.match(/with input=(.*?) and evidence-based/)[1])
  assert.deepEqual(input, design.clarityInputForAgent(agent))
  assert.equal(input.projectId, project.projectId)
  assert.equal(input.assessedCheckpoint, first.commit)
  assert.equal(input.selectionRevision, 1)
  const journal = await design.readDesignJournal(agent)
  assert.ok(journal.records.some(row => row.type === 'design/changed' && row.data.commit === first.commit))
  const count = agent.notices.length
  await save('A meaningful answer', 'main-turn-save')
  assert.equal(agent.notices.length, count, 'an exact saved-event replay injects no duplicate instruction')
  returned = false
  await save('A meaningful answer', 'main-turn-noop')
  assert.equal(agent.notices.slice(count).some(notice => /call report_design_clarity/.test(notice.content[0].text)), false,
    'a newly audited no-op does not require another score')
}))

for (const control of ['保存并评估下一步', 'Save and assess next step', '保存并继续设计', 'Save and continue designing']) test(`real save to main report uses the logged native control: ${control}`, async () => saveFixture(async ({ save, design, agent, project }) => {
  const first = await save('A saved answer to assess', 'saved-main-report')
  const input = JSON.parse(agent.notices.at(-1).content[0].text.match(/with input=(.*?) and evidence-based/)[1])
  const events = agent.session.snapshotEvents()
  events.push({ type: 'user/message', data: { source: { kind: 'user', rpcId: 'native-control' }, content: [{ type: 'text', text: control }] } })
  let tool
  registerDesignClarityTool({ tools: { register(definition) { tool = definition } } }, design)
  const args = { summary: 'Saved evidence assessed in the main turn.', u: { score: 55, evidence: 'The saved answer clarifies intent.' },
    s: { score: 45, evidence: 'The saved structure is bounded.' }, t: { score: 35, evidence: 'Some outcomes remain unchecked.' } }
  let calls = 0, turn = 3
  const execute = input => {
    const callId = `saved-main-${++calls}`
    events.push({ type: 'tool/call', data: { turn, callId } })
    return tool.execute({ ...args, ...(input === undefined ? {} : { input }) }, { agent, callId, signal: new AbortController().signal })
  }
  await assert.rejects(execute(), /missing required property "input"/)
  const { selectionRevision, ...withoutSelection } = input
  await execute(withoutSelection)
  assert.deepEqual(design.clarityInputForAgent(agent), input, 'ordinary continuation preserves the saved project/Kit/commit input')
  assert.equal((await design.readClarityAuthority(project.projectId)).report.scopeDigest, undefined)
  turn = 4
  events.push({ type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'Use a materially different audience.' }] } })
  args.summary = 'Reassessed for the newly expressed audience.'
  const current = design.clarityInputForAgent(agent)
  assert.deepEqual(current, input, 'scope evidence guides reasoning, not native-log authentication')
  await execute(current)
  const authority = await design.readClarityAuthority(project.projectId)
  assert.equal(authority.assessedCheckpoint, first.commit)
  assert.equal(authority.report.origin, 'main-agent')
  assert.equal(authority.report.scopeDigest, current.scopeDigest)
  assert.equal((await design.readDesignJournal(agent)).records.filter(row => row.type === 'design/clarity-reported').length, 2)
}))

test('current and legacy save controls retain the agreed business scope rather than becoming new intent', () => {
  const human = text => ({ type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text }] } })
  const intent = human('Design a private notebook for my own notes.')
  const expected = renderDesignClarityUserContext([intent])
  for (const control of ['保存并评估下一步', 'Save and assess next step', '保存并继续设计', 'Save and continue designing']) {
    assert.equal(renderDesignClarityUserContext([intent, human(control)]), expected)
  }
  assert.notEqual(renderDesignClarityUserContext([intent, human('Stop now; do not assess this save.')]), expected,
    'a real later stop instruction remains visible; it is not filtered as a save control')
})

/** Wait on an actual occupied project lane, not a guessed timeout. */
async function rejectQueuedSave(context, change, expected, signal = new AbortController().signal) {
  const { design, agent, project, save, calls, command } = context
  let enter, release, queued
  const entered = new Promise(resolve => { enter = resolve })
  const gate = new Promise(resolve => { release = resolve })
  const enqueued = new Promise(resolve => { queued = resolve })
  const held = design.withProjectMutationFor(agent, project.projectId, async () => { enter(); await gate })
  await entered
  const serialize = design.serializeProjectMutation
  design.serializeProjectMutation = function (...args) { queued(); return serialize.apply(this, args) }
  const saving = save('Queued edit must not publish', 'queued-edit', signal)
  const rejected = assert.rejects(saving, expected)
  try {
    await enqueued
    assert.equal(calls.length, 0, 'no Git identity/HEAD read before the queued save acquires its lane')
    await change()
  } finally {
    design.serializeProjectMutation = serialize
    release()
    await held.catch(() => {})
  }
  await rejected
  assert.equal(calls.some(argv => argv.includes('commit-tree') || argv[1] === 'update-ref'), false)
  assert.deepEqual(JSON.parse(await readFile(join(project.designFilesRoot, 'sample/sample.json'), 'utf8')), { title: 'Initial' })
  assert.equal((await design.journals.read(project.stateRoot, String(agent.id))).records.some(row => row.type === 'design/changed'), false)
  return command('rev-parse', 'HEAD')
}

test('queued save validates actual on-disk project identity only after its lane opens', async () => saveFixture(async context => {
  const path = join(context.project.root, 'project.json')
  const metadata = JSON.parse(await readFile(path, 'utf8'))
  assert.equal(await rejectQueuedSave(context, () => writeFile(path, JSON.stringify({ ...metadata,
    id: '22222222-2222-4222-8222-222222222222' })), /does not match registered id/), context.initial.commit)
}))

test('queued A to B to A binding switch invalidates the original save even when the project id returns', async () => saveFixture(async context => {
  const { design, agent, project } = context
  await rejectQueuedSave(context, async () => {
    design.activeWorkspaces.set(agent, { project: { ...project, projectId: 'other-project' }, binding: { revision: 2 }, values: {} })
    design.activeWorkspaces.set(agent, { project, binding: { revision: 3 }, values: {} })
  }, /selection or content changed/)
}))

test('queued content invalidation cannot borrow a refreshed workspace epoch', async () => saveFixture(async context => {
  await rejectQueuedSave(context, async () => {
    context.design.projectContentEpochs.set(context.project.projectId, 1)
    context.design.workspaceContentEpochs.set(context.agent, 1)
  }, /selection or content changed/)
}))

test('content epoch is captured before the first awaited selection resolution', async () => saveFixture(async ({ design, save, project, agent, calls }) => {
  const current = design.currentSelection.bind(design)
  let enter, release
  const entered = new Promise(resolve => { enter = resolve })
  const gate = new Promise(resolve => { release = resolve })
  design.currentSelection = async (...args) => { const selected = await current(...args); enter(); await gate; return selected }
  const saving = save('Must not adopt a new scope during capture', 'capture-race')
  const rejected = assert.rejects(saving, /selection or content changed/)
  await entered
  design.projectContentEpochs.set(project.projectId, 1)
  design.workspaceContentEpochs.set(agent, 1)
  release()
  await rejected
  assert.equal(calls.length, 0)
}))

test('queued cancellation rejects before Git publication without consuming Journal facts', async () => saveFixture(async context => {
  const controller = new AbortController()
  await rejectQueuedSave(context, async () => controller.abort(), { name: 'AbortError' }, controller.signal)
}))

test('a real replacement Git repository while queued cannot receive the original save', async () => saveFixture(async context => {
  let replacement
  const head = await rejectQueuedSave(context, async () => {
    await rename(join(context.project.root, '.git'), join(context.project.root, '.git-original'))
    await context.command('init', '--quiet')
    await context.command('-c', 'user.name=Test', '-c', 'user.email=test@local', 'commit', '--allow-empty', '-qm', 'Replacement repository')
    replacement = await context.command('rev-parse', 'HEAD')
    assert.notEqual(replacement, context.initial.commit)
  }, /repository identity changed/)
  assert.equal(head, replacement)
}))

test('the existing directory-symlink Git repository shape still opens and saves', async () => saveFixture(async ({ project, root, save, command }) => {
  const target = join(root, 'linked-git-directory')
  await rename(join(project.root, '.git'), target)
  await symlink(target, join(project.root, '.git'), 'dir')
  assert.equal((await new DesignProjectManager().open(project.root)).metadata.id, project.projectId, 'the unmodified original manager admits this shape')
  const saved = await save('Existing symlink shape remains supported', 'symlink-save')
  assert.equal(await command('rev-parse', 'HEAD'), saved.commit)
}))

test('retargeting an existing directory-symlink Git entry while queued rejects the old save', async () => saveFixture(async context => {
  const path = join(context.project.root, '.git')
  const first = join(context.root, 'first-git-directory'), second = join(context.root, 'second-git-directory')
  await rename(path, first)
  await symlink(first, path, 'dir')
  assert.equal((await new DesignProjectManager().open(context.project.root)).metadata.id, context.project.projectId)
  await rejectQueuedSave(context, async () => {
    await rename(path, join(context.project.root, '.git-original-link'))
    await context.command('init', '--quiet')
    await context.command('-c', 'user.name=Test', '-c', 'user.email=test@local', 'commit', '--allow-empty', '-qm', 'Replacement symlink target')
    await rename(path, second)
    await symlink(second, path, 'dir')
  }, /repository identity changed/)
}))

test('replacing a symlink target directory without changing the link still rejects the queued save', async () => saveFixture(async context => {
  const path = join(context.project.root, '.git'), target = join(context.root, 'stable-target')
  const replacement = join(context.root, 'replacement-repository')
  await rename(path, target)
  await symlink(target, path, 'dir')
  await context.command('init', '--quiet', replacement)
  await context.command('-C', replacement, '-c', 'user.name=Test', '-c', 'user.email=test@local', 'commit', '--allow-empty', '-qm', 'Other repository')
  await rejectQueuedSave(context, async () => {
    await rename(target, join(context.root, 'old-target'))
    await rename(join(replacement, '.git'), target)
    assert.equal((await new DesignProjectManager().open(context.project.root)).metadata.id, context.project.projectId,
      'a fresh ordinary manager would admit the replacement; the unchanged-link witness must reject the old request')
  }, /repository identity changed/)
}))

test('a later request still checks new project metadata and cannot use the preceding request identity', async () => saveFixture(async ({ save, project, command }) => {
  const first = await save('Saved once', 'before-identity-change')
  const path = join(project.root, 'project.json')
  const metadata = JSON.parse(await readFile(path, 'utf8'))
  await writeFile(path, JSON.stringify({ ...metadata, id: '22222222-2222-4222-8222-222222222222' }))
  await assert.rejects(save('Must fail', 'after-identity-change'), /does not match registered id/)
  assert.equal(await command('rev-parse', 'HEAD'), first.commit)
}))

test('resolved transaction stores expire rather than becoming another request identity cache', async () => saveFixture(async ({ design, agent }) => {
  let escaped, late, release
  const gate = new Promise(resolve => { release = resolve })
  await design.withSelectedDesignFilesMutation(agent, nodeFs, new AbortController().signal, async (_project, store) => {
    escaped = store
    late = gate.then(() => store.head())
  })
  release()
  await assert.rejects(late, /scope has ended/, 'a detached task inherits ALS but not a live transaction capability')
  await assert.rejects(escaped.head(), /scope has ended/)
  await assert.rejects(escaped.write('sample', { title: 'Not authorized after return' }, { origin: 'panel', settleEvent: async () => {} }), /scope has ended/)
}))

test('captured stores expire before the worker cleanup wait, including worktree writes', { timeout: 5000 }, async () => saveFixture(async ({ design, agent, project }) => {
  const up = new PassThrough(), down = new PassThrough()
  const parent = Duplex.from({ readable: down, writable: up }), worker = Duplex.from({ readable: up, writable: down })
  let finish, rangeEntered, release
  const done = new Promise(resolve => { finish = resolve })
  const entered = new Promise(resolve => { rangeEntered = resolve })
  const range = new Promise(resolve => { release = () => resolve(true) })
  const runtime = Object.create(LocalSubprocessRuntime.prototype)
  runtime.resolveExecutable = async value => value
  runtime.spawnNativeContained = () => ({
    control: parent, collected: {}, done, containment: 'windows-job',
    terminate() { finish({ exitCode: 0, signal: null }) },
    async waitForExit() { rangeEntered(); return range },
  })
  design.context = { get: () => runtime }
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')
  const working = (async () => {
    await writeGitFrame(worker, { type: 'ready', version: 1 })
    for await (const frame of readGitFrames(worker)) {
      assert.equal(frame.value.type, 'close', 'escaped calls must not reach Git')
      await writeGitFrame(worker, { type: 'closed' })
      worker.end(); finish({ exitCode: 0, signal: null }); break
    }
  })()
  let escaped, saving, late, releaseLate
  const later = new Promise(resolve => { releaseLate = resolve })
  const path = join(project.designFilesRoot, 'sample/sample.json')
  const before = await readFile(path)
  try {
    Object.defineProperty(process, 'platform', { value: 'win32' })
    saving = design.withSelectedDesignFilesMutation(agent, nodeFs, new AbortController().signal, async (_project, store) => {
      escaped = store
      late = later.then(() => store.writeWorktreeText('sample/sample.json', '{"title":"Late worktree edit"}'))
    })
    await entered
    await assert.rejects(escaped.head(), /scope has ended/)
    const rejected = assert.rejects(late, /scope has ended/)
    releaseLate()
    await rejected
    assert.deepEqual(await readFile(path), before)
    release(); await saving; await working
  } finally {
    Object.defineProperty(process, 'platform', platform)
    releaseLate(); release(); parent.destroy(); worker.destroy()
    await saving?.catch(() => {})
    await working.catch(() => {})
  }
}))

test('normalizers still receive parsed prior canonical state, and binding changes before write are rejected', async () => saveFixture(async ({ save, design, agent, skill, project, command, initial }) => {
  skill.metadata.skillManifest = { runtime: 'fixture' }
  design.runtimeDriverFor = () => ({ normalizeState(next, _context, prior) {
    assert.deepEqual(prior, { title: 'Initial' })
    design.activeWorkspaces.set(agent, { project, binding: { revision: 2 }, values: {} })
    return next
  } })
  await assert.rejects(save('Must not write under a new binding', 'changed-binding'), /selection or content changed/)
  assert.equal(await command('rev-parse', 'HEAD'), initial.commit)
}))

test('an external HEAD advancement after the prior snapshot is re-read before publication', async () => saveFixture(async ({ save, design, skill, command }) => {
  let external
  skill.metadata.skillManifest = { runtime: 'fixture' }
  design.runtimeDriverFor = () => ({ async normalizeState(next, _context, prior) {
    assert.deepEqual(prior, { title: 'Initial' })
    await command('-c', 'user.name=Test', '-c', 'user.email=test@local', 'commit', '--allow-empty', '-qm', 'External concurrent publication')
    external = await command('rev-parse', 'HEAD')
    return next
  } })
  const saved = await save('Fresh publication parent', 'fresh-head')
  assert.equal(await command('rev-parse', `${saved.commit}^`), external, 'writeAuthorized must not reuse the earlier read snapshot HEAD')
}))

test('HEAD CAS still rejects an external publication at the final update-ref boundary', async () => saveFixture(async ({ save, hooks, command, design, project, agent }) => {
  let external
  hooks.beforeGit = async request => {
    if (request.argv[1] !== 'update-ref') return
    delete hooks.beforeGit
    await command('-c', 'user.name=Test', '-c', 'user.email=test@local', 'commit', '--allow-empty', '-qm', 'External CAS winner')
    external = await command('rev-parse', 'HEAD')
  }
  await assert.rejects(save('Must lose CAS', 'cas-conflict'), /update-ref|cannot lock ref/)
  assert.equal(await command('rev-parse', 'HEAD'), external)
  assert.equal((await design.journals.read(project.stateRoot, String(agent.id))).records.some(row => row.type === 'design/changed'), false)
  assert.equal(agent.notices.length, 0)
}))

test('Journal failure retains the committed receipt; same-event retry settles once without rewriting', async () => saveFixture(async ({ save, design, project, agent, command, calls }) => {
  const append = design.journals.append.bind(design.journals)
  let fail = true
  design.journals.append = async (...args) => {
    if (fail && args[2].type === 'design/changed') { fail = false; throw new Error('Injected Journal settlement failure') }
    return append(...args)
  }
  let committed
  await assert.rejects(save('Recover exact event', 'recover-save'), error => {
    assert.ok(error instanceof DesignWriteSettlementError)
    assert.equal(error.result.recovery.stage, 'journal')
    committed = error.result.commit
    return true
  })
  assert.equal(await command('rev-parse', 'HEAD'), committed)
  calls.length = 0
  assert.equal((await save('Recover exact event', 'recover-save')).commit, committed)
  assert.equal(calls.some(argv => argv.includes('commit-tree') || argv[1] === 'update-ref'), false)
  const history = await design.journals.read(project.stateRoot, String(agent.id))
  assert.equal(history.records.filter(row => row.type === 'design/changed').length, 1)
  await assert.rejects(save('Different bytes cannot reuse the event', 'recover-save'), /reused with different bytes/)
  assert.equal(await command('rev-parse', 'HEAD'), committed)
  assert.equal(agent.notices.length, 1)
}))

test('invalid prior canonical JSON is not silently bypassed by the snapshot optimization', async () => saveFixture(async ({ save, project, command }) => {
  await writeFile(join(project.designFilesRoot, 'sample/sample.json'), '{ invalid prior json')
  await command('add', '--', 'design_files/sample/sample.json')
  await command('-c', 'user.name=Test', '-c', 'user.email=test@local', 'commit', '-qm', 'Malformed external state')
  const before = await command('rev-parse', 'HEAD')
  await assert.rejects(save('Valid replacement must not skip the old parse guard', 'invalid-prior'), SyntaxError)
  assert.equal(await command('rev-parse', 'HEAD'), before)
}))

test('review: A to B to A while the first selection read awaits cannot publish', async () => saveFixture(async context => {
  const { design, agent, project, save, calls, command, initial } = context
  const current = design.currentSelection.bind(design)
  let enter, release
  const entered = new Promise(resolve => { enter = resolve })
  const held = new Promise(resolve => { release = resolve })
  design.currentSelection = async (...args) => { const selected = await current(...args); enter(); await held; return selected }
  const pending = save('Old request after a selection round trip', 'review-capture-aba')
  const rejected = assert.rejects(pending, /selection or content changed/)
  await entered
  design.activeWorkspaces.set(agent, { project: { ...project, projectId: 'another-project' }, binding: { revision: 2 }, values: {} })
  design.activeWorkspaces.set(agent, { project, binding: { revision: 3 }, values: {} })
  release()
  await rejected
  assert.equal(calls.length, 0)
  assert.equal(await command('rev-parse', 'HEAD'), initial.commit)
  assert.equal(agent.notices.length, 0)
}))

test('review: a failed callback revokes stores inherited by a later async task', async () => saveFixture(async ({ design, agent, command, initial }) => {
  let escaped, late, release
  const held = new Promise(resolve => { release = resolve })
  const failure = new Error('Callback failed before any write')
  await assert.rejects(design.withSelectedDesignFilesMutation(agent, nodeFs, new AbortController().signal, async (_project, store) => {
    escaped = store
    late = held.then(() => store.write('sample', { title: 'Must not publish after rejection' }, { origin: 'panel', settleEvent: async () => {} }))
    throw failure
  }), error => error === failure)
  const rejected = assert.rejects(late, /scope has ended/)
  release()
  await rejected
  await assert.rejects(escaped.readPublishedSnapshot('sample'), /scope has ended/)
  assert.equal(await command('rev-parse', 'HEAD'), initial.commit)
}))

test('review: a selection change during a store read is rejected by its post-read fence', async () => saveFixture(async ({ design, agent, project, hooks, command, initial }) => {
  await assert.rejects(design.withSelectedDesignFilesMutation(agent, nodeFs, new AbortController().signal, async (_project, store) => {
    hooks.afterGit = async request => {
      if (request.argv[1] !== 'rev-parse' || request.argv.at(-1) !== 'HEAD') return
      delete hooks.afterGit
      design.activeWorkspaces.set(agent, { project, binding: { revision: 2 }, values: {} })
    }
    await store.head()
  }), /selection or content changed/)
  assert.equal(await command('rev-parse', 'HEAD'), initial.commit)
}))

test('review: repository replacement after admission is rejected before publication', async () => saveFixture(async ({ save, design, skill, project, calls, command }) => {
  let replacement
  skill.metadata.skillManifest = { runtime: 'fixture' }
  design.runtimeDriverFor = () => ({ async normalizeState(next) {
    await rename(join(project.root, '.git'), join(project.root, '.git-original'))
    await command('init', '--quiet')
    await command('-c', 'user.name=Test', '-c', 'user.email=test@local', 'commit', '--allow-empty', '-qm', 'Replacement after admission')
    replacement = await command('rev-parse', 'HEAD')
    return next
  } })
  await assert.rejects(save('Must not publish to a substituted repository', 'review-repo-after-admission'), /repository identity changed/)
  assert.equal(calls.some(argv => argv.includes('commit-tree') || argv[1] === 'update-ref'), false)
  assert.equal(await command('rev-parse', 'HEAD'), replacement)
}))

test('review: rejecting an old queued request leaves a fresh selection save usable', async () => saveFixture(async context => {
  const { design, agent, project, save, command } = context
  await rejectQueuedSave(context, async () => {
    design.activeWorkspaces.set(agent, { project: { ...project, projectId: 'another-project' }, binding: { revision: 2 }, values: {} })
    design.activeWorkspaces.set(agent, { project, binding: { revision: 3 }, values: {} })
  }, /selection or content changed/)
  const saved = await save('A new request is valid for the new selection', 'review-fresh-after-rejection')
  assert.equal(await command('rev-parse', 'HEAD'), saved.commit)
  assert.equal((await design.journals.read(project.stateRoot, String(agent.id))).records.filter(row => row.type === 'design/changed').length, 1)
  assert.equal(agent.notices.length, 1)
}))
