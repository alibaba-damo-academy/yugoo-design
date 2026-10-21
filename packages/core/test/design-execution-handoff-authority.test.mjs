import assert from 'node:assert/strict'
import test from 'node:test'
const { register } = await import('tsx/esm/api')
register()
const { pendingMustEditAuthority, pendingMustEditAuthorityForSave } = await import('../src/design-execution-handoff-authority.ts')

const change = (origin, commit, execution, overrides = {}) => ({
  type: 'design/changed', data: {
    kit: 'fixture', version: '1.0', skill: 'sample', origin,
    ...(commit === undefined ? {} : { commit }),
    ...(execution === undefined ? {} : { execution }), ...overrides,
  },
})
const pending = { invocationId: 'run-1', stateStatus: 'pending', handoff: 'must_edit' }
const derive = (records, head) => pendingMustEditAuthority(records, 'fixture', '1.0', 'sample', head)

test('publication authority is independent of main versus Producer execution', () => {
  for (const mode of ['main', 'subagent']) {
    assert.deepEqual(derive([change('agent', 'A', { ...pending, mode })], 'A'), {
      invocationId: 'run-1', stateRevision: 'A',
    })
  }
})

test('repeated Panel saves retain earliest release B rather than latest C', () => {
  const records = [change('agent', 'A', pending), change('panel', 'B'), change('panel', undefined), change('panel', 'C')]
  assert.deepEqual(derive(records, 'C'), { invocationId: 'run-1', stateRevision: 'A', panelStateRevision: 'B' })
  assert.equal(derive(records, 'B'), undefined, 'latest relevant commit must match HEAD')
})

test('no-op alone cannot release a pending gate', () => {
  assert.deepEqual(derive([change('agent', 'A', pending), change('panel', undefined)], 'A'), {
    invocationId: 'run-1', stateRevision: 'A',
  })
  assert.equal(derive([change('panel', 'B')], 'B'), undefined)
  assert.equal(derive([change('agent', undefined, pending)], 'A'), undefined)
  assert.equal(derive([change('agent', 'A', pending)], undefined), undefined)
})

test('other Kit versions, Bundles and journal event kinds do not replace authority', () => {
  const records = [change('agent', 'A', pending),
    change('agent', 'other', pending, { kit: 'other' }),
    change('agent', 'other', pending, { version: '2.0' }),
    change('agent', 'other', pending, { skill: 'other' }),
    { type: 'design/execution-handoff-consumed', data: {} },
  ]
  assert.deepEqual(derive(records, 'A'), { invocationId: 'run-1', stateRevision: 'A' })
  assert.equal(derive(records, 'other'), undefined)
})

test('a newer publication terminates the earlier gate and release chain', () => {
  for (const execution of [undefined, { ...pending, stateStatus: 'complete' }, { ...pending, handoff: 'user_continue' }]) {
    assert.equal(derive([change('agent', 'A', pending), change('panel', 'B'), change('agent', 'C', execution)], 'C'), undefined)
  }
  assert.deepEqual(derive([change('agent', 'A', pending), change('panel', 'B'),
    change('agent', 'C', { ...pending, invocationId: 'run-2' })], 'C'), { invocationId: 'run-2', stateRevision: 'C' })
})

test('invalid invocation identity fails rather than inventing authority', () => {
  assert.throws(() => derive([change('agent', 'A', { ...pending, invocationId: '../wrong' })], 'A'), /invalid Design execution invocation id/)
})

const resolve = (records, head, read) => pendingMustEditAuthorityForSave(records, 'fixture', '1.0', 'sample', head, read)

test('audit-only commits preserve HEAD checking without becoming release authority', async () => {
  const records = [change('agent', 'A', pending), change('panel', 'B')]
  assert.deepEqual(await resolve(records, 'B', async () => ''), { invocationId: 'run-1', stateRevision: 'A' })
  assert.equal(await resolve(records, 'A', async () => { throw Error('must not read unauthoritative history') }), undefined)
})

