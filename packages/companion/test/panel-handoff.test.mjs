/** Source regression: real shared schema/files/Git/journal; no host/model/browser claim. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, cp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
const { register } = await import('tsx/esm/api')
register()
const coreEntry = new URL('../src/core-entry.ts', import.meta.url)
const core = await import(coreEntry)
const source = (await readFile(new URL('../src/project.mjs', import.meta.url), 'utf8'))
  .replaceAll('../../core/lib/index.js', coreEntry.href)
  .replaceAll('../../core/lib/kit-loader.js', new URL('../../core/src/kit-loader.ts', import.meta.url).href)
  .replaceAll('./auto-panel-tickets.mjs', new URL('../src/auto-panel-tickets.mjs', import.meta.url).href)
const { openCompanionProject } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
const threadId = '00000000-0000-4000-8000-000000000051'
async function fixture(mode = 'main') {
  const root = await mkdtemp(join(tmpdir(), 'companion-handoff-source-'))
  const kitRoot = join(root, 'kit')
  await mkdir(kitRoot)
  for (const file of ['mindset.md', 'skills']) await cp(fileURLToPath(new URL(`../../skills-web-app/${file}`, import.meta.url)), join(kitRoot, file), { recursive: true })
  const manifest = join(kitRoot, 'skills/smart_questions/skill.yaml')
  await writeFile(manifest, (await readFile(manifest, 'utf8')).replace('  mode: main\n', `  mode: ${mode}\n`))
  const projectRoot = join(root, 'project'), stateRoot = join(root, 'state')
  await new core.DesignProjectManager().create({ root: projectRoot, name: 'Source handoff regression', knowledge: { provider: 'ladybug-wasm' }, kit: { name: 'web_app', version: '1.0' } })
  const options = { projectRoot, stateRoot, kitRoot, connection: { host: 'codex', threadId } }
  let project = await openCompanionProject(options)
  const journal = new core.DesignJournalStorage(join(stateRoot, project.project.metadata.id))
  const records = async () => (await journal.read(`codex:${threadId}`)).records
  const state = { questions: { fixture: { prompt: 'Synthetic regression question', kind: 'text', answer: '', detail: '' } } }
  await mkdir(join(projectRoot, 'design_files/smart_questions'), { recursive: true })
  await writeFile(join(projectRoot, 'design_files/smart_questions/smart_questions.json'), JSON.stringify(state))
  const published = await project.settleBundle({ skill: 'smart_questions', invocationId: `fixture-${mode}`, scope: 'state', outcome: 'pause' })
  const draft = answer => ({ ...published.state, questions: { ...published.state.questions, fixture: { ...published.state.questions.fixture, answer } } })
  return { root, published, draft, records, get project() { return project }, async reopen() { project = await openCompanionProject(options); return project }, async close() { await rm(root, { recursive: true, force: true }) } }
}
const dispositions = records => records.filter(record => record.type === 'design/execution-handoff-consumed')
for (const mode of ['main', 'subagent']) test(`${mode} policy: real pending publication and Panel save consume exact A/B once`, async () => {
  const f = await fixture(mode)
  try {
    const agent = (await f.records()).find(record => record.type === 'design/changed' && record.data.origin === 'agent')
    assert.equal(agent.data.execution.invocationId, `fixture-${mode}`)
    assert.equal(agent.data.execution.handoff, 'must_edit')
    const args = { skill: 'smart_questions', state: f.draft('actual saved answer'), eventId: 'save-1' }
    const saved = await f.project.savePanel(args)
    const consumed = dispositions(await f.records())
    assert.equal(consumed.length, 1)
    assert.equal(consumed[0].data.pin.stateRevision, f.published.commit)
    assert.equal(consumed[0].data.invocationId, `fixture-${mode}`)
    assert.equal(consumed[0].data.panelStateRevision, saved.commit)
    assert.equal(consumed[0].data.pin.projectId, f.project.project.metadata.id)
    assert.deepEqual(await f.project.savePanel(args), saved)
    await f.reopen()
    assert.deepEqual(await f.project.savePanel(args), saved)
    assert.equal(dispositions(await f.records()).length, 1)
    const later = await f.project.savePanel({ ...args, state: f.draft('later answer'), eventId: 'save-2' })
    assert.notEqual(later.commit, saved.commit)
    assert.equal(dispositions(await f.records())[0].data.panelStateRevision, saved.commit)
  } finally { await f.close() }
})
test('schema refusal appends nothing and retains pending exact publication', async () => {
  const f = await fixture()
  try {
    const before = await f.records(), head = await f.project.store.head()
    const state = f.draft(17)
    await assert.rejects(f.project.savePanel({ skill: 'smart_questions', state, eventId: 'invalid' }), /expected string/)
    assert.equal(await f.project.store.head(), head)
    assert.deepEqual(await f.records(), before)
    assert.equal(dispositions(await f.records()).length, 0)
  } finally { await f.close() }
})
test('consumption append failure retains Panel commit and exact same-event retry recovers after reopening', async () => {
  const f = await fixture()
  const original = core.DesignJournalStorage.prototype.atomicMutate
  let fail = true
  core.DesignJournalStorage.prototype.atomicMutate = function (conversation, mutator) {
    return original.call(this, conversation, current => {
      const candidate = mutator(current)
      if (fail && candidate?.type === 'design/execution-handoff-consumed') { fail = false; throw new Error('Injected consumption append failure') }
      return candidate
    })
  }
  try {
    const args = { skill: 'smart_questions', state: f.draft('answer before failure'), eventId: 'uncertain-save' }
    await assert.rejects(f.project.savePanel(args), /Injected consumption append failure/)
    const committed = await f.project.store.head()
    assert.notEqual(committed, f.published.commit)
    assert.equal(dispositions(await f.records()).length, 0)
    await f.reopen()
    const recovered = await f.project.savePanel(args)
    assert.equal(recovered.commit, committed)
    const consumed = dispositions(await f.records())
    assert.equal(consumed.length, 1)
    assert.equal(consumed[0].data.panelStateRevision, committed)
    assert.equal(consumed[0].data.pin.stateRevision, f.published.commit)
  } finally { core.DesignJournalStorage.prototype.atomicMutate = original; await f.close() }
})
test('failed consumption retried in-memory clears rejected save cache', async () => {
  const f = await fixture()
  const original = core.DesignExecutionHandoffJournal.prototype.consume
  let fail = true
  core.DesignExecutionHandoffJournal.prototype.consume = async function (...args) {
    if (fail) { fail = false; throw new Error('Injected first consume failure') }
    return original.apply(this, args)
  }
  try {
    const args = { skill: 'smart_questions', state: f.draft('retry same active connection'), eventId: 'same-connection-retry' }
    await assert.rejects(f.project.savePanel(args), /Injected first consume failure/)
    const committed = await f.project.store.head()
    assert.equal((await f.project.savePanel(args)).commit, committed)
    assert.equal(dispositions(await f.records()).length, 1)
  } finally { core.DesignExecutionHandoffJournal.prototype.consume = original; await f.close() }
})
test('new event after failed consumption retains earliest real Panel B instead of later C', async () => {
  const f = await fixture()
  const original = core.DesignExecutionHandoffJournal.prototype.consume
  let fail = true
  core.DesignExecutionHandoffJournal.prototype.consume = async function (...args) {
    if (fail) { fail = false; throw new Error('Injected first consume failure') }
    return original.apply(this, args)
  }
  try {
    await assert.rejects(f.project.savePanel({ skill: 'smart_questions', state: f.draft('first real edit'), eventId: 'first-edit' }), /Injected first consume failure/)
    const firstPanel = await f.project.store.head()
    const later = await f.project.savePanel({ skill: 'smart_questions', state: f.draft('second real edit'), eventId: 'second-edit' })
    assert.notEqual(later.commit, firstPanel)
    assert.equal(dispositions(await f.records()).length, 1)
    assert.equal(dispositions(await f.records())[0].data.panelStateRevision, firstPanel)
  } finally { core.DesignExecutionHandoffJournal.prototype.consume = original; await f.close() }
})
test('semantic no-op audit is retained but cannot consume; subsequent real edit uses its own B', async () => {
  const f = await fixture()
  try {
    const noop = await f.project.savePanel({ skill: 'smart_questions', state: f.published.state, eventId: 'audit-only' })
    assert.ok(noop.commit)
    assert.equal(dispositions(await f.records()).length, 0)
    const saved = await f.project.savePanel({ skill: 'smart_questions', state: f.draft('real edit after audit'), eventId: 'real-after-audit' })
    assert.notEqual(saved.commit, noop.commit)
    assert.equal(dispositions(await f.records()).length, 1)
    assert.equal(dispositions(await f.records())[0].data.panelStateRevision, saved.commit)
    assert.equal(dispositions(await f.records())[0].data.pin.stateRevision, f.published.commit)
  } finally { await f.close() }
})
test('artifact-only Panel change consumes after an audit no-op without changing canonical JSON', async () => {
  const f = await fixture()
  try {
    await f.project.savePanel({ skill: 'smart_questions', state: f.published.state, eventId: 'artifact-noop' })
    const saved = await f.project.savePanel({ skill: 'smart_questions', state: f.published.state,
      artifacts: [{ path: 'smart_questions/fixture.txt', content: 'actual artifact edit' }], eventId: 'artifact-edit' })
    assert.equal(dispositions(await f.records()).length, 1)
    assert.equal(dispositions(await f.records())[0].data.panelStateRevision, saved.commit)
    assert.deepEqual(await f.project.store.read('smart_questions'), f.published.state)
    assert.equal(await f.project.store.readWorktreeText('smart_questions/fixture.txt'), 'actual artifact edit')
  } finally { await f.close() }
})
test('exact historical diff read failure rejects before any new save or disposition', async () => {
  const f = await fixture()
  try {
    await f.project.savePanel({ skill: 'smart_questions', state: f.published.state, eventId: 'historical-noop' })
    const records = await f.records(), head = await f.project.store.head()
    f.project.store.diffCommit = async () => { throw new Error('Injected exact Git diff read failure') }
    await assert.rejects(f.project.savePanel({ skill: 'smart_questions', state: f.draft('must not be written'), eventId: 'blocked-read' }), /Injected exact Git diff read failure/)
    assert.equal(await f.project.store.head(), head)
    assert.deepEqual(await f.records(), records)
    assert.equal(dispositions(await f.records()).length, 0)
  } finally { await f.close() }
})
test('a completed publication ends prior pending authority before a later Panel save', async () => {
  const f = await fixture()
  try {
    await f.project.settleBundle({ skill: 'smart_questions', invocationId: 'completed-next', scope: 'completion', outcome: 'complete' })
    await f.project.savePanel({ skill: 'smart_questions', state: f.draft('edit after completion'), eventId: 'post-complete' })
    assert.equal(dispositions(await f.records()).length, 0)
  } finally { await f.close() }
})
