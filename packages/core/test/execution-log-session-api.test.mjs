import assert from 'node:assert/strict'
import test from 'node:test'
const { register } = await import('tsx/esm/api'); register()
const { DesignPanelRemote } = await import('../src/panel-remote.ts')
const events = ['parent private context', 'child progress'].map((text, seq) => ({
  type: 'assistant/message', seq, time: seq,
  data: { turn: 1, step: seq, message: { content: [{ type: 'text', text }] } },
}))
const header = { id: 'child', isSeeded: true }
function remote(host) {
  const instance = Object.create(DesignPanelRemote.prototype)
  Object.defineProperties(instance, {
    hostContext: { value: host },
    design: { value: { ownsExecutionRun: () => true } },
    executionLogReads: { value: new Map() },
  })
  return instance
}
for (const live of [true, false]) test(`official ${live ? 'live' : 'persisted'} transcript excludes inherited parent history`, async () => {
  const instance = remote(live ? { sessions: { get: () => ({ header, inheritedEventCount: 1, snapshotEvents() { return events } }) } }
    : { sessionPersistence: { inspect: async () => ({ meta: header, events, inheritedEventCount: 1 }) } })
  const result = await instance.readExecutionLog({}, 'child', undefined, new AbortController().signal)
  assert.equal(result.found, true)
  assert.equal(result.entries.length, 1)
  assert.match(JSON.stringify(result.entries), /child progress/)
  assert.doesNotMatch(JSON.stringify(result.entries), /parent private context/)
})
test('seeded transcript without a boundary is refused, not shown as child work', async () => {
  const instance = remote({ sessions: { get: () => ({ header, snapshotEvents() { return events } }) } })
  await assert.rejects(instance.readExecutionLog({}, 'child', undefined, new AbortController().signal), /no inherited-history boundary/)
})
for (const live of [true, false]) test(`legacy header cannot authorize ${live ? 'live' : 'persisted'} inherited history`, async () => {
  const legacyHeader = { ...header, seedLength: 0 }
  const instance = remote(live
    ? { sessions: { get: () => ({ header: legacyHeader, snapshotEvents() { return events } }) } }
    : { sessionPersistence: { inspect: async () => ({ meta: legacyHeader, events }) } })
  await assert.rejects(instance.readExecutionLog({}, 'child', undefined, new AbortController().signal), /no inherited-history boundary/)
})

for (const isError of [false, true]) test(`current tool-role failure flag is projected as error=${isError}`, async () => {
  const session = { header: { id: 'child', isSeeded: false }, snapshotEvents: () => [
    { type: 'tool/call', seq: 0, time: 0, data: { callId: 'call-1', name: 'read', arguments: {} } },
    { type: 'tool/result', seq: 1, time: 1, data: { message: {
      role: 'tool', source: { kind: 'tool', callId: 'call-1' }, toolCallId: 'call-1', isError,
      content: [{ type: 'text', text: isError ? 'failed' : 'read complete' }],
    } } },
  ] }
  const result = await remote({ sessions: { get: () => session } }).readExecutionLog({}, 'child', undefined, new AbortController().signal)
  assert.equal(result.entries.filter(entry => entry.eventType === 'error').length, Number(isError))
  if (isError) assert.match(result.entries.at(-1).message, /read · failed/)
})
