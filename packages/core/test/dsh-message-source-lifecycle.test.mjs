/** Real isolated registry/binding/Kit checkpoints; injected Host failures stay distinct. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import DesignService from '../src/design-service.ts'
import { nodeDesignProjectSpawn } from '../src/design-project.ts'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'yugoo-source-lifecycle-'))
  const previousGitBackend = process.env.YUGOO_GIT_BACKEND
  // Exercise actual Git persistence without requiring the built worker for this source test.
  process.env.YUGOO_GIT_BACKEND = 'cli'
  const ctx = new Context()
  t.after(async () => {
    await ctx.fiber.dispose()
    if (previousGitBackend === undefined) delete process.env.YUGOO_GIT_BACKEND
    else process.env.YUGOO_GIT_BACKEND = previousGitBackend
    await rm(root, { recursive: true, force: true })
  })
  ctx.provide('systemPrompt', { section() {}, context() {} })
  ctx.provide('tools', { register() {} })
  ctx.provide('subprocess', {})
  const service = new DesignService(ctx, {
    projectsRoot: join(root, 'projects'), stateRoot: join(root, 'runtime'), hostInstanceId: 'isolated',
  })
  const kit = { name: 'fixture', version: '1.0', mindset: 'Preserve saved facts.', skills: [], resources: {} }
  let rejectNotice = false
  Object.assign(service, {
    spawnAdapter: () => nodeDesignProjectSpawn,
    requireKnowledgeRuntime: () => ({ defaultProvider: 'fixture' }), advisoryRuntimeStatus: () => undefined,
    knowledgeLifecycleFor: () => ({ prepare: async () => ({ finalize: async () => ({}), abort: async () => {} }) }),
    notifyWorkspaceChange() { if (rejectNotice) throw new Error('simulated Host notification failure') },
  })
  service.registerRetainedKit(kit)
  const agent = { id: 'original-session', session: { header: {} } }
  return { service, agent, signal: new AbortController().signal, reject() { rejectNotice = true }, allow() { rejectNotice = false } }
}

test('a failed post-create Host notification does not erase the already created project or binding', async t => {
  const f = await fixture(t)
  f.reject()
  const result = await f.service.executeProjectCommand(f.agent, 'new saved-project', f.signal)
  assert.equal(result.kind, 'error')
  assert.match(result.text, /Host notification failure/)
  const projects = await f.service.projects.listRecent()
  assert.equal(projects.length, 1)
  const project = projects[0], before = await f.service.projects.status(project.projectId)
  assert.equal((await f.service.currentSelection(f.agent)).projectId, project.projectId)
  f.allow()
  const reopened = await f.service.executeProjectCommand(f.agent, 'open ' + project.projectId, f.signal)
  assert.equal(reopened.kind, 'success')
  assert.equal((await f.service.projects.listRecent()).length, 1, 'recover the saved project instead of recreating it')
  assert.equal((await f.service.projects.status(project.projectId)).lastCheckpoint, before.lastCheckpoint)
})

test('mindset failure after notification preserves the committed Kit pin and Journal fact', async t => {
  const f = await fixture(t)
  await f.service.executeProjectCommand(f.agent, 'new saved-project', f.signal)
  const selection = await f.service.currentSelection(f.agent)
  const before = await f.service.projects.status(selection.projectId)
  f.reject()
  await assert.rejects(f.service.selectProjectMindset(f.agent, 'fixture', f.signal), /Host notification failure/)
  const after = await f.service.projects.status(selection.projectId)
  assert.deepEqual(after.kit, { name: 'fixture', version: '1.0' })
  assert.notEqual(after.lastCheckpoint, before.lastCheckpoint)
  assert.equal(after.gitClean, true)
  const journal = await f.service.journals.read(after.root, String(after.projectId))
  assert.equal(journal.snapshot.latestKitSelection.kit, 'fixture')
  assert.equal(journal.snapshot.latestKitSelection.version, '1.0')
  assert.equal((await f.service.currentSelection(f.agent)).projectId, selection.projectId)
  assert.equal((await f.service.projects.listRecent()).length, 1)
})
