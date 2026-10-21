import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
const { register } = await import('tsx/esm/api'); register()
const { validatePanelManifest } = await import('../../core/src/panel-dsl.ts')
const { describePanelComponents } = await import('../../core/src/panel-component-catalog.ts')
const { autoPanelSnapshot } = await import('../../core/src/auto-panel-spec.ts')
const { exportPanelAuthoringReference } = await import('../../../.agents/skills/design-bundle-creator/scripts/inspect-panel-component.mjs')
const { queryPanelAuthoringReference } = await import('../../core/src/panel-authoring-reference.ts')
const { resolveExecutionLog } = await import('../src/execution-log.tsx')
const node = log => ({ id: 'progress', component: 'execution_log', log })
const manifest = log => ({ version: 1, panel_kind: 'evidence_workbook', sections: [], fields: [], ui: node(log) })

test('authored log selectors validate while arbitrary native identity, paths and invalid bounds fail closed', () => {
  for (const log of [{ scope: 'producer' }, { scope: 'artifact', artifact_id: 'round/A', max_entries: 1 },
    { scope: 'artifact', artifact_id_path: 'current_artifact.id', artifact_file_path: 'current_artifact.file', artifact_kind: 'direction', max_entries: 1000 }]) {
    assert.deepEqual(validatePanelManifest(manifest(log)), [])
  }
  for (const log of [undefined, [], {}, { scope: 'main' }, { scope: 'artifact' },
    { scope: 'producer', artifact_id: 'A' }, { scope: 'artifact', artifact_id: 'A', artifact_id_path: 'current' },
    { scope: 'artifact', artifact_id: '' }, { scope: 'artifact', artifact_id: 'A\nB' },
    { scope: 'artifact', artifact_id_path: '__proto__.id' }, { scope: 'artifact', artifact_id_path: 'a..id' },
    { scope: 'artifact', artifact_id: 'A', artifact_file_path: '../native.jsonl' },
    { scope: 'artifact', artifact_id: 'A', artifact_kind: 'Bad Kind' },
    ...[0, -1, 1001, 1.5, '200'].map(max_entries => ({ scope: 'producer', max_entries })),
    ...['runId', 'run_id', 'invocationId', 'transcriptPath', 'token'].map(key => ({ scope: 'producer', [key]: 'authored' }))]) {
    assert.ok(validatePanelManifest(manifest(log)).length, JSON.stringify(log))
  }
})

test('generated Panels cannot opt into runtime transcript access', () => {
  const context = { kit: 'test', kitVersion: '1', bundle: 'example', bundleVersion: '1',
    schema: { type: 'object', properties: {} }, state: {} }
  const messages = [{ version: 'v0.9', createSurface: { surfaceId: 'auto-panel', catalogId: 'urn:dsh:panel-catalog:design-files:v1', sendDataModel: false } },
    { version: 'v0.9', updateComponents: { surfaceId: 'auto-panel', components: [{ id: 'root', component: 'DesignPanel', manifest: manifest({ scope: 'producer' }) }] } }]
  assert.throws(() => autoPanelSnapshot(context, messages), /untrusted.*generated component/)
})

test('only the current owning Bundle observation can supply native identity or an exact main artifact target', () => {
  const own = { skill: 'example', role: 'producer', invocationId: 'own-invocation', attemptId: 'own-attempt', runId: 'own-run', phase: 'working', sequence: 1 }
  const foreign = { ...own, skill: 'other', runId: 'private-foreign-run', sequence: 100 }
  const options = { skill: 'example', executionAttempts: [own, foreign] }
  assert.equal(resolveExecutionLog(node({ scope: 'producer' }), {}, options).runId, own.runId)
  assert.equal(resolveExecutionLog(node({ scope: 'producer' }), {}, { executionAttempts: [own, foreign] }).runId, undefined)
  const activity = { skill: 'example', artifactId: 'round/A', artifactKind: 'direction', artifactFile: 'example/A.md',
    invocationId: 'main-invocation', runId: 'main-run', sequence: 1, executor: 'main', active: true, available: true, nativeStatus: 'running',
    logTarget: { artifactId: 'round/A', invocationId: 'main-invocation' } }
  const config = node({ scope: 'artifact', artifact_id_path: 'current.id', artifact_file_path: 'current.file', artifact_kind: 'direction' })
  const data = { current: { id: 'round/A', file: 'example/A.md' } }
  const before = structuredClone(data)
  const resolved = resolveExecutionLog(config, data, { skill: 'example', artifactActivities: [activity, { ...activity, skill: 'other', runId: 'foreign', sequence: 100 }] })
  assert.equal(resolved.runId, activity.runId)
  assert.equal(resolved.status, 'working')
  assert.deepEqual(resolved.logTarget, activity.logTarget)
  assert.equal(resolveExecutionLog(config, {}, { skill: 'example', artifactActivities: [activity] }).runId, undefined)
  assert.equal(resolveExecutionLog(config, data, { skill: 'other', artifactActivities: [activity] }).runId, undefined)
  assert.deepEqual(data, before, 'log selection never persists runtime state')
})

test('portable authoring material discovers the component and its real log configuration and dedicated documentation', async () => {
  assert.match(describePanelComponents(), /execution_log:.*Host/)
  assert.doesNotMatch(describePanelComponents(true), /execution_log:/)
  const material = JSON.parse(JSON.stringify(await exportPanelAuthoringReference(fileURLToPath(new URL('../../../', import.meta.url)))))
  const overview = queryPanelAuthoringReference(material, 'execution_log', 'contract')
  assert.equal(overview.generated, false)
  const focused = queryPanelAuthoringReference(material, 'execution_log', 'contract', 'ComponentNode.log')
  assert.match(focused.contract.declaration, /scope: 'producer' \| 'artifact'/)
  assert.match(focused.contract.declaration, /artifact_id_path/)
  const docs = queryPanelAuthoringReference(material, 'execution_log', 'docs').documentation
  assert.equal(docs.coverage, 'dedicated-component-section')
  assert.match(docs.sections[0].content, /Native run ids/)
  assert.match(docs.sections[0].content, /max_entries/)
})
