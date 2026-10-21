import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { questionSchemaYaml as schemaYaml, questionState as initial } from './fixtures/declarative-question.mjs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const { register } = await import('tsx/esm/api')
register()
const { DesignPanelRemote } = await import('../src/panel-remote.ts')
const { DesignFilesStore } = await import('../src/design-files.ts')
const { GitVersioning } = await import('../src/git.ts')
const { nodeDesignProjectSpawn } = await import('../src/design-project.ts')
const { nodeFs } = await import('../src/service-tools.ts')
const { publishAutoPanelCache } = await import('../src/auto-panel-cache.ts')
const { parseSchemaYaml } = await import('../src/schema.ts')
const { basicGenericManifest } = await import('../src/auto-panel-generation.ts')
const { resolveAutoPanel } = await import('../src/auto-panel-resolution.ts')

const exec = promisify(execFile)
const messages = [
  { version: 'v0.9', createSurface: { surfaceId: 'auto-panel', catalogId: 'urn:dsh:panel-catalog:design-files:v1', sendDataModel: false } },
  { version: 'v0.9', updateComponents: { surfaceId: 'auto-panel', components: [{ id: 'root', component: 'DesignPanel', manifest: basicGenericManifest({ schema: parseSchemaYaml(schemaYaml), state: initial }) }] } },
]

