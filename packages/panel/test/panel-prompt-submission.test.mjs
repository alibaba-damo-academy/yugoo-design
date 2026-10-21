import assert from 'node:assert/strict'
import test from 'node:test'
import { submitDesignPanelPrompt } from '../src/client/panel-prompt-submission.ts'

test('Host echo precedes the pending queue RPC and one real request id is preserved', async () => {
  const calls = []
  let settle
  const session = {
    getSnapshot() { return { subagent: null } },
    beginSubmission(input) { calls.push(['echo', input]); return { requestId: 'host-minted', abandon() { calls.push(['abandon']) } } },
    prompt(content, mode, signal, id) { calls.push(['prompt', content, mode, signal, id]); return new Promise(resolve => { settle = resolve }) },
  }
  const sending = submitDesignPanelPrompt(session, '保存并继续设计')
  assert.deepEqual(calls.map(row => row[0]), ['echo', 'prompt'])
  assert.equal(calls[1][4], 'host-minted')
  assert.deepEqual(calls[0][1], { mode: 'queue', text: '保存并继续设计', attachments: [] })
  const accepted = { ok: true, value: { accepted: true } }
  settle(accepted)
  assert.equal(await sending, accepted)
  assert.equal(calls.length, 2, 'no second prompt or fabricated user message')
})

test('advisory or other explicitly supplied receipt ids are not replaced', async () => {
  let seen
  const session = { getSnapshot() { return { subagent: null } }, beginSubmission() { assert.fail('must not replace existing identity') },
    async prompt(_content, mode, _signal, id) { seen = [mode, id]; return { ok: true } } }
  await submitDesignPanelPrompt(session, 'Review this accepted item', 'existing-receipt')
  assert.deepEqual(seen, ['queue', 'existing-receipt'])
})

test('unavailable echo capability retains authenticated queue admission, never fakes an echo', async () => {
  let count = 0
  const session = { async prompt(_content, mode, _signal, id) {
    count++; assert.equal(mode, 'queue'); assert.equal(id, undefined); return { ok: true }
  } }
  await submitDesignPanelPrompt(session, 'Save and continue designing')
  assert.equal(count, 1)
})

for (const failure of ['rejected', 'throws']) test('retires only its owned local echo on '+failure, async () => {
  let abandoned = 0, prompts = 0
  const session = { getSnapshot() { return { subagent: null } }, beginSubmission() { return { requestId: 'own', abandon() { abandoned++ } } },
    async prompt() { prompts++; if (failure === 'throws') throw Error('transport unavailable'); return { ok: false, error: { code: 'refused' } } } }
  if (failure === 'throws') await assert.rejects(submitDesignPanelPrompt(session, 'Continue'), /transport unavailable/)
  else assert.equal((await submitDesignPanelPrompt(session, 'Continue')).ok, false)
  assert.equal(abandoned, 1); assert.equal(prompts, 1)
})

for (const identity of ['child', 'unknown', 'unavailable']) test('does not fabricate a root echo for '+identity+' Session identity', async () => {
  let prompts = 0
  const session = { beginSubmission() { assert.fail('unsupported echo identity') },
    async prompt(_content, mode, _signal, id) { prompts++; assert.equal(mode, 'queue'); assert.equal(id, undefined); return { ok: true } } }
  if (identity === 'child') session.getSnapshot = () => ({ subagent: { address: { childSessionId: 'child' } } })
  if (identity === 'unavailable') session.getSnapshot = () => { throw Error('snapshot unavailable') }
  assert.equal((await submitDesignPanelPrompt(session, 'Continue')).ok, true)
  assert.equal(prompts, 1)
})

test('saved-batch correlation begins only after native admission and never awaits model metadata work', async () => {
  let settle, admitted = 0
  const order = []
  const session = { getSnapshot: () => ({ subagent: null }),
    beginSubmission: () => ({ requestId: 'real-host-rpc', abandon() {} }),
    prompt() { order.push('prompt'); return new Promise(resolve => { settle = resolve }) } }
  const sending = submitDesignPanelPrompt(session, 'Save and continue designing', undefined, id => {
    order.push('metadata'); admitted++; assert.equal(id, 'real-host-rpc')
    // Optional downstream work has no place on the admission Promise chain.
    return new Promise(() => {})
  })
  assert.deepEqual(order, ['prompt']); assert.equal(admitted, 0)
  settle({ ok: true }); assert.equal((await sending).ok, true)
  assert.deepEqual(order, ['prompt', 'metadata']); assert.equal(admitted, 1)
})

for (const refusal of ['host-reject', 'child', 'unknown', 'missing-root-id']) test('no assessment correlation on '+refusal, async () => {
  const session = { getSnapshot: () => ({ subagent: refusal === 'child' ? {} : refusal === 'unknown' ? undefined : null }),
    async prompt() { return { ok: refusal !== 'host-reject' } } }
  if (refusal !== 'missing-root-id') session.beginSubmission = () => ({ requestId: 'host-id', abandon() {} })
  await submitDesignPanelPrompt(session, 'Continue', undefined, () => assert.fail('no trusted successful root correlation'))
})

test('optional metadata failure cannot relabel an admitted user message as failed', async () => {
  const accepted = { ok: true }
  const session = { getSnapshot: () => ({ subagent: null }), async prompt() { return accepted } }
  assert.equal(await submitDesignPanelPrompt(session, 'Continue', 'explicit-real-rpc', () => { throw Error('metadata transport failed') }), accepted)
})
