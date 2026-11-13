/** Source Remote integration with real Files/Git/journal, not host/model E2E. */
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
const { register } = await import('tsx/esm/api')
register()
const { DesignPanelRemote } = await import('../src/panel-remote.ts')
const { DesignFilesStore } = await import('../src/design-files.ts')
const { GitVersioning } = await import('../src/git.ts')
const { nodeDesignProjectSpawn } = await import('../src/design-project.ts')
const { nodeFs } = await import('../src/service-tools.ts')
const { executeNativeGit } = await import('../src/git-native.ts')
const { DshLibraryGitScope } = await import('../src/dsh-library-git-scope.ts')
const { DesignJournalStorage } = await import('../src/design-journal-storage.ts')
const { DesignExecutionHandoffJournal } = await import('../src/design-execution-handoff-journal.ts')
const { deriveCurrentDesignExecutionGate } = await import('../src/design-execution-derivation.ts')
const exec = promisify(execFile)

/** Real publication/save/journal path, with only the Host selection seam stubbed. */
async function handoffFixture(handoff, run) {
  const root = await mkdtemp(join(tmpdir(), 'panel-handoff-state-'))
  try {
    const git = new GitVersioning(async request => {
      if (request.binaryStdout !== undefined) return nodeDesignProjectSpawn(request)
      try {
        const out = await exec(request.argv[0], request.argv.slice(1), { cwd: request.cwd,
          signal: request.signal, env: { ...process.env, ...request.env,
            GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@localhost',
            GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@localhost' } })
        return { exitCode: 0, ...out }
      } catch (error) { return { exitCode: error.code, stdout: error.stdout ?? '', stderr: error.stderr ?? '' } }
    }, root)
    await git.ensureRepo()
    const store = new DesignFilesStore(nodeFs, git, root)
    const journal = new DesignJournalStorage(join(root, '.journal'))
    const handoffs = new DesignExecutionHandoffJournal(journal)
    const conversation = 'panel-handoff-state'
    const project = { projectId: '11111111-1111-4111-8111-111111111111' }
    const skill = { name: 'sample', version: '1.0', execution: { handoff,
      ...(handoff === 'user_continue' ? { resumeAction: { routeId: 'execute_plan', label: { en: 'Start', zh: '开始' } } } : {}),
    }, metadata: { schemaYaml: 'type: object\nrequired: [title]\nproperties:\n  title: {type: string}\n' } }
    const kit = { name: 'fixture', version: '1.0', skills: [skill] }
    const record = data => journal.append(conversation, { type: 'design/changed', data })
    const publish = (title, stateStatus = 'pending') => store.write(skill.name, { title }, {
      origin: 'agent', publication: { skill: skill.name, bundleVersion: skill.version,
        invocationId: stateStatus === 'pending' ? 'original-run' : 'completed-run',
        stateStatus, handoff: stateStatus === 'pending' ? handoff : 'none' },
      settleEvent: event => record({ kit: kit.name, version: kit.version, skill: skill.name,
        state: event.state, origin: 'agent', commit: event.commit,
        execution: { invocationId: stateStatus === 'pending' ? 'original-run' : 'completed-run',
          stateStatus, handoff: stateStatus === 'pending' ? handoff : 'none' } }).then(() => {}),
    })
    const published = await publish('Original plan')
    let beforeSaveNative
    const remote = Object.create(DesignPanelRemote.prototype)
    remote.design = {
      withSelectedDesignFilesMutation: async (_agent, _fs, signal, operation, entered) => {
        // Exercise the real native adapter and its per-save fail-stop scope.
        const scope = new DshLibraryGitScope(root, signal, async () => {}, undefined,
          async (request, beforeExecute) => {
            await beforeExecute?.()
            await beforeSaveNative?.(request.operation)
            return executeNativeGit(root, request.operation, request.signal)
          })
        try {
          entered?.()
          const scopedGit = new GitVersioning(scope.spawn, root, undefined, false, 'native')
          return await operation(project, new DesignFilesStore(nodeFs, scopedGit, root))
        } finally { await scope.close() }
      },
      recordSettledPanelSave() {}, requireKitForAgent: () => kit,
      readDesignJournal: () => journal.read(conversation), assertProjectSelection() {},
      recordDesignChange: async (_agent, _project, data) => {
        await record(data)
        return (await journal.read(conversation)).revision
      },
      consumeExecutionHandoff: (_agent, candidate) => handoffs.consume(conversation, candidate),
    }
    const agent = { session: { header: { origin: 'user' }, snapshotEvents: () => [] }, inject() {} }
    const save = (title, eventId, signal = new AbortController().signal) => remote.savePanel(agent, skill.name, { title }, [], eventId, signal)
    const gate = async () => deriveCurrentDesignExecutionGate({ projectId: project.projectId,
      records: (await journal.read(conversation)).records, kit, skill,
      stateRevision: await store.head(), state: await store.readPublished(skill.name), store,
      signal: new AbortController().signal })
    let review = 0
    const recordsOnly = async () => {
      const content = `${JSON.stringify({ review: ++review })}\n`
      await mkdir(join(root, 'design_records/reviews'), { recursive: true })
      await writeFile(join(root, 'design_records/reviews/background.json'), content)
      return git.commitExact('Background review', new Map([
        ['design_records/reviews/background.json', content],
      ]), await store.head())
    }
    await run({ root, store, git, remote, journal, conversation, project, published, publish, save, gate, recordsOnly,
      beforeSaveNative: callback => { beforeSaveNative = callback } })
  } finally { await rm(root, { recursive: true, force: true }) }
}

test('cancelling a native historical probe preserves content and must-edit authority for retry', async () => {
  await handoffFixture('must_edit', async ({ store, published, recordsOnly, save, journal, conversation, beforeSaveNative }) => {
    await recordsOnly()
    const head = await store.head(), before = await journal.read(conversation)
    const cancelled = new AbortController()
    beforeSaveNative(operation => {
      if (operation.kind === 'entry' && operation.commit === published.commit) cancelled.abort(Error('cancel historical probe'))
    })
    await assert.rejects(save('Cancelled answer', 'cancelled-answer', cancelled.signal), /cancel historical probe/)
    assert.equal(await store.head(), head)
    assert.deepEqual(await store.readPublished('sample'), { title: 'Original plan' })
    assert.deepEqual(await journal.read(conversation), before)
    beforeSaveNative(undefined)
    const saved = await save('Retried answer', 'retry-after-cancel')
    const consumed = (await journal.read(conversation)).snapshot.consumedExecutionHandoffs
    assert.equal(consumed.length, 1)
    assert.equal(consumed[0].pin.stateRevision, published.commit)
    assert.equal(consumed[0].panelStateRevision, saved.commit)
  })
})

for (const latest of ['agent', 'panel']) {
  test(`missing old ${latest} publication history does not poison native Panel saves`, async () => {
    await handoffFixture('must_edit', async ({ root, store, git, published, save, journal, conversation }) => {
      if (latest === 'panel') await save('Before recovery', 'before-recovery')
      const before = await journal.read(conversation)
      const canonical = await readFile(join(root, 'sample/sample.json'))
      // Reproduce a recovered repository whose external Journal still pins the
      // original publications. Only this disposable fixture's Git is replaced.
      await rm(join(root, '.git'), { recursive: true })
      await git.ensureRepo()
      await git.commitExact('Recovered current files', new Map([['sample/sample.json', canonical]]), await git.head())
      assert.equal(await git.blobOidAt(published.commit, 'sample/sample.json'), undefined)
      for (const [title, event] of [['After recovery', 'after-recovery'], ['Next edit', 'next-edit']]) {
        const saved = await save(title, event)
        assert.ok(saved.commit)
        assert.deepEqual(await store.readPublished('sample'), { title })
      }
      const after = await journal.read(conversation)
      assert.deepEqual(after.records.slice(0, before.records.length), before.records, 'historical facts are preserved')
      assert.deepEqual(after.snapshot.consumedExecutionHandoffs, before.snapshot.consumedExecutionHandoffs,
        'missing publication history cannot invent or release an old gate')
    })
  })
}

test('a missing earliest Panel release cannot be replaced by a later save when the agent pin survives', async () => {
  await handoffFixture('must_edit', async ({ root, store, git, remote, published, save, journal, conversation }) => {
    const consume = remote.design.consumeExecutionHandoff
    remote.design.consumeExecutionHandoff = () => { throw Error('Injected consumption failure') }
    await assert.rejects(save('Original release', 'original-release'), /Injected consumption failure/)
    remote.design.consumeExecutionHandoff = consume
    const missingPanel = await store.head()
    const canonical = await readFile(join(root, 'sample/sample.json'))
    // Keep the real agent publication, but recover onto a branch that no longer
    // contains the Journal's earliest Panel release. Prune only fixture history.
    await exec('git', ['update-ref', 'HEAD', published.commit, missingPanel], { cwd: root })
    await git.commitExact('Recovered current files', new Map([['sample/sample.json', canonical]]), published.commit)
    await exec('git', ['reflog', 'expire', '--expire=now', '--all'], { cwd: root })
    await exec('git', ['prune', '--expire=now'], { cwd: root })
    assert.ok(await git.blobOidAt(published.commit, 'sample/sample.json'))
    assert.equal(await git.blobOidAt(missingPanel, 'sample/sample.json'), undefined)
    const before = await journal.read(conversation)
    await save('After recovery', 'recovered-release')
    await save('Next edit', 'next-release')
    const after = await journal.read(conversation)
    assert.deepEqual(after.records.slice(0, before.records.length), before.records)
    assert.deepEqual(after.snapshot.consumedExecutionHandoffs, [], 'no later release can stand in for the missing first one')
    assert.deepEqual(await store.readPublished('sample'), { title: 'Next edit' })
  })
})

test('a competing publication still rejects native Panel Save without consuming must-edit', async () => {
  await handoffFixture('must_edit', async ({ store, git, save, journal, conversation, beforeSaveNative }) => {
    const before = await journal.read(conversation)
    let winner
    beforeSaveNative(async operation => {
      if (operation.kind !== 'publish') return
      beforeSaveNative(undefined)
      winner = await git.commitExact('Competing publication', new Map([['sample/sample.json', '{"title":"Competing answer"}\n']]), await git.head())
    })
    await assert.rejects(save('Losing answer', 'losing-answer'), /stale-publication/)
    assert.equal(await store.head(), winner)
    assert.deepEqual(await store.readPublished('sample'), { title: 'Competing answer' })
    assert.deepEqual(await journal.read(conversation), before)
  })
})

test('records-only HEAD advancement does not lose the first must-edit save disposition', async () => {
  await handoffFixture('must_edit', async ({ published, recordsOnly, save, journal, conversation }) => {
    await recordsOnly()
    const saved = await save('Human answer', 'human-answer')
    const consumed = (await journal.read(conversation)).snapshot.consumedExecutionHandoffs
    assert.equal(consumed.length, 1)
    assert.equal(consumed[0].invocationId, 'original-run')
    assert.equal(consumed[0].pin.stateRevision, published.commit)
    assert.equal(consumed[0].panelStateRevision, saved.commit)
    await recordsOnly()
    await save('Later answer', 'later-answer')
    assert.deepEqual((await journal.read(conversation)).snapshot.consumedExecutionHandoffs, consumed)
  })
})

test('saving a pending user-continue plan preserves its action until actual completion', async () => {
  await handoffFixture('user_continue', async ({ store, save, gate, recordsOnly, publish }) => {
    assert.equal((await gate()).invocationId, 'original-run')
    await save('Human-adjusted plan', 'plan-edit')
    await recordsOnly()
    const continued = await gate()
    assert.equal(continued?.kind, 'user_continue')
    assert.equal(continued.invocationId, 'original-run')
    assert.equal(continued.action.routeId, 'execute_plan')
    assert.equal(continued.pin.stateRevision, await store.head(), 'continuation uses the edited published content pin')
    await save('Human-adjusted plan', 'unchanged-plan-save')
    assert.equal((await gate())?.kind, 'user_continue', 'an unchanged save does not complete the workflow')
    await publish('Finished result', 'complete')
    assert.equal(await gate(), undefined, 'completed execution cannot be resurrected by old Panel facts')
    await save('Human edit after completion', 'after-completion')
    assert.equal(await gate(), undefined, 'saving completed content does not reopen the old workflow')
  })
})

test('records-only contention after a failed save settlement retains the exact earliest release', async () => {
  await handoffFixture('must_edit', async ({ store, remote, recordsOnly, save, journal, conversation, published }) => {
    const consume = remote.design.consumeExecutionHandoff
    let fail = true
    remote.design.consumeExecutionHandoff = (...args) => {
      if (fail) { fail = false; throw Error('Injected settlement failure') }
      return consume(...args)
    }
    await assert.rejects(save('Actual answer', 'retry-answer'), /Injected settlement failure/)
    const release = await store.head()
    await recordsOnly()
    assert.equal((await save('Actual answer', 'retry-answer')).commit, release)
    const consumed = (await journal.read(conversation)).snapshot.consumedExecutionHandoffs
    assert.equal(consumed.length, 1)
    assert.equal(consumed[0].pin.stateRevision, published.commit)
    assert.equal(consumed[0].panelStateRevision, release)
  })
})

test('unsettled newer execution metadata with unchanged bytes cannot consume an older gate', async () => {
  await handoffFixture('must_edit', async ({ store, save, journal, conversation }) => {
    await store.write('sample', { title: 'Original plan' }, { origin: 'agent',
      publication: { skill: 'sample', bundleVersion: '1.0', invocationId: 'new-completed-run',
        stateStatus: 'complete', handoff: 'none' }, settleEvent: async () => {},
    })
    await save('A later human answer', 'newer-execution-save')
    assert.equal((await journal.read(conversation)).snapshot.consumedExecutionHandoffs.length, 0)
  })
})

test('a real unjournaled content change cannot be attributed to an older gate', async () => {
  await handoffFixture('must_edit', async ({ store, save, journal, conversation }) => {
    await store.write('sample', { title: 'External design change' }, { origin: 'agent', settleEvent: async () => {} })
    await save('A later human answer', 'changed-evidence-save')
    assert.equal((await journal.read(conversation)).snapshot.consumedExecutionHandoffs.length, 0)
  })
})

test('user-continue reconstruction still requires the exact current published Panel bytes', async () => {
  await handoffFixture('user_continue', async ({ root, store, git, save, gate }) => {
    await save('Edited plan', 'edited-plan')
    const changedBytes = '{ "title": "Edited plan" }\n'
    await writeFile(join(root, 'sample/sample.json'), changedBytes)
    await git.commitExact('Unjournaled rewrite', new Map([['sample/sample.json', changedBytes]]), await store.head())
    assert.equal(await gate(), undefined, 'equal parsed JSON does not replace byte-pinned authority')
  })
})

test('Remote ignores empty audits, persists exact real release and repairs failed consumption retry', async () => {
  const root = await mkdtemp(join(tmpdir(), 'panel-must-edit-'))
  try {
    const git = new GitVersioning(async ({ argv, cwd, env, signal, binaryStdout }) => {
      if (binaryStdout !== undefined) return nodeDesignProjectSpawn({ argv, cwd, env, signal, binaryStdout })
      try {
        const out = await exec(argv[0], argv.slice(1), { cwd, signal, env: { ...process.env, ...env,
          GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@localhost', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@localhost' } })
        return { exitCode: 0, ...out }
      } catch (error) { return { exitCode: error.code, stdout: error.stdout ?? '', stderr: error.stderr ?? '' } }
    }, root)
    await git.ensureRepo()
    const store = new DesignFilesStore(nodeFs, git, root)
    const journal = new DesignJournalStorage(join(root, '.journal'))
    const handoffs = new DesignExecutionHandoffJournal(journal)
    const conversation = 'fixture-remote'
    const project = { projectId: '11111111-1111-4111-8111-111111111111' }
    const skill = { name: 'sample', version: '1.0', execution: { handoff: 'must_edit' }, metadata: {
      schemaYaml: 'type: object\nrequired: [title]\nproperties:\n  title:\n    type: string\n',
    } }
    const kit = { name: 'fixture', version: '1.0', skills: [skill] }
    const initial = { title: 'Initial design' }
    const published = await store.write('sample', initial, { origin: 'agent', settleEvent: event => journal.append(conversation, {
      type: 'design/changed', data: { kit: kit.name, version: kit.version, skill: skill.name,
        state: event.state, origin: 'agent', commit: event.commit,
        execution: { invocationId: 'remote-run', stateStatus: 'pending', handoff: 'must_edit' } },
    }).then(() => {}) })
    const remote = Object.create(DesignPanelRemote.prototype)
    let failConsume = false
    let inMutation = false
    const assessmentReceipts = []
    remote.design = {
      projectForAgent: async () => project,
      withSelectedDesignFilesMutation: async (_agent, _fs, _signal, operation, entered) => remote.design.withProjectMutationFor(_agent, project.projectId,
        async () => { entered?.(); return operation(project, store) }),
      withProjectMutationFor: async (_agent, _project, operation) => {
        inMutation = true
        try { return await operation() } finally { inMutation = false }
      },
      recordSettledPanelSave(_agent, receipt) {
        assert.equal(inMutation, false, 'receipt admission must be outside the completed save/gate mutation')
        assessmentReceipts.push(receipt)
      },
      requireKitForAgent: () => kit,
      designFilesForProject: async () => store,
      readDesignJournal: () => journal.read(conversation),
      assertProjectSelection() {},
      recordDesignChange: async (_agent, _project, data) => {
        await journal.append(conversation, { type: 'design/changed', data })
        return (await journal.read(conversation)).revision
      },
      consumeExecutionHandoff: async (_agent, candidate) => {
        if (failConsume) { failConsume = false; throw Error('Injected failed disposition') }
        await handoffs.consume(conversation, candidate)
      },
    }
    const agent = { session: { header: { origin: 'user' }, snapshotEvents: () => [] }, inject() {} }
    const save = (state, id) => remote.savePanel(agent, 'sample', state, [], id, new AbortController().signal)
    const consumed = async () => (await journal.read(conversation)).snapshot.consumedExecutionHandoffs
    const noop = await save(initial, 'noop-audit')
    assert.notEqual(noop.commit, published.commit)
    assert.equal((await consumed()).length, 0)
    assert.equal(assessmentReceipts.length, 1)
    assert.equal(assessmentReceipts[0].meaningful, false, 'an audit-only save cannot promise new design evidence')
    const head = await store.head()
    await assert.rejects(save({ title: 17 }, 'invalid'), /expected string/)
    assert.equal(await store.head(), head)
    failConsume = true
    await assert.rejects(save({ title: 'Actual user edit' }, 'real-edit'), /Injected failed disposition/)
    assert.equal(assessmentReceipts.length, 1, 'a committed Git write with failed gate settlement is not a successful save receipt')
    const released = await store.head()
    assert.equal((await consumed()).length, 0)
    assert.equal((await save({ title: 'Actual user edit' }, 'real-edit')).commit, released)
    assert.equal(assessmentReceipts.length, 2)
    assert.equal(assessmentReceipts[1].eventId, 'real-edit')
    assert.equal(assessmentReceipts[1].commit, released)
    assert.equal(assessmentReceipts[1].returnedCommit, released)
    assert.equal(assessmentReceipts[1].meaningful, true)
    const disposition = (await consumed())[0]
    assert.equal(disposition.pin.stateRevision, published.commit)
    assert.equal(disposition.panelStateRevision, released)
    await save({ title: 'Later user edit' }, 'later-edit')
    assert.deepEqual(await consumed(), [disposition])
    assert.equal((await new DesignJournalStorage(join(root, '.journal')).read(conversation)).snapshot.consumedExecutionHandoffs.length, 1)
  } finally { await rm(root, { recursive: true, force: true }) }
})
