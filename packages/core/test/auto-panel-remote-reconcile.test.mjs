import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { questionSchemaYaml as schemaYaml, questionState as state } from './fixtures/declarative-question.mjs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { register } = await import('tsx/esm/api')
register()
const { DesignPanelRemote } = await import('../src/panel-remote.ts')
const { AutoPanelJobs } = await import('../src/auto-panel-jobs.ts')
const { AutoPanelReconcileFence } = await import('../src/auto-panel-reconcile-fence.ts')
const { readAutoPanelCache } = await import('../src/auto-panel-cache.ts')
const { parseSchemaYaml } = await import('../src/schema.ts')
const { basicGenericManifest } = await import('../src/auto-panel-generation.ts')

const components = [{ id: 'root', component: 'DesignPanel', manifest: basicGenericManifest({ schema: parseSchemaYaml(schemaYaml), state }) }]

test('DSH Remote event reconciliation generates a validated auto Panel without a Panel read side effect', async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), 'auto-panel-remote-'))
  try {
    const project = { projectId: 'test-project', root: stateRoot, stateRoot }
    const skill = { name: 'questions_fixture', version: '0.1', metadata: { skillManifest: { presentation: { mode: 'auto' } }, schemaYaml } }
    const kit = { name: 'test_catalog', version: '0.1', skills: [skill] }
    const workspace = { projectId: project.projectId, worktreeRevision: 'worktree:r1', access: { mode: 'writable', kit: { name: kit.name, version: kit.version } }, design: { questions_fixture: { state } } }
    let modelCalls = 0
    const agent = { id: 'agent-a', options: { provider: 'mock', model: 'mock-model' }, session: { id: 'agent-a', requestHeader: () => undefined },
      ctx: { llm: { async *stream() {
        modelCalls += 1
        yield { type: 'text-delta', index: 0, text: JSON.stringify(components) }
        yield { type: 'finish', reason: { kind: 'stop' } }
      } } },
    }
    const remote = Object.create(DesignPanelRemote.prototype)
    remote.autoPanelJobs = new AutoPanelJobs()
    remote.autoPanelReconcileFence = new AutoPanelReconcileFence()
    remote.design = { selectedProjectForAgent: async () => project, requireKitForAgent: () => kit }
    remote.readWorkspace = async () => workspace
    const owner = remote.autoPanelReconcileFence.event(agent.id, 1, true)
    await remote.reconcileAutoPanels(agent, 1, owner)
    for (let i = 0; i < 50 && remote.autoPanelJobs.status('test-project:questions_fixture')?.phase !== 'ready'; i += 1) {
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    assert.equal(remote.autoPanelJobs.status('test-project:questions_fixture')?.phase, 'ready')
    assert.equal(modelCalls, 1)
    const cached = await readAutoPanelCache(stateRoot, { kit: kit.name, kitVersion: kit.version, bundle: skill.name, bundleVersion: skill.version,
      schema: parseSchemaYaml(schemaYaml), state })
    assert.equal(cached.status, 'ready')
    remote.autoPanelJobs.dispose()
    remote.autoPanelReconcileFence.dispose()
  } finally { await rm(stateRoot, { recursive: true, force: true }) }
})
