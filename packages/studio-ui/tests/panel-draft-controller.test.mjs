import assert from 'node:assert/strict'
import { StudioPanelDraftController } from '../lib/index.js'

const seed = {
  kit: { name: 'demo', version: '1.0' }, bundle: { name: 'example', version: '1.0' },
  revision: 0, panelSource: 'version: 1', sampleSource: '{}',
}
const deferred = () => {
  let resolve, reject
  const promise = new Promise((a, b) => { resolve = a; reject = b })
  return { promise, resolve, reject }
}
const reply = request => ({ preview: { revision: request.revision, kit: request.kit, bundle: request.bundle, panelYaml: request.panelSource, sample: JSON.parse(request.sampleSource) }, diagnostics: [] })
const calls = []
const controller = new StudioPanelDraftController({ preparePreview(request) {
  const job = deferred(); calls.push({ ...job, request }); return job.promise
} }, seed)
seed.kit.name = 'mutated-outside'
assert.equal(controller.getSnapshot().request.kit.name, 'demo')
let updates = 0
controller.subscribe(() => { updates++ })

const first = controller.preview()
assert.equal(controller.getSnapshot().phase, 'previewing')
controller.edit({ panelSource: 'version: 2' })
assert.equal(controller.getSnapshot().request.revision, 1)
calls[0].resolve(reply(calls[0].request)); await first
assert.equal(controller.getSnapshot().phase, 'editing', 'old compile cannot resurrect a stale preview')
assert.equal(controller.getSnapshot().preview, undefined)

const second = controller.preview()
calls[1].resolve(reply(calls[1].request)); await second
assert.equal(controller.getSnapshot().phase, 'ready')
const stable = controller.getSnapshot()
controller.edit({ panelSource: stable.request.panelSource })
assert.equal(controller.getSnapshot(), stable, 'no-op edit preserves identity and revision')
controller.edit({ sampleSource: '{"label":"new sample"}' })
assert.equal(controller.getSnapshot().preview, undefined, 'sample edits also invalidate the preview')

const wrong = controller.preview()
calls[2].resolve({ ...reply(calls[2].request), preview: { ...reply(calls[2].request).preview, revision: 99 } }); await wrong
assert.equal(controller.getSnapshot().diagnostics[0].code, 'preview.identity')

const failed = controller.preview()
calls[3].reject(new Error('transport unavailable')); await failed
assert.equal(controller.getSnapshot().phase, 'invalid')
assert.equal(controller.getSnapshot().diagnostics[0].code, 'preview.request_failed')

const last = controller.preview()
controller.dispose()
const before = updates
calls[4].resolve(reply(calls[4].request)); await last
controller.edit({ panelSource: 'ignored' })
await controller.preview()
assert.equal(updates, before)
assert.equal(calls.length, 5)
console.log('STUDIO PANEL DRAFT: revision invalidation, exact identity, stale response, errors and disposal PASS')
