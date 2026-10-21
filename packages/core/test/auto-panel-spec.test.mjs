import test from 'node:test'
import assert from 'node:assert/strict'
import { questionSchema as schema, questionState as state, questionContext as context } from './fixtures/declarative-question.mjs'

const { register } = await import('tsx/esm/api')
register()
const { basicGenericManifest } = await import('../src/auto-panel-generation.ts')
const { autoPanelSnapshot, autoPanelStructureDigest, autoPanelManifest, validateAutoPanelSnapshot, validateAutoPanelEdit } = await import('../src/auto-panel-spec.ts')

const messages = [{ version: 'v0.9', createSurface: { surfaceId: 'auto-panel', catalogId: 'urn:dsh:panel-catalog:design-files:v1', sendDataModel: false } },
  { version: 'v0.9', updateComponents: { surfaceId: 'auto-panel', components: [{ id: 'root', component: 'DesignPanel', manifest: basicGenericManifest(context) }] } }]

test('generic snapshot is derived from current schema and Design JSON', () => {
  const snapshot = autoPanelSnapshot(context, messages)
  assert.equal(snapshot.catalogId, 'urn:dsh:panel-catalog:design-files:v1')
  assert.ok(!JSON.stringify(snapshot).includes(state.questions.purpose.answer))
  assert.equal(autoPanelManifest(snapshot, context).ui.component, 'stack')
  const next = structuredClone(state)
  next.questions.purpose.answer = '更新后的用户回答'
  assert.equal(autoPanelStructureDigest({ ...context, state: next }), snapshot.structureDigest)
  assert.throws(() => validateAutoPanelSnapshot(snapshot, { ...context, state: next }), /stale/)
})

test('old question-only catalog, arbitrary components and extra messages are rejected', () => {
  const snapshot = autoPanelSnapshot(context, messages)
  for (const change of [
    value => { value.catalogId = 'urn:dsh:panel-catalog:question-workspace:v2'; value.messages[0].createSurface.catalogId = value.catalogId },
    value => { value.messages[1].updateComponents.components[0].component = 'Script' },
    value => { value.messages.push({ version: 'v0.9', updateDataModel: { path: '/', value: state } }) },
    value => { value.messages[1].updateComponents.components[0].action = 'delete' },
  ]) {
    const invalid = structuredClone(snapshot)
    change(invalid)
    assert.throws(() => validateAutoPanelSnapshot(invalid, context), /auto panel:/)
  }
})

test('generic save protects source structure', () => {
  const manifest = autoPanelManifest(autoPanelSnapshot(context, messages), context)
  const answer = structuredClone(state)
  answer.questions.purpose.answer = '更新后的用户回答'
  validateAutoPanelEdit(state, answer, context, manifest)
  const protectedPrompt = structuredClone(answer)
  protectedPrompt.questions.purpose.prompt = '篡改问题'
  assert.throws(() => validateAutoPanelEdit(state, protectedPrompt, context, manifest), /protected field/)
  const extra = structuredClone(answer)
  extra.questions.new_question = { prompt: '新增', answer: '' }
  assert.throws(() => validateAutoPanelEdit(state, extra, context, manifest), /identities changed/)
  const changedSchema = { ...schema, required: ['schema_version', 'questions'] }
  assert.throws(() => validateAutoPanelSnapshot(autoPanelSnapshot(context, messages), { ...context, schema: changedSchema }), /stale/)
})
