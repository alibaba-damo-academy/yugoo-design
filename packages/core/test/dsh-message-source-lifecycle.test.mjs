/** Real isolated registry/binding/Kit checkpoints; injected Host failures stay distinct. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { AsyncLocalStorage } from 'node:async_hooks'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import DesignService from '../src/design-service.ts'
import { DesignProjectRegistry } from '../src/design-project-registry.ts'
import { ConversationDesignBindingStore } from '../src/conversation-design-binding-store.ts'
import { DesignJournalRegistry } from '../src/design-journal-registry.ts'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'yugoo-source-lifecycle-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const service = Object.create(DesignService.prototype)
  const kit = { name: 'fixture', version: '1.0', mindset: 'Preserve saved facts.', skills: [], resources: {} }
  let rejectNotice = false
  Object.assign(service, {
    projects: new DesignProjectRegistry({ projectsRoot: join(root, 'projects'), stateRoot: join(root, 'runtime') }),
    bindings: new ConversationDesignBindingStore({ root: join(root, 'bindings') }),
    journals: new DesignJournalRegistry(state => join(state, 'journal')), hostInstanceId: 'isolated',
    activeWorkspaces: new WeakMap(), contentRecoveryLocations: new WeakMap(),
    workspaceContentEpochs: new WeakMap(), projectContentEpochs: new Map(),
    selectedAgents: new Set(), selectedAgentRefs: new WeakMap(), conversationMutations: new WeakMap(),
    projectMutations: new Map(), projectMutationScope: new AsyncLocalStorage(),
    kits: new Map(), retainedKits: new Map([['fixture', new Map([['1.0', kit]])]]),
    contributions: { assertKit() {} },
    requireKnowledgeRuntime: () => ({ defaultProvider: 'fixture' }), advisoryRuntimeStatus: () => undefined,
    knowledgeLifecycleFor: () => ({ prepare: async () => ({ finalize: async () => ({}), abort: async () => {} }) }),
    notifyWorkspaceChange() { if (rejectNotice) throw new Error('simulated Host notification failure') },
  })
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
  const journal = await f.service.journals.read(after.stateRoot, String(f.agent.id))
  assert.equal(journal.snapshot.latestKitSelection.kit, 'fixture')
  assert.equal(journal.snapshot.latestKitSelection.version, '1.0')
  assert.equal((await f.service.currentSelection(f.agent)).projectId, selection.projectId)
  assert.equal((await f.service.projects.listRecent()).length, 1)
})