test('DSH Remote generated Panel save commits only authorized question answers', async () => {
  const root = await mkdtemp(join(tmpdir(), 'auto-panel-remote-save-'))
  try {
    const git = new GitVersioning(async ({ argv, cwd, env, signal, binaryStdout }) => {
      if (binaryStdout !== undefined) return nodeDesignProjectSpawn({ argv, cwd, env, signal, binaryStdout })
      try {
        const result = await exec(argv[0], argv.slice(1), { cwd, signal, env: { ...process.env, ...env,
          GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@localhost', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@localhost' } })
        return { exitCode: 0, ...result }
      } catch (error) { return { exitCode: error.code, stdout: error.stdout ?? '', stderr: error.stderr ?? '' } }
    }, root)
    await git.ensureRepo()
    const store = new DesignFilesStore(nodeFs, git, root)
    await store.write('questions_fixture', initial, { origin: 'agent', settleEvent: async () => {} })
    const project = { projectId: 'test-project', root, stateRoot: join(root, '.derived') }
    const skill = { name: 'questions_fixture', version: '0.1', execution: { handoff: 'can_edit' }, metadata: {
      skillManifest: { presentation: { mode: 'auto' } }, schemaYaml,
    } }
    const kit = { name: 'test_catalog', version: '0.1', skills: [skill] }
    await publishAutoPanelCache(project.stateRoot, { kit: kit.name, kitVersion: kit.version, bundle: skill.name,
      bundleVersion: skill.version, schema: parseSchemaYaml(schemaYaml), state: initial }, messages)
    const notices = []
    const agent = { id: 'agent-a', session: { header: { origin: 'user' }, snapshotEvents: () => [] }, inject: message => notices.push(message) }
    const changes = []
    let journalRevision = 0
    const remote = Object.create(DesignPanelRemote.prototype)
    remote.design = {
      projectForAgent: async () => project,
      withSelectedDesignFilesMutation: async (_agent, _fs, _signal, operation, entered) => { entered?.(); return operation(project, store) },
      withProjectMutationFor: async (_agent, _project, operation) => operation(),
      requireKitForAgent: () => kit,
      designFilesForProject: async () => store,
      readDesignJournal: async () => ({ revision: journalRevision, records: [] }),
      assertProjectSelection() {},
      recordDesignChange: async (_agent, _project, change) => {
        const previous = changes.find(entry => entry.change.commit === change.commit)
        if (previous) return previous.revision
        const revision = ++journalRevision
        changes.push({ revision, change })
        return revision
      },
    }
    remote.readWorkspace = async () => ({ projectId: project.projectId, design: { questions_fixture: { state: initial } } })
    const edited = structuredClone(initial)
    edited.questions.future.answer = '先只验证两个班次'
    const staleBefore = structuredClone(initial)
    staleBefore.questions.future.answer = '已过期答案'
    await assert.rejects(remote.savePanel(agent, 'questions_fixture', edited, { autoBefore: staleBefore }, 'auto-save-stale', new AbortController().signal),
      /changed since the panel was opened/)
    const conflictedVisible = structuredClone(initial)
    conflictedVisible.questions.future.answer = '未提交修改'
    remote.readWorkspace = async () => ({ projectId: project.projectId, design: { questions_fixture: { state: conflictedVisible } } })
    await assert.rejects(remote.savePanel(agent, 'questions_fixture', edited, { autoBefore: initial }, 'auto-save-conflict', new AbortController().signal),
      /uncommitted Design File changes/)
    remote.readWorkspace = async () => ({ projectId: project.projectId, design: { questions_fixture: { state: initial } } })
    await assert.rejects(remote.savePanel(agent, 'questions_fixture', edited, { autoBefore: initial, artifacts: [] }, 'auto-save-artifacts', new AbortController().signal),
      /original Design File state is required/)
    const withAttachment = structuredClone(initial)
    withAttachment.questions.future.multimodal_answer = [{ filename: 'secret.txt', file_md5: 'a'.repeat(32) }]
    await assert.rejects(remote.savePanel(agent, 'questions_fixture', withAttachment, { autoBefore: initial }, 'auto-save-attachment', new AbortController().signal),
      /auto panel:/)
    const tampered = structuredClone(initial)
    tampered.questions.future.prompt = '恶意改题'
    await assert.rejects(remote.savePanel(agent, 'questions_fixture', tampered, { autoBefore: initial }, 'auto-save-denied', new AbortController().signal),
      /auto panel:/)
    const result = await remote.savePanel(agent, 'questions_fixture', edited, { autoBefore: initial }, 'auto-save-1', new AbortController().signal)
    assert.match(result.commit, /^[0-9a-f]{40}$/)
    assert.deepEqual(await store.readPublished('questions_fixture'), edited)
    assert.equal(changes.length, 1)
    assert.equal(notices.length, 1)
    assert.equal(notices[0].source.kind, 'yugoo-design')
    assert.equal(notices[0].source.form, 'notice')
    const replay = await remote.savePanel(agent, 'questions_fixture', edited, { autoBefore: initial }, 'auto-save-1', new AbortController().signal)
    assert.equal(replay.commit, result.commit)
    assert.equal(await store.head(), result.commit)
    assert.equal(changes.length, 1, 'audit replay must not duplicate an already settled Journal fact')
    assert.equal(notices.length, 1, 'audit replay must not re-inject an already delivered notice')

    const concurrentPath = join(root, 'questions_fixture/questions_fixture.json')
    const concurrent = structuredClone(edited)
    concurrent.questions.future.answer = 'Concurrent worktree answer must survive'
    const concurrentBytes = JSON.stringify(concurrent)
    await writeFile(concurrentPath, concurrentBytes)
    remote.readWorkspace = async () => ({ projectId: project.projectId, design: { questions_fixture: { state: concurrent } } })
    const headBeforeConflict = await store.head()
    const actualRetry = await remote.savePanel(agent, skill.name, edited, { autoBefore: initial }, 'auto-save-1', new AbortController().signal)
    assert.equal(actualRetry.commit, result.commit)
    assert.equal(await readFile(concurrentPath, 'utf8'), concurrentBytes)
    await assert.rejects(remote.savePanel(agent, skill.name, edited, { autoBefore: edited }, 'brand-new-same-value', new AbortController().signal), /source changed|uncommitted Design File changes/)
    assert.equal(await readFile(concurrentPath, 'utf8'), concurrentBytes)
    assert.equal(await store.head(), headBeforeConflict)
    assert.equal(changes.length, 1)
    assert.equal(notices.length, 1)
    await writeFile(concurrentPath, JSON.stringify(edited))

    // Retain the generated layout for a non-Web App Bundle, then save through
    // the same production Remote after the source changes and cache goes stale.
    const currentContext = { kit: kit.name, kitVersion: kit.version, bundle: skill.name,
      bundleVersion: skill.version, schema: parseSchemaYaml(schemaYaml), state: edited }
    await publishAutoPanelCache(project.stateRoot, currentContext, messages)
    let sourceRevision = 'visible-1'
    let accessMode = 'writable'
    remote.readWorkspace = async () => ({ projectId: project.projectId, worktreeRevision: sourceRevision,
      access: { mode: accessMode }, design: { questions_fixture: { state: await store.readPublished('questions_fixture') } } })
    const roots = { definitionRoot: project.root, cacheRoot: project.stateRoot }
    const generated = await resolveAutoPanel(roots, currentContext)
    const request = { projectId: project.projectId, skill: skill.name, sourceRevision,
      definitionRevision: generated.definitionRevision }
    await assert.rejects(remote.retainAutoPanel(agent, { ...request, projectId: 'foreign' }, new AbortController().signal), /project changed/)
    await assert.rejects(remote.retainAutoPanel(agent, { ...request, sourceRevision: 'old' }, new AbortController().signal), /source changed/)
    await assert.rejects(remote.retainAutoPanel(agent, { ...request, definitionRevision: 'old' }, new AbortController().signal), /definition changed/)
    accessMode = 'recovery'
    await assert.rejects(remote.retainAutoPanel(agent, request, new AbortController().signal), /read-only/)
    assert.equal((await resolveAutoPanel(roots, currentContext)).origin, 'generated', 'read-only retention must not write a definition')
    accessMode = 'writable'
    assert.deepEqual(await remote.retainAutoPanel(agent, request, new AbortController().signal), { retained: true })
    assert.equal(await store.head(), result.commit, 'retaining layout must not modify Design Files or Git head')
    const retainedPath = join(project.root, 'saved-panels', 'questions_fixture.json')
    const retainedBytes = await readFile(retainedPath, 'utf8')
    const retained = await resolveAutoPanel(roots, currentContext)
    assert.equal(retained.origin, 'retained')
    const next = structuredClone(edited); next.questions.future.answer = '保留布局后继续修改答案'
    await assert.rejects(remote.savePanel(agent, skill.name, next, { autoBefore: edited }, 'retained-unpinned', new AbortController().signal), /revision is required/)
    await assert.rejects(remote.savePanel(agent, skill.name, next, { autoBefore: edited, definitionRevision: 'old' }, 'retained-stale', new AbortController().signal), /definition changed/)
    const invalid = structuredClone(next); invalid.questions.future.prompt = '不应修改问题'
    await assert.rejects(remote.savePanel(agent, skill.name, invalid, { autoBefore: edited, definitionRevision: retained.definitionRevision }, 'retained-denied', new AbortController().signal), /protected/)
    await remote.savePanel(agent, skill.name, next, { autoBefore: edited, definitionRevision: retained.definitionRevision }, 'retained-save', new AbortController().signal)
    assert.deepEqual(await store.readPublished(skill.name), next)
    sourceRevision = 'visible-2'
    const reopened = await resolveAutoPanel(roots, { ...currentContext, state: next })
    assert.equal(reopened.origin, 'retained')
    assert.equal(reopened.sourceChanged, true)
    assert.equal(await readFile(retainedPath, 'utf8'), retainedBytes, 'data save must not regenerate the retained layout')
  } finally { await rm(root, { recursive: true, force: true }) }
})
