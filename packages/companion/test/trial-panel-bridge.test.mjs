import test from 'node:test'
import assert from 'node:assert/strict'
import { createTrialPanelBridge } from '../src/trial-panel-bridge.ts'

const binding = { trialId: 'owned-trial', parentOrigin: 'http://127.0.0.1:32123' }
function fixture() {
  const messages = [], listeners = new Set(), calls = []
  const parent = { postMessage: (data, origin) => messages.push({ data, origin }) }
  const scope = { parent, addEventListener: (_, listener) => listeners.add(listener), removeEventListener: (_, listener) => listeners.delete(listener) }
  const bridge = createTrialPanelBridge(scope, binding)
  const controls = { dirty: true, saving: false, saveDisabled: false, retractDisabled: false,
    save: () => calls.push('save'), retract: () => calls.push('retract') }
  const send = (data = {}, event = {}) => {
    for (const listener of listeners) listener({ source: parent, origin: binding.parentOrigin,
      data: { type: 'yugoo-design:trial-panel-action', trialId: binding.trialId, requestId: 'request', action: 'save', ...data }, ...event })
  }
  return { bridge, scope, controls, calls, messages, send, listeners }
}

test('state is disabled before mount; delegates original controls once, with exact target origin', () => {
  const f = fixture()
  f.send({ action: 'read-state' })
  assert.equal(f.messages.at(-1).data.saveDisabled, true)
  f.bridge.update(f.controls)
  assert.deepEqual(f.messages.at(-1), { origin: binding.parentOrigin, data: {
    type: 'yugoo-design:trial-panel-state', trialId: binding.trialId, dirty: true, saving: false, saveDisabled: false, retractDisabled: false } })
  f.send(); f.send()
  f.send({ requestId: 'retract', action: 'retract' })
  assert.deepEqual(f.calls, ['save', 'retract'])
})

test('rejects other windows, origins, identities and malformed commands', () => {
  const f = fixture(); f.bridge.update(f.controls)
  f.send({}, { source: {} }); f.send({}, { origin: 'http://127.0.0.1:32124' })
  for (const invalid of [{ trialId: 'other' }, { type: 'other' }, { action: 'write' }, { requestId: '' }, { requestId: 'x'.repeat(129) }, { requestId: 42 }, { payload: {} }]) f.send(invalid)
  for (const data of [null, [], 'save', 0]) f.send({}, { data })
  assert.deepEqual(f.calls, [])
  f.send()
  assert.deepEqual(f.calls, ['save'], 'invalid events never consume a valid command ID')
})

test('disabled and saving actions are not queued or automatically retried', () => {
  const f = fixture()
  f.send({ requestId: 'unmounted' })
  f.bridge.update({ ...f.controls, saveDisabled: true, retractDisabled: true })
  f.send({ requestId: 'disabled' }); f.send({ requestId: 'disabled-retract', action: 'retract' })
  f.bridge.update({ ...f.controls, saving: true })
  f.send({ requestId: 'busy' })
  f.bridge.update(f.controls)
  for (const requestId of ['unmounted', 'disabled', 'busy']) f.send({ requestId })
  f.send({ requestId: 'disabled-retract', action: 'retract' })
  assert.deepEqual(f.calls, [])
  f.send({ requestId: 'fresh' }); assert.deepEqual(f.calls, ['save'])
})

test('propagates original dirty/saving/error state and disables controls on disposal', () => {
  const f = fixture()
  f.bridge.update({ ...f.controls, dirty: false, saving: true, saveDisabled: true, error: 'Original save failure' })
  assert.equal(f.messages.at(-1).data.error, 'Original save failure')
  assert.equal(f.messages.at(-1).data.dirty, false)
  assert.equal(f.messages.at(-1).data.saving, true)
  f.bridge.dispose()
  assert.equal(f.messages.at(-1).data.saveDisabled, true)
  assert.equal(f.messages.at(-1).data.retractDisabled, true)
  assert.equal(f.listeners.size, 0)
  const count = f.messages.length
  f.send(); f.bridge.update(f.controls); f.bridge.dispose()
  assert.equal(f.messages.length, count); assert.deepEqual(f.calls, [])
})

test('long-lived panel accepts fresh commands beyond 128 without replaying old IDs', () => {
  const f = fixture(); f.bridge.update(f.controls)
  for (let i = 0; i < 140; i++) f.send({ requestId: String(i) })
  f.send({ requestId: '0' })
  assert.equal(f.calls.length, 140)
})

test('requires exact loopback parent and a real embedding window', () => {
  const f = fixture()
  for (const parentOrigin of ['https://example.com', 'http://localhost:32123', 'http://127.0.0.1:32123/', 'http://user:secret@127.0.0.1:32123', 'null']) {
    assert.throws(() => createTrialPanelBridge(f.scope, { ...binding, parentOrigin }))
  }
  const standalone = {}; standalone.parent = standalone
  assert.throws(() => createTrialPanelBridge(standalone, binding), /owned trial parent/)
  assert.throws(() => createTrialPanelBridge(f.scope, { ...binding, trialId: '' }), /owned trial parent/)
})
