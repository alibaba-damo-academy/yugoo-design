import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { panelComposerFocus } from '../src/client/session-controller-adapter.ts'

async function hostWithConsumer() {
  const root = new Context()
  let consumer
  await root.plugin(scope => { consumer = scope })
  return { root, consumer }
}

test('Adjust reads an optional native service from an actual non-injected Cordis consumer', async () => {
  const { root, consumer } = await hostWithConsumer()
  try {
    const sessionScope = { session: 'current' }
    const draft = { text: 'Keep this unsent draft', caret: 5, references: ['request'] }
    const before = structuredClone(draft)
    let focused = 0
    const sessions = { binding: id => id === 'current' ? { ctx: sessionScope } : undefined }
    await root.plugin(scope => {
      scope.provide('conversation', { input: { for(actual) {
        assert.equal(actual, sessionScope, 'focus uses the retained Session scope')
        return { focus() { focused++ } }
      } } })
    })
    assert.throws(() => consumer.conversation?.input, /without inject/u,
      'the previous optional property read reproduces the native slot crash')
    const adjust = panelComposerFocus(sessions, consumer, 'current')
    assert.equal(typeof adjust, 'function')
    assert.equal(focused, 0, 'resolving the action does not move focus')
    adjust()
    assert.equal(focused, 1)
    assert.deepEqual(draft, before, 'the adapter never submits or rewrites input')
  } finally { await root.fiber.dispose() }
})

test('optional capability reads reflect absent, late, withdrawn and replaced providers', async () => {
  const { root, consumer } = await hostWithConsumer()
  try {
    const sessions = { binding: () => ({ ctx: {} }) }
    const read = () => panelComposerFocus(sessions, consumer, 'current')
    assert.equal(read(), undefined)
    let focused = 0
    const first = root.plugin(scope => {
      scope.provide('conversation', { input: { for: () => ({ focus() { focused++ } }) } })
    })
    await first
    assert.equal(typeof read(), 'function')
    read()()
    assert.equal(focused, 1)
    await first.dispose()
    assert.equal(read(), undefined, 'an inactive provider is not retained by the Panel')
    await root.plugin(scope => {
      scope.provide('conversation', { input: { for: () => ({ focus() { focused += 10 } }) } })
    })
    read()()
    assert.equal(focused, 11, 'the next render resolves the replacement service')
  } finally { await root.fiber.dispose() }
})

test('Adjust is absent without native input or a retained Session scope', async () => {
  const { root, consumer } = await hostWithConsumer()
  try {
    const sessions = { binding: id => id === 'without-scope' ? {} : undefined }
    const withoutInput = root.plugin(scope => { scope.provide('conversation', {}) })
    await withoutInput
    assert.equal(panelComposerFocus(sessions, consumer, 'missing'), undefined)
    await withoutInput.dispose()
    await root.plugin(scope => {
      scope.provide('conversation', { input: { for() { assert.fail('no unrelated input may be focused') } } })
    })
    assert.equal(panelComposerFocus(sessions, consumer, 'missing'), undefined)
    assert.equal(panelComposerFocus(sessions, consumer, 'without-scope'), undefined)
  } finally { await root.fiber.dispose() }
})
