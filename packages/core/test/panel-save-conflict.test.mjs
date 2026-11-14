/** Shared backend with real Git/files; no browser, Native Host or model claim. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { Worker, SHARE_ENV } from 'node:worker_threads'
const { register } = await import('tsx/esm/api'); register()
const { DesignFilesStore } = await import('../src/design-files.ts')
const { applyPanelEdit } = await import('../src/panel-save.ts')
const { GitVersioning } = await import('../src/git.ts')
const { nodeFs } = await import('../src/service-tools.ts')
const { DesignPanelRemote } = await import('../src/panel-remote.ts')
const { NativeGitExecutor } = await import('../src/git-native-executor.ts')
const { default: remoteContract } = await import('../src/typert.remote-client.ts')
const exec = promisify(execFile)
const initial = { title: 'Original', detail: { confirmed: true } }
const changed = { title: 'Native change', detail: { confirmed: true } }
const draft = { title: 'Human draft', detail: { confirmed: true } }
const conflict = error => error.code === 'PANEL_SAVE_CONFLICT' && /PANEL_SAVE_CONFLICT/.test(error.message)

test('strict Remote codec accepts optional before envelopes, legacy arrays and the existing auto contract', () => {
  const descriptor = remoteContract.descriptors.find(d => d.method === 'savePanel')
  const codec = descriptor.parameters.find(p => p.name === 'artifacts').codec.create()
  for (const value of [undefined, [], { before: initial }, { before: null, artifacts: [] }, { autoBefore: initial, definitionRevision: 'revision' }]) {
    assert.equal(codec.safeParse(value).success, true)
  }
  for (const value of [{}, { artifacts: [] }, { before: initial, autoBefore: initial }, { before: initial, artifacts: 'bad' }]) {
    assert.equal(codec.safeParse(value).success, false)
  }
})

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'panel-save-conflict-'))
  // Source imports do not contain a colocated .js worker. Reuse the actual
  // normal Core build through its existing worker-injection test seam.
  const executor = new NativeGitExecutor(() => new Worker(new URL('../lib/git-native-worker.js', import.meta.url), {
    execArgv: [], env: SHARE_ENV,
  }))
  t.after(async () => { await executor.close(); await rm(root, { recursive: true, force: true }) })
  const spawn = async ({ argv, cwd, env, signal }) => {
    try { return { exitCode: 0, ...await exec(argv[0], argv.slice(1), { cwd, signal, env: { ...process.env, ...env,
      GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@localhost', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@localhost' } }) } }
    catch (error) { return { exitCode: error.code, stdout: error.stdout ?? '', stderr: error.stderr ?? '' } }
  }
  spawn.native = request => executor.execute(request)
  const git = new GitVersioning(spawn, root); await git.ensureRepo()
  const store = new DesignFilesStore(nodeFs, git, root), events = []
  const settle = async event => { events.push(event) }
  await store.write('sample', initial, { origin: 'agent', settleEvent: async () => {} })
  const save = (state, before, eventId = 'human-save') => applyPanelEdit(store,
    { skill: 'sample', state, before }, settle, undefined,
    { 'sample/note.md': 'Panel attachment' }, undefined, undefined, { eventId, kind: 'panel-save' })
  return { root, git, store, events, settle, save, path: join(root, 'sample/sample.json') }
}

test('a stale Panel save cannot overwrite newer canonical state or artifacts', async t => {
  const f = await fixture(t)
  await f.store.write('sample', changed, { origin: 'agent', artifacts: { 'sample/note.md': 'Native attachment' }, settleEvent: async () => {} })
  const head = await f.store.head()
  await assert.rejects(f.save(draft, initial), conflict)
  assert.deepEqual(await f.store.read('sample'), changed)
  assert.equal(await readFile(join(f.root, 'sample/note.md'), 'utf8'), 'Native attachment')
  assert.equal(await f.store.head(), head)
  assert.deepEqual(f.events, [])
})

test('uncommitted, invalid and deleted canonical edits are preserved on conflict', async t => {
  const f = await fixture(t), head = await f.store.head()
  for (const text of [JSON.stringify(changed), '{ incomplete native edit']) {
    await writeFile(f.path, text)
    await assert.rejects(f.save(draft, initial), conflict)
    assert.equal(await readFile(f.path, 'utf8'), text)
    assert.equal(await f.store.head(), head)
  }
  await rm(f.path)
  await assert.rejects(f.save(draft, initial), conflict)
  await assert.rejects(readFile(f.path), { code: 'ENOENT' })
  assert.deepEqual(f.events, [])
})

test('formatting, object key order and an unrelated Bundle commit do not conflict', async t => {
  const f = await fixture(t)
  await writeFile(f.path, JSON.stringify({ detail: { confirmed: true }, title: 'Original' }))
  await f.store.write('other', { title: 'Unrelated Native work' }, { origin: 'agent', settleEvent: async () => {} })
  const saved = await f.save(draft, initial)
  assert.ok(saved.commit)
  assert.deepEqual(await f.store.read('sample'), draft)
  assert.deepEqual(await f.store.read('other'), { title: 'Unrelated Native work' })
})

test('an exact audited save replays without overwriting a later Native change', async t => {
  const f = await fixture(t), saved = await f.save(draft, initial)
  await f.store.write('sample', changed, { origin: 'agent', artifacts: { 'sample/note.md': 'Later Native attachment' }, settleEvent: async () => {} })
  const head = await f.store.head()
  const replay = await f.save(draft, initial)
  assert.equal(replay.commit, saved.commit)
  assert.deepEqual(await f.store.read('sample'), changed)
  assert.equal(await readFile(join(f.root, 'sample/note.md'), 'utf8'), 'Later Native attachment')
  assert.equal(await f.store.head(), head)
  await assert.rejects(f.save({ ...draft, title: 'Reused event with different content' }, changed), /reused with different bytes/)
  const recovered = await f.save({ ...changed, title: 'Human edit after rereading Native work' }, changed, 'fresh-after-reread')
  assert.ok(recovered.commit)
})

test('a missing canonical base is explicit null; a later creation conflicts', async t => {
  const f = await fixture(t)
  const save = (state, eventId) => applyPanelEdit(f.store, { skill: 'new_bundle', state, before: null }, f.settle,
    undefined, undefined, undefined, undefined, { eventId, kind: 'panel-save' })
  await save({ title: 'First creation' }, 'new-first')
  await assert.rejects(save({ title: 'Stale absent base' }, 'new-second'), conflict)
  assert.deepEqual(await f.store.read('new_bundle'), { title: 'First creation' })
})

test('the baseline is detached before entering an existing queued mutation', async t => {
  const f = await fixture(t), before = structuredClone(initial)
  let release
  const held = new Promise(resolve => { release = resolve })
  const queued = new DesignFilesStore(nodeFs, f.git, f.root, { read: run => run(), mutate: run => held.then(run) })
  const pending = queued.write('sample', draft, { origin: 'panel', before, settleEvent: f.settle })
  await writeFile(f.path, JSON.stringify(changed)); before.title = changed.title
  release()
  await assert.rejects(pending, conflict)
  assert.deepEqual(await f.store.read('sample'), changed)
})

test('DSH Remote forwards the optional canonical envelope and keeps legacy saves available', async t => {
  const f = await fixture(t), journal = [], notices = []
  const remote = Object.create(DesignPanelRemote.prototype)
  const project = { projectId: '11111111-1111-4111-8111-111111111111' }
  const skill = { name: 'sample', version: '1.0', execution: { handoff: 'none' }, metadata: {
    schemaYaml: 'type: object\nrequired: [title]\nproperties:\n  title: { type: string }\n',
  } }
  remote.design = {
    withSelectedDesignFilesMutation: async (_agent, _fs, _signal, run) => run(project, f.store),
    requireKitForAgent: () => ({ name: 'fixture', version: '1.0', skills: [skill] }),
    readDesignJournal: async () => ({ revision: journal.length, records: [] }),
    assertProjectSelection() {}, recordDesignChange: async (_agent, _project, event) => { journal.push(event); return journal.length },
  }
  const agent = { inject: text => notices.push(text) }
  const save = (payload, id) => remote.savePanel(agent, 'sample', draft, payload, id, new AbortController().signal)
  await f.store.write('sample', changed, { origin: 'agent', settleEvent: async () => {} })
  await assert.rejects(save({ before: initial, artifacts: [] }, 'remote-stale'), conflict)
  assert.deepEqual(await f.store.read('sample'), changed)
  assert.deepEqual(journal, []); assert.deepEqual(notices, [])
  assert.ok((await save({ before: changed }, 'remote-current')).commit)
  await f.store.write('sample', changed, { origin: 'agent', settleEvent: async () => {} })
  assert.ok((await save([], 'remote-legacy')).commit, 'old clients retain the existing save contract')
})
