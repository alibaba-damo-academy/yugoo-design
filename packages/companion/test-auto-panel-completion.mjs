import test from 'node:test'
import assert from 'node:assert/strict'
import { finishWithAutoPanel } from './src/auto-panel-completion.mjs'

function fixture(binding, { fail = false, auto = true } = {}) {
  let prepared = 0
  const settled = { accepted: true, settlement: { checkpoint: 'published-facts' } }
  return { prepared: () => prepared, settled, request: { method: 'finishMainBundle', params: { invocationId: 'bound' },
    nativeRuns: { finishMainBundle: async () => settled, finishNativeRun: async () => settled,
      getMainInvocation: () => binding, getBinding: () => binding },
    project: { installedKit: { skills: [{ name: 'example', metadata: { skillManifest: { presentation: { mode: auto ? 'auto' : 'declarative' } } } }] },
      prepareAutoPanel: async () => { prepared += 1; if (fail) throw new Error('UI cache unavailable'); return { status: 'awaiting-agent', requestId: 'ticket' } } } } }
}

test('successful main and Producer completion return automatic follow-up on the normal finish response', async () => {
  for (const method of ['finishMainBundle', 'finishNativeRun']) {
    const f = fixture({ skill: 'example', role: 'producer', settledOutcome: 'complete' })
    const result = await finishWithAutoPanel({ ...f.request, method })
    assert.equal(result.accepted, true); assert.equal(result.autoTask.requestId, 'ticket')
    assert.match(result.autoPanelInstruction, /same native Agent/); assert.equal(f.prepared(), 1)
  }
})

test('UI preparation failure preserves successful Design File settlement; only UI retry is needed', async () => {
  const f = fixture({ skill: 'example', settledOutcome: 'pause' }, { fail: true })
  const result = await finishWithAutoPanel(f.request)
  assert.deepEqual(result.settlement, f.settled.settlement); assert.equal(result.accepted, true)
  assert.equal(result.autoTask.status, 'failed'); assert.equal(result.autoTask.detail, 'UI cache unavailable')
})

test('Worker/failure/cancel/no-progress/non-auto do not prepare UI', async () => {
  for (const outcome of ['failed', 'cancelled', 'no-progress']) {
    const f = fixture({ skill: 'example', settledOutcome: outcome })
    assert.deepEqual(await finishWithAutoPanel(f.request), f.settled); assert.equal(f.prepared(), 0)
  }
  const worker = fixture({ skill: 'example', role: 'worker', settledOutcome: 'complete' })
  await finishWithAutoPanel({ ...worker.request, method: 'finishNativeRun' }); assert.equal(worker.prepared(), 0)
  const manual = fixture({ skill: 'example', settledOutcome: 'complete' }, { auto: false })
  await finishWithAutoPanel(manual.request); assert.equal(manual.prepared(), 0)
})
