/** Source Remote integration with real Files/Git/journal, not host/model E2E. */
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
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
const { DesignJournalStorage } = await import('../src/design-journal-storage.ts')
const { DesignExecutionHandoffJournal } = await import('../src/design-execution-handoff-journal.ts')
const exec = promisify(execFile)

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