test('the first real change wins across earlier empty audit and later edited commits', async () => {
  const records = [change('agent', 'A', pending), change('panel', 'B'), change('panel', 'C'), change('panel', 'D')]
  assert.deepEqual(await resolve(records, 'D', async commit => commit === 'B' ? '' : 'actual artifact diff'), {
    invocationId: 'run-1', stateRevision: 'A', panelStateRevision: 'C',
  })
})

test('no-op retry after a real release reconstructs that release for failed consumption repair', async () => {
  const records = [change('agent', 'A', pending), change('panel', 'B'), change('panel', 'C')]
  assert.deepEqual(await resolve(records, 'C', async commit => commit === 'B' ? 'diff' : ''), {
    invocationId: 'run-1', stateRevision: 'A', panelStateRevision: 'B',
  })
})

test('committed diff failures propagate and unrelated history is never read', async () => {
  const records = [change('agent', 'A', pending), change('panel', 'B'), change('panel', 'other', undefined, { skill: 'other' })]
  const calls = []
  await assert.rejects(resolve(records, 'B', async commit => { calls.push(commit); throw Error('exact diff unavailable') }), /exact diff unavailable/)
  assert.deepEqual(calls, ['B'])
})

test('repeated journal entries read each exact commit only once', async () => {
  const calls = []
  await resolve([change('agent', 'A', pending), change('panel', 'B'), change('panel', 'B')], 'B', async commit => {
    calls.push(commit); return 'diff'
  })
  assert.deepEqual(calls, ['B'])
})

test('later save history does not cause repeated Git diff queries after the earliest release', async () => {
  const records = [change('agent', 'A', pending), change('panel', 'B'),
    ...Array.from({ length: 100 }, (_, index) => change('panel', `later-${index}`))]
  const calls = []
  const authority = await resolve(records, 'later-99', async commit => { calls.push(commit); return 'real diff' })
  assert.equal(authority.panelStateRevision, 'B')
  assert.deepEqual(calls, ['B'], 'latest HEAD validation does not require diffing all later saves')
})

test('real Git empty audit commits cannot release but an artifact-only edit can', async () => {
  const { mkdtemp, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { promisify } = await import('node:util')
  const { execFile } = await import('node:child_process')
  const { DesignFilesStore } = await import('../src/design-files.ts')
  const { GitVersioning } = await import('../src/git.ts')
  const { nodeFs } = await import('../src/service-tools.ts')
  const exec = promisify(execFile)
  const root = await mkdtemp(join(tmpdir(), 'handoff-authority-'))
  try {
    const git = new GitVersioning(async ({ argv, cwd, env, signal }) => {
      try {
        const out = await exec(argv[0], argv.slice(1), { cwd, signal, env: { ...process.env, ...env,
          GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@localhost', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@localhost' } })
        return { exitCode: 0, ...out }
      } catch (error) { return { exitCode: error.code, stdout: error.stdout ?? '', stderr: error.stderr ?? '' } }
    }, root)
    await git.ensureRepo()
    const store = new DesignFilesStore(nodeFs, git, root)
    const records = []
    const state = { title: 'Unchanged canonical state' }
    const a = await store.write('sample', state, { origin: 'agent', settleEvent: event => {
      records.push(change('agent', event.commit, pending)); return Promise.resolve()
    } })
    const save = (eventId, artifacts) => store.write('sample', state, { origin: 'panel', audit: { eventId, kind: 'panel-save' },
      ...(artifacts ? { artifacts } : {}), settleEvent: event => {
        records.push(change('panel', event.commit)); return Promise.resolve()
      } })
    const b = await save('empty-save')
    assert.ok(b.commit && b.commit !== a.commit, 'empty saves still have their real audit commits')
    assert.equal(b.diff, '')
    assert.deepEqual(await resolve(records, b.commit, commit => store.diffCommit(commit)), { invocationId: 'run-1', stateRevision: a.commit })
    const c = await save('artifact-save', { 'sample/details.md': 'Actual artifact edit' })
    assert.notEqual(c.diff, '')
    const d = await save('empty-retry')
    assert.equal(d.diff, '')
    assert.deepEqual(await resolve(records, d.commit, commit => store.diffCommit(commit)), {
      invocationId: 'run-1', stateRevision: a.commit, panelStateRevision: c.commit,
    })
  } finally { await rm(root, { recursive: true, force: true }) }
})
