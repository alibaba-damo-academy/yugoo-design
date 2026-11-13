import assert from 'node:assert/strict'
import test from 'node:test'
import { DesignPanelRemote } from '../src/panel-remote.ts'
import { TYPERT_REMOTE } from '../src/typert.remote-client.ts'

const accepted = summary => ({
  advisory: { id: 'real-run/real-result', summary, kind: 'suggestion', attention: 'human-review',
    items: [{ id: 'GND-1', title: 'Confirm the scope', detail: 'F-003 conflicts with the confirmed QA answer.', references: ['design_files/functions.json'] }],
    acceptanceInstruction: 'Recheck the saved F-003 conflict; do not substitute another issue.',
    actionSpec: { kind: 'bundle-revisions', targets: [{ skillName: 'functions', entityRefs: ['F-003'] }] } },
  status: 'accepted', stale: false, acceptanceReceiptId: 'real-acceptance-receipt',
  actionReceipts: [{ actionId: 'bundle:functions', receiptId: 'real-action-receipt', state: 'ready',
    target: { kitName: 'fixture', kitVersion: '1', skillName: 'functions', bundleVersion: '2', entityRefs: ['F-003'] } }],
  executionStatus: 'ready',
})
function fixture(summary = 'Fix the scope contradiction') {
  const events = [], messages = [], entry = accepted(summary)
  let persisted = false, mode = 'normal'
  const agent = { session: { snapshotEvents: () => events },
    followup(message) {
      assert.ok(persisted, 'acceptance must be durable before waking the native agent')
      if (mode === 'reject') throw Error('Host queue unavailable')
      messages.push(message)
      events.push({ type: 'agent/inbox/spliced', data: { inserted: [message] } })
      if (mode === 'after-admission') throw Error('Observer failed after durable admission')
    }, inject() { assert.fail('explicit acceptance must wake the existing native agent') },
  }
  const remote = Object.create(DesignPanelRemote.prototype)
  remote.design = { async decideAdvisory(_agent, decision) { persisted = true; return { ...entry, status: decision.decision } } }
  const decide = decision => remote.decideAdvisory(agent, { advisoryId: entry.advisory.id, decision }, new AbortController().signal)
  return { remote, agent, events, messages, entry, decide, mode: value => { mode = value } }
}

test('accepted advice queues an attributed notice with a readable summary and complete exact authority', async () => {
  for (const summary of ['Fix the scope contradiction', '修正新增范围的确认方式']) {
    const f = fixture(summary), before = structuredClone(f.entry)
    const result = await f.decide('accepted')
    assert.equal(result.notification, 'sent')
    assert.equal(f.messages.length, 1)
    const message = f.messages[0]
    assert.deepEqual(message.source, { kind: 'yugoo-design', form: 'notice',
      summary: /[\u3400-\u9fff]/u.test(summary) ? `已接受设计建议：${summary}` : `Accepted design suggestion: ${summary}` })
    assert.doesNotMatch(message.source.summary, /receipt|执行授权|real-run|real-action|real-acceptance/)
    assert.ok(message.content[0].text.includes(f.entry.advisory.acceptanceInstruction))
    for (const value of ['real-run/real-result', 'real-acceptance-receipt', 'real-action-receipt', 'F-003', 'functions']) assert.ok(message.content[0].text.includes(value))
    assert.match(message.content[0].text, /acceptance receipt is NOT execution authority/)
    assert.deepEqual(f.entry, before, 'presentation never mints, removes or changes authority')
    await f.decide('accepted')
    assert.equal(f.messages.length, 1, 'a repeated decision must not enqueue a second continuation')
    // A replacement adapter instance can recover the proof from native events.
    const other = Object.create(DesignPanelRemote.prototype); other.design = f.remote.design
    await other.decideAdvisory(f.agent, { advisoryId: f.entry.advisory.id, decision: 'accepted' }, new AbortController().signal)
    assert.equal(f.messages.length, 1)
    const descriptor = TYPERT_REMOTE.descriptors.find(item => item.method === 'decideAdvisory')
    assert.equal(descriptor.result.create().parse(result).notification, 'sent')
  }
})

test('reject/defer and failed persistence never send a continuation', async () => {
  const f = fixture()
  for (const decision of ['rejected', 'deferred']) assert.equal((await f.decide(decision)).notification, undefined)
  f.remote.design.decideAdvisory = async () => { throw Error('Persistence failed') }
  await assert.rejects(f.decide('accepted'), /Persistence failed/)
  assert.equal(f.messages.length, 0)
})

test('failed admission remains explicit and retry reuses the saved receipts exactly once', async () => {
  const f = fixture(); f.mode('reject')
  const failure = await f.decide('accepted')
  assert.equal(failure.notification, 'failed')
  assert.equal(failure.acceptanceReceiptId, f.entry.acceptanceReceiptId)
  assert.deepEqual(failure.actionReceipts, f.entry.actionReceipts)
  assert.equal(f.messages.length, 0)
  f.mode('normal')
  assert.equal((await f.decide('accepted')).notification, 'sent')
  assert.equal(f.messages.length, 1)
})

test('admission before an observer error is not reported as an undelivered notice', async () => {
  const f = fixture(); f.mode('after-admission')
  assert.equal((await f.decide('accepted')).notification, 'sent')
  await f.decide('accepted')
  assert.equal(f.messages.length, 1)
})

test('human-pasted receipts do not suppress a plugin notice and sessions do not share admission proof', async () => {
  const f = fixture()
  f.events.push({ type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'Acceptance receipt (selection evidence only): real-acceptance-receipt' }] } })
  await f.decide('accepted')
  assert.equal(f.messages.length, 1)
  const other = fixture(); await other.decide('accepted')
  assert.equal(other.messages.length, 1)
})

test('unknown native log admission never becomes a false success or automatic retry', async () => {
  const f = fixture(); f.agent.session.snapshotEvents = () => { throw Error('History unavailable') }
  assert.equal((await f.decide('accepted')).notification, 'unknown')
  assert.equal(f.messages.length, 0)
})
