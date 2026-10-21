/** Focused DSH host-composition acceptance for project-scoped Ladybug ownership. */
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  DesignKnowledgeLeaseId,
  DesignKnowledgeProviderId,
  DesignProjectId,
  DesignProjectKnowledgeLifecycle,
  DesignProjectManager,
  GitVersioning,
  nodeDesignProjectSpawn,
} from 'dsh-design-core'
import {
  apply,
  LADYBUG_WASM_PROVIDER_ID,
} from '../lib/dsh-plugin.js'
import {
  LadybugDesignKnowledgeProvider,
  shutdownLadybugKnowledgeRuntime,
} from '../lib/index.js'

const root = await mkdtemp(join(tmpdir(), 'dsh-ladybug-host-'))
const projectRoot = resolve(root, 'project')
const project = await new DesignProjectManager().create({ root: projectRoot, name: 'host-smoke', knowledge: { provider: 'ladybug-wasm' } })
const projectId = DesignProjectId(project.metadata.id)
const stateRoot = resolve(root, 'state', 'projects', projectId)
const databaseRoot = resolve(stateRoot, 'design-knowledge')
let runtime
let effect
let unregisterCalls = 0
const ctx = {
  design: {
    async knowledgeProjectRoot(id) { assert.equal(id, projectId); return projectRoot },
    async releaseKnowledgeIndex(id) { assert.equal(id, projectId) },
    registerDesignKnowledgeRuntime(candidate) {
      runtime = candidate
      return async () => { unregisterCalls += 1 }
    },
  },
  effect(register) { effect = register() },
}

try {
  apply(ctx, { writerAttempts: 2, projectLockRetries: 0 })
  assert.equal(runtime.defaultProvider, LADYBUG_WASM_PROVIDER_ID)
  assert.equal(typeof runtime.service.query, 'function', 'consumers receive the complete neutral service')
  // Graph derivation remains available before/without a successful DB lease;
  // it must not fabricate a Knowledge provider or historical state.
  const emptyGraph = { checkpoint: 'empty', nodes: [], edges: [], semanticUnits: [], warnings: [] }
  assert.equal((await runtime.semantic.read(projectId, emptyGraph)).status.cache, 'memory')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal((await runtime.semantic.read(projectId, emptyGraph)).status.state, 'ready')
  await assert.rejects(runtime.service.revision(projectId), /not acquired/u)
  const lease = DesignKnowledgeLeaseId('session:host-smoke')
  await assert.rejects(
    runtime.administration.acquireProject({
      projectId,
      provider: DesignKnowledgeProviderId('another-provider'),
      stateRoot,
    }, lease),
    /cannot open provider/u,
  )
  let materializations = 0
  const lifecycle = new DesignProjectKnowledgeLifecycle({
    administration: runtime.administration,
    service: runtime.service,
    leaseId: lease,
    materialize: async (record, snapshot, knowledge) => {
      assert.equal(record.projectId, projectId)
      assert.equal(snapshot.checkpoint, 'a'.repeat(40))
      assert.equal(await knowledge.revision(projectId), 'rev:0')
      materializations += 1
    },
  })
  await lifecycle.restore({
    projectId,
    name: 'host-smoke',
    root: resolve(root, 'project'),
    stateRoot,
    knowledge: { provider: LADYBUG_WASM_PROVIDER_ID },
  }, { checkpoint: 'a'.repeat(40), bundleStates: {} })
  assert.equal(materializations, 1, 'selection restore materializes after opening the exact provider')
  assert.equal(await runtime.service.revision(projectId), 'rev:0')
  assert.equal((await runtime.semantic.read(projectId, emptyGraph)).status.cache, 'persistent')
  await runtime.service.applyDelta({ mutationId: 'source',
    pin: { projectId, inputCheckpoint: 'a'.repeat(40), observedCheckpoint: 'a'.repeat(40), expectedRevision: 'rev:0' },
    upsertEntities: [{ id: 'source:one', entityType: 'source', label: 'Saved source', lifecycle: 'observed', properties: {},
      provenance: { producer: 'source-analysis', checkpoint: 'a'.repeat(40), evidence: [{ source: 'design_files/source.md', revision: 'a'.repeat(40) }] } }],
    removeEntities: [], upsertRelations: [], removeRelations: [] })
  await runtime.persistProjectRecords(projectId)
  const archivePath = 'design_records/knowledge/archive.json'
  const archive = await readFile(join(projectRoot, archivePath), 'utf8')
  const git = new GitVersioning(nodeDesignProjectSpawn, projectRoot)
  assert.equal(await git.readTextAt(await git.head(), archivePath), archive)
  assert.equal(JSON.parse(archive).archive.entities[0].id, 'source:one')

  await effect()
  assert.equal(unregisterCalls, 1, 'host disposal first withdraws and drains session runtime ownership')
  await assert.rejects(runtime.service.revision(projectId), /manager is shut down/u)

  const reopened = await LadybugDesignKnowledgeProvider.open(projectId, { databaseRoot, projectLockRetries: 0 })
  assert.equal(await reopened.revision(projectId), 'rev:1', 'host disposal releases the database lock and preserves state')
  await reopened.close()
  await shutdownLadybugKnowledgeRuntime()
} finally {
  await rm(root, { recursive: true, force: true })
}

console.log('LADYBUG DSH HOST OK')
