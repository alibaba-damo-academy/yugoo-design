import assert from 'node:assert/strict'
import { StudioTrialController, checkStudioTrialConnection, localTrialUrl, trialActive } from '../lib/index.js'

{
  let probes = 0
  const noDispatch = { start: () => { throw new Error('A connection probe must not dispatch') } }
  assert.equal(await checkStudioTrialConnection(noDispatch), 'unknown')
  for (const status of ['available', 'unavailable', 'unknown', 'malformed']) {
    assert.equal(await checkStudioTrialConnection({ ...noDispatch, async checkConnection() { probes++; return { status } } }), status === 'malformed' ? 'unknown' : status)
  }
  assert.equal(probes, 4)
  assert.equal(await checkStudioTrialConnection({ ...noDispatch, checkConnection: async () => { throw new Error('private failure') } }), 'unavailable')
  assert.equal(await checkStudioTrialConnection({ ...noDispatch, checkConnection: () => new Promise(() => {}) }, 5), 'unknown')
  console.log('Trial availability: bounded non-generating probe, no dispatch, unsupported/invalid/error are not ready PASS')
}

const source = { kind: 'installed', kit: { name: 'kit', version: '1' }, bundle: { name: 'bundle', version: '1' } }
const record = { id: 'trial1', source: structuredClone(source), status: 'queued', sourceLabel: 'snapshot', projectLabel: 'isolated' }
let starts = 0, removals = 0, input
const client = {
  list: async () => [],
  start: async value => { starts++; input = value; return record },
  read: async () => record,
  stop: async () => { throw new Error('Host cannot interrupt this run') },
  remove: async () => { removals++ },
}
const controller = new StudioTrialController(client, source)
await controller.start('test')
assert.equal(starts, 0, 'must recover before creating more work')
await controller.recover()
source.bundle.version = 'changed outside controller'
await controller.start('  trial task  ')
assert.equal(input.source.bundle.version, '1', 'request retains source identity')
assert.equal(input.task, '  trial task  ')
await controller.start('duplicate')
assert.equal(starts, 1)
await controller.remove()
assert.equal(removals, 0)
await controller.stop()
assert.equal(controller.getSnapshot().record.status, 'queued')
assert.match(controller.getSnapshot().error, /cannot interrupt/)
let finishRead
client.read = () => new Promise(resolve => { finishRead = resolve })
const pending = controller.refresh()
client.stop = async () => ({ ...record, status: 'stopped' })
await controller.stop()
finishRead(record)
await pending
assert.equal(controller.getSnapshot().record.status, 'stopped', 'stale poll cannot undo stop')
await controller.remove()
assert.equal(removals, 1)
assert.equal(controller.getSnapshot().record, undefined)
assert.equal(trialActive({ ...record, status: 'unknown' }), true)
for (const unsafe of ['javascript:alert(1)', 'https://example.com', 'http://user:secret@localhost:1234', 'http://localhost.evil:1234']) assert.equal(localTrialUrl(unsafe), undefined)
assert.equal(localTrialUrl('http://127.0.0.1:1234/#token'), 'http://127.0.0.1:1234/#token')
console.log('Trial controller: recovery, immutable source, duplicate guard, stop failure, stale poll, cleanup, URL boundary passed')

const requests = []
let current = { ...record, status: 'preparing', inputMode: 'generated' }
const generatedClient = {
  ...client, list: async () => [],
  start: async value => { requests.push(value); return current },
  read: async () => current,
}
const generated = new StudioTrialController(generatedClient, record.source)
await generated.recover()
assert.equal(requests.length, 0, 'mount/recovery must not execute')
await Promise.all([generated.startExample(), generated.startExample()])
assert.equal(requests.length, 1, 'first explicit open dispatches once')
assert.equal(Object.hasOwn(requests[0], 'task'), false, 'native Agent prepares the first input')
await generated.startExample()
assert.equal(requests.length, 1, 'reopening does not rerun')
current = { ...current, status: 'waiting', task: 'Use bundle to design a synthetic shop' }
await generated.refresh()
assert.equal(generated.getSnapshot().record.task, current.task)
const firstInput = current.task
current = { ...current, id: 'trial2', status: 'queued', inputMode: 'manual', task: 'Use bundle to design a library' }
await generated.start(current.task)
assert.equal(requests[1].task, current.task)
assert.equal(generated.getSnapshot().history.find(item => item.id === 'trial1').task, firstInput, 'old result retains its exact input')
generated.select('trial1')
await generated.start('must not bypass another active run')
assert.equal(requests.length, 2)
console.log('Generated trial: explicit first click, no duplicate, durable input, manual rerun and cross-history guard passed')
const revisionSource = { ...record.source, kind: 'panel-draft', id: 'draft', expectedRevision: 2 }
const stale = new StudioTrialController({ ...generatedClient, start: async () => ({ ...record, source: { ...revisionSource, expectedRevision: 1 } }) }, revisionSource)
await stale.recover()
await stale.start('exact input')
assert.equal(stale.getSnapshot().record, undefined)
assert.match(stale.getSnapshot().error, /source mismatch/)
const ordered = new StudioTrialController({ ...generatedClient, list: async () => [
  { ...record, id: 'older', createdAt: '2026-10-07T01:00:00Z' },
  { ...record, id: 'newer', createdAt: '2026-10-07T02:00:00Z' },
] }, record.source)
await ordered.recover()
assert.deepEqual(ordered.getSnapshot().history.map(item => item.id), ['newer', 'older'], 'reload orders history by creation time, not random record id')
let pollFails = true
const recoveredPoll = new StudioTrialController({ ...generatedClient, list: async () => [record], read: async () => {
  if (pollFails) throw new Error('temporary network failure')
  return { ...record, status: 'waiting' }
} }, record.source)
await recoveredPoll.recover()
await recoveredPoll.refresh()
assert.match(recoveredPoll.getSnapshot().error, /temporary network failure/)
pollFails = false
await recoveredPoll.refresh()
assert.equal(recoveredPoll.getSnapshot().error, undefined, 'successful polling clears a stale transport error')
assert.equal(recoveredPoll.getSnapshot().record.status, 'waiting')

for (const locale of ['zh-CN', 'en-US']) {
  const inputs = []
  const localized = new StudioTrialController({ ...generatedClient, list: async () => [], start: async input => {
    inputs.push(input); return { ...record, locale, status: 'waiting' }
  } }, record.source)
  await localized.recover()
  await localized.startExample(locale)
  assert.equal(inputs[0].locale, locale)
  await localized.start('  exact smart_questions task\n', locale)
  assert.equal(inputs[1].locale, locale)
  assert.equal(inputs[1].task, '  exact smart_questions task\n', 'locale is separate from unchanged user input')
  await localized.startExample(locale === 'zh-CN' ? 'en-US' : 'zh-CN')
  assert.equal(inputs.length, 2, 'language changes do not redispatch an existing trial')
}
