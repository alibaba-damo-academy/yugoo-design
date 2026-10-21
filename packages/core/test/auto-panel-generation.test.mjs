import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { questionState as state, questionContext as context } from './fixtures/declarative-question.mjs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { register } = await import('tsx/esm/api')
register()
const { generateAutoPanel, autoPanelGenerationPrompt, basicGenericManifest } = await import('../src/auto-panel-generation.ts')
const { readAutoPanelCache } = await import('../src/auto-panel-cache.ts')
const components = [{ id: 'root', component: 'DesignPanel', manifest: basicGenericManifest(context) }]

test('prompt supplies schema, saved facts and a generic layout baseline', () => {
  const prompt = autoPanelGenerationPrompt(context)
  assert.match(prompt, /DesignPanel/)
  assert.ok(prompt.includes(state.questions.purpose.answer))
  assert.match(prompt, /required root fields are version:1, panel_kind:"document", sections:\[\], fields:\[\], and ui:/)
  assert.match(prompt, /use question_workspace bound to that source/)
  assert.match(prompt, /Declare only answer and detail as editor fields/)
  assert.match(prompt, /Object arrays such as choices are not string-list editor fields/)
  const baseline = JSON.parse(prompt.split('Complete valid output baseline to improve (retain all bindings and the outer wrapper): ')[1])
  assert.deepEqual(baseline, components)
  assert.deepEqual(baseline[0].manifest.fields.filter(field => field.applies_to.includes('questions')).map(field => field.key), ['answer', 'detail'])
})

test('rejected output diagnostics contain only bounded fixed field shapes, not model keys or values', async () => {
  const root = await mkdtemp(join(tmpdir(), 'auto-panel-shape-'))
  try {
    const secret = 'MODEL_TEXT_MUST_NOT_ENTER_SHAPE'
    const candidate = [{ id: 'root', component: 'DesignPanel', manifest: { arbitrary_secret_key: secret } }]
    const result = await generateAutoPanel({ context, stateRoot: root, signal: new AbortController().signal,
      currentContext: async () => context, port: { generate: async () => candidate } })
    assert.equal(result.status, 'published')
    assert.equal(result.attempts, 2)
    const shape = JSON.parse(result.fallbackReason.split('; Candidate shape: ')[1])
    assert.equal(shape.componentCount, 1)
    assert.deepEqual(shape.manifest.version, { present: false, type: 'missing' })
    assert.deepEqual(shape.root.manifest, { present: true, type: 'object' })
    assert.ok(!JSON.stringify(shape).includes(secret))
    assert.ok(!JSON.stringify(shape).includes('arbitrary_secret_key'))
    assert.ok(JSON.stringify(shape).length < 600)
    assert.deepEqual(Object.keys(shape.manifest), ['version', 'panel_kind', 'sections', 'fields', 'ui'])
    const many = await generateAutoPanel({ context, stateRoot: root, signal: new AbortController().signal,
      currentContext: async () => context, port: { generate: async () => Array(1001).fill(candidate[0]) } })
    const capped = JSON.parse(many.fallbackReason.split('; Candidate shape: ')[1])
    assert.equal(capped.componentCount, 1000)
    assert.ok(JSON.stringify(capped).length < 600)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('bounded repair publishes validated layout under the project state root', async () => {
  const root = await mkdtemp(join(tmpdir(), 'auto-panel-generation-'))
  try {
    let count = 0
    const result = await generateAutoPanel({ context, stateRoot: root, signal: new AbortController().signal,
      currentContext: async () => context,
      // A model-supplied surface declaration is not trusted; the repair must
      // return components while the server constructs the fixed A2UI envelope.
      port: { generate: async () => ++count === 1
        ? [{ version: 'v0.9', createSurface: { surfaceId: 'auto-panel' } }]
        : components },
    })
    assert.equal(result.status, 'published')
    assert.equal(result.attempts, 2)
    const cache = await readAutoPanelCache(root, context)
    assert.equal(cache.status, 'ready')
    assert.deepEqual(cache.snapshot.messages[0], { version: 'v0.9', createSurface: {
      surfaceId: 'auto-panel', catalogId: 'urn:dsh:panel-catalog:design-files:v1', sendDataModel: false,
    } })
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('generation does not publish stale source; invalid model output gets a safe generic UI', async () => {
  const root = await mkdtemp(join(tmpdir(), 'auto-panel-generation-'))
  try {
    const changed = structuredClone(state)
    changed.questions.extra = { prompt: '新增？', answer: '' }
    const stale = await generateAutoPanel({ context, stateRoot: root, signal: new AbortController().signal,
      currentContext: async () => ({ ...context, state: changed }), port: { generate: async () => components },
    })
    assert.equal(stale.status, 'stale')
    const answerChanged = structuredClone(state)
    answerChanged.questions.purpose.answer = '新答案'
    const staleCopy = await generateAutoPanel({ context, stateRoot: root, signal: new AbortController().signal,
      currentContext: async () => ({ ...context, state: answerChanged }), port: { generate: async () => components },
    })
    assert.equal(staleCopy.status, 'stale')
    const invalid = await generateAutoPanel({ context, stateRoot: root, signal: new AbortController().signal,
      currentContext: async () => context, port: { generate: async () => [{ bad: true }] },
    })
    assert.equal(invalid.status, 'published')
    assert.equal(invalid.attempts, 2)
    assert.match(invalid.fallbackReason, /expected one DesignPanel component/)
    const cache = await readAutoPanelCache(root, context)
    assert.equal(cache.status, 'ready')
    assert.equal(cache.snapshot.messages[1].updateComponents.components[0].component, 'DesignPanel')
  } finally { await rm(root, { recursive: true, force: true }) }
})
