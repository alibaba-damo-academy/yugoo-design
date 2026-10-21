import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
const { register } = await import('tsx/esm/api'); register()
const { DesignProjectManager, parseSchemaYaml } = await import('../../core/lib/index.js')
const { autoPanelSnapshot } = await import('../../core/src/auto-panel-spec.ts')
const { basicGenericManifest } = await import('../../core/src/auto-panel-generation.ts')
const { saveAutoPanelDefinition } = await import('../../core/src/saved-auto-panel-store.ts')
const { openCompanionProject } = await import('../src/project.mjs')

test('Companion opens project-owned DSL from another host and saves only authorized edits', async () => {
  const root = await mkdtemp(join(tmpdir(), 'companion-retained-'))
  const projectRoot = join(root, 'project')
  const kitRoot = fileURLToPath(new URL('../../skills-a2ui-test/', import.meta.url))
  try {
    await new DesignProjectManager().create({ root: projectRoot, name: 'Retained panel', knowledge: { provider: 'ladybug-wasm' }, kit: { name: 'a2ui_test', version: '1.0' } })
    const options = { projectRoot, kitRoot, stateRoot: join(root, 'companion-state'), connection: { threadId: '00000000-0000-4000-8000-000000000001', send: async () => ({ accepted: true }) } }
    let api = await openCompanionProject(options)
    const skill = api.kit.skills.find(item => item.name === 'probe_records')
    const state = JSON.parse(await readFile(join(kitRoot, 'skills/probe_records/reference/state-example.json'), 'utf8'))
    await api.store.write(skill.name, state, { origin: 'agent', settleEvent: async () => {} })
    const context = { kit: 'a2ui_test', kitVersion: '1.0', bundle: skill.name, bundleVersion: String(skill.version), schema: parseSchemaYaml(skill.metadata.schemaYaml), state, artifacts: {} }
    const manifest = basicGenericManifest(context)
    await saveAutoPanelDefinition(projectRoot, autoPanelSnapshot(context, [
      { version: 'v0.9', createSurface: { surfaceId: 'auto-panel', catalogId: 'urn:dsh:panel-catalog:design-files:v1', sendDataModel: false } },
      { version: 'v0.9', updateComponents: { surfaceId: 'auto-panel', components: [{ id: 'root', component: 'DesignPanel', manifest }] } },
    ]), context)
    api = await openCompanionProject(options)
    const workspace = await api.readWorkspace()
    assert.deepEqual(JSON.parse(workspace.autoPanelManifests[skill.name]), manifest)
    const definition = workspace.autoPanelDefinitions[skill.name]
    assert.equal(definition.origin, 'retained')
    const after = structuredClone(state)
    const record = Object.values(after.functions)[0]
    record.function_name = 'Companion saved value'
    const event = { skill: skill.name, state: after, eventId: 'retained-save', artifacts: { autoBefore: state, definitionRevision: definition.definitionRevision } }
    await assert.rejects(api.savePanel({ ...event, eventId: 'bad-pin', artifacts: { ...event.artifacts, definitionRevision: 'obsolete' } }), /definition changed/)
    const bytes = await readFile(join(projectRoot, 'saved-panels/probe_records.json'), 'utf8')
    const initialHead = await api.store.head()
    const initialJournal = (await api.readWorkspace()).journalRevision
    const forbidden = structuredClone(after)
    delete forbidden.functions[Object.keys(forbidden.functions)[0]]
    await assert.rejects(api.savePanel({ ...event, state: forbidden, eventId: 'forbidden-delete' }), /identities/)
    assert.deepEqual(await api.store.readPublished(skill.name), state)
    assert.equal(await api.store.head(), initialHead)
    assert.equal((await api.readWorkspace()).journalRevision, initialJournal)
    assert.equal(await readFile(join(projectRoot, 'saved-panels/probe_records.json'), 'utf8'), bytes)
    await api.savePanel(event)
    api = await openCompanionProject(options)
    const reopened = await api.readWorkspace()
    assert.deepEqual(reopened.design[skill.name].state, after)
    assert.equal(reopened.autoPanelDefinitions[skill.name].sourceChanged, true)
    assert.equal(await readFile(join(projectRoot, 'saved-panels/probe_records.json'), 'utf8'), bytes)
    const savedHead = await api.store.head()
    const staleEdit = structuredClone(after)
    Object.values(staleEdit.functions)[0].function_name = 'Stale client attempt'
    await assert.rejects(api.savePanel({ ...event, state: staleEdit, eventId: 'stale-published-before' }), /source changed/)
    assert.deepEqual(await api.store.readPublished(skill.name), after)
    assert.equal(await api.store.head(), savedHead)
    assert.equal((await api.readWorkspace()).journalRevision, reopened.journalRevision)
    const canonicalPath = join(projectRoot, 'design_files/probe_records/probe_records.json')
    const concurrent = structuredClone(after)
    Object.values(concurrent.functions)[0].function_name = 'Concurrent uncommitted edit'
    const concurrentBytes = JSON.stringify(concurrent)
    await writeFile(canonicalPath, concurrentBytes)
    const retried = await api.savePanel(event)
    assert.equal(retried.commit, savedHead)
    assert.equal(await readFile(canonicalPath, 'utf8'), concurrentBytes)
    await assert.rejects(api.savePanel({ ...event, eventId: 'fresh-same-value',
      artifacts: { autoBefore: after, definitionRevision: definition.definitionRevision } }), /source changed/)
    assert.equal(await readFile(canonicalPath, 'utf8'), concurrentBytes)
    await assert.rejects(api.savePanel({ ...event, state: staleEdit, eventId: 'stale-worktree',
      artifacts: { autoBefore: after, definitionRevision: definition.definitionRevision } }), /source changed/)
    assert.equal(await readFile(canonicalPath, 'utf8'), concurrentBytes)
    assert.equal(await api.store.head(), savedHead)
    assert.equal((await api.readWorkspace()).journalRevision, reopened.journalRevision)
    assert.equal(await readFile(join(projectRoot, 'saved-panels/probe_records.json'), 'utf8'), bytes)
    const metadataPath = join(projectRoot, 'project.json')
    await writeFile(canonicalPath, JSON.stringify(after))
    api = await openCompanionProject(options)
    await assert.rejects(api.savePanel({ ...event, state: staleEdit,
      artifacts: { autoBefore: after, definitionRevision: definition.definitionRevision } }), /reused with different bytes/)
    assert.deepEqual(await api.store.readPublished(skill.name), after)
    assert.equal(await api.store.head(), savedHead)
    assert.equal((await api.readWorkspace()).journalRevision, reopened.journalRevision)
    await api.savePanel({ ...event, state: staleEdit, eventId: 'legitimate-next-save',
      artifacts: { autoBefore: after, definitionRevision: definition.definitionRevision } })
    assert.deepEqual(await api.store.readPublished(skill.name), staleEdit)
    assert.equal((await api.readWorkspace()).journalRevision, reopened.journalRevision + 1)
    const metadata = JSON.parse(await readFile(metadataPath, 'utf8')); metadata.kit.version = 'unavailable'
    await writeFile(metadataPath, JSON.stringify(metadata))
    await assert.rejects(api.savePanel({ ...event, eventId: 'readonly' }), /unavailable/)
  } finally { await rm(root, { recursive: true, force: true }) }
})
