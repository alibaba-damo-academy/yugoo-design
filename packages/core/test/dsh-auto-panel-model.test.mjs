import assert from 'node:assert/strict'
import { test } from 'node:test'
import { dshAutoPanelGenerationPort } from '../src/dsh-auto-panel-model.ts'

function agentFor(chunks) {
  const calls = []
  const agent = {
    options: { provider: 'mock', model: 'mock-model' },
    session: { id: 's1', requestHeader: () => undefined },
    ctx: { llm: { async *stream(options) { calls.push(options); yield* chunks } } },
  }
  return { agent, calls }
}

test('DSH adapter returns only parsed JSON and uses the effective route without conversation history', async () => {
  const { agent, calls } = agentFor([
    { type: 'reasoning-delta', index: 0, text: 'thinking' },
    { type: 'text-delta', index: 1, text: '[{"version":"v0.9"}]' },
    { type: 'finish', reason: { kind: 'stop' } },
  ])
  const output = await dshAutoPanelGenerationPort(agent).generate({ prompt: 'layout only', signal: new AbortController().signal })
  assert.deepEqual(output, [{ version: 'v0.9' }])
  assert.equal(calls.length, 1)
  assert.equal(calls[0].provider, 'mock')
  assert.equal(calls[0].messages.length, 1)
  assert.deepEqual(calls[0].messages[0].source, { kind: 'yugoo-design' })
  assert.equal(calls[0].tools, undefined)
})

test('DSH adapter rejects incomplete or non-JSON model output', async () => {
  const broken = agentFor([{ type: 'text-delta', index: 0, text: '{}'}, { type: 'finish', reason: { kind: 'max-tokens' } }])
  await assert.rejects(dshAutoPanelGenerationPort(broken.agent).generate({ prompt: 'x', signal: new AbortController().signal }), /did not finish normally/)
  const invalid = agentFor([{ type: 'text-delta', index: 0, text: 'not json'}, { type: 'finish', reason: { kind: 'stop' } }])
  await assert.rejects(dshAutoPanelGenerationPort(invalid.agent).generate({ prompt: 'x', signal: new AbortController().signal }), SyntaxError)
})
