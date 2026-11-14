import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { questionSchema as schema, questionState as state, questionContext as context } from './fixtures/declarative-question.mjs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { register } = await import('tsx/esm/api')
register()
const { readAutoPanelCache, publishAutoPanelCache, assertAutoPanelSave } = await import('../src/auto-panel-cache.ts')
const { basicGenericManifest } = await import('../src/auto-panel-generation.ts')
const messages = [
  { version: 'v0.9', createSurface: { surfaceId: 'auto-panel', catalogId: 'urn:dsh:panel-catalog:design-files:v1', sendDataModel: false } },
  { version: 'v0.9', updateComponents: { surfaceId: 'auto-panel', components: [{ id: 'root', component: 'DesignPanel', manifest: basicGenericManifest(context) }] } },
]

test('derived cache persists and invalidates on value or structural changes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'auto-panel-cache-'))
  try {
    assert.deepEqual(await readAutoPanelCache(root, context), { status: 'missing' })
    await publishAutoPanelCache(root, context, messages)
    assert.equal((await readAutoPanelCache(root, context)).status, 'ready')
    const answerOnly = structuredClone(state)
    answerOnly.questions.purpose.answer = '新答案'
    assert.equal((await readAutoPanelCache(root, { ...context, state: answerOnly })).status, 'stale')
    const changed = structuredClone(answerOnly)
    changed.questions.extra = { prompt: '新增？', answer: '' }
    assert.equal((await readAutoPanelCache(root, { ...context, state: changed })).status, 'stale')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('cache rejects path traversal and invalid generated components', async () => {
  const root = await mkdtemp(join(tmpdir(), 'auto-panel-cache-'))
  try {
    await assert.rejects(publishAutoPanelCache(root, { ...context, bundle: '../escape' }, messages), /invalid Bundle id/)
    const invalid = structuredClone(messages)
    invalid[1].updateComponents.components[0].component = 'Script'
    await assert.rejects(publishAutoPanelCache(root, context, invalid), /expected one DesignPanel component/)
    assert.deepEqual(await readAutoPanelCache(root, context), { status: 'missing' })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('auto save requires an exact current source and a validated live cache', async () => {
  const root = await mkdtemp(join(tmpdir(), 'auto-panel-save-'))
  const after = structuredClone(state)
  after.questions.purpose.answer = '新的决策目标'
  const request = { stateRoot: root, context, before: state, visibleState: state, after }
  try {
    await assert.rejects(assertAutoPanelSave(request), /missing or stale/)
    await publishAutoPanelCache(root, context, messages)
    await assert.doesNotReject(assertAutoPanelSave(request))
    await assert.rejects(assertAutoPanelSave({ ...request, before: after }), /changed since/)
    await assert.rejects(assertAutoPanelSave({ ...request, visibleState: after }), /uncommitted/)
    const protectedEdit = structuredClone(after)
    protectedEdit.questions.purpose.prompt = '被篡改'
    await assert.rejects(assertAutoPanelSave({ ...request, after: protectedEdit }), /protected field/)
    await assert.rejects(assertAutoPanelSave({ ...request, context: { ...context, state: after }, before: after, visibleState: after }), /missing or stale/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('an existing 501-record collection can save an authorized answer while source and field checks remain active', async () => {
  const root = await mkdtemp(join(tmpdir(), 'auto-panel-many-records-'))
  const questions = Object.fromEntries(Array.from({ length: 501 }, (_, index) =>
    [`question-${index}`, { prompt: `Question ${index}`, answer: '', detail: '' }]))
  const current = { ...state, questions, question_order: Object.keys(questions) }
  const largeContext = { ...context, state: current }
  const largeMessages = structuredClone(messages)
  largeMessages[1].updateComponents.components[0].manifest = basicGenericManifest(largeContext)
  const after = structuredClone(current)
  after.questions['question-500'].answer = 'A saved answer beyond the former collection limit.'
  const request = { stateRoot: root, context: largeContext, before: current, visibleState: current, after }
  try {
    await publishAutoPanelCache(root, largeContext, largeMessages)
    await assert.doesNotReject(assertAutoPanelSave(request))
    assert.equal(current.questions['question-500'].answer, '', 'validation must not mutate the source')
    assert.equal(Object.keys(after.questions).length, 501)

    const protectedEdit = structuredClone(after)
    protectedEdit.questions['question-500'].prompt = 'Unrequested question rewrite'
    await assert.rejects(assertAutoPanelSave({ ...request, after: protectedEdit }), /protected field/)
    const invalidAnswer = structuredClone(after)
    invalidAnswer.questions['question-500'].answer = 42
    await assert.rejects(assertAutoPanelSave({ ...request, after: invalidAnswer }), /schema-invalid edit/)
    const missingRecord = structuredClone(after)
    delete missingRecord.questions['question-500']
    await assert.rejects(assertAutoPanelSave({ ...request, after: missingRecord }), /identities changed/)
    await assert.rejects(assertAutoPanelSave({ ...request, before: after }), /changed since/)
    await assert.rejects(assertAutoPanelSave({ ...request, visibleState: after }), /uncommitted/)

    const changedBinding = structuredClone(largeMessages)
    changedBinding[1].updateComponents.components[0].manifest.sections[0].records_path = 'unowned'
    await assert.rejects(publishAutoPanelCache(root, largeContext, changedBinding), /not a source record map/)
    assert.equal((await readAutoPanelCache(root, largeContext)).status, 'ready', 'a rejected binding must leave the valid cache intact')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
