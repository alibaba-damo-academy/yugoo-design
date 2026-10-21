import assert from 'node:assert/strict'
import { StudioKitDraftController } from '../lib/index.js'
const seed = { id: 'one', revision: 0, baseKit: { name: 'demo', version: '1' }, baseSnapshot: 'snapshot', mounts: [{ name: 'questions', version: '1' }], mindsetSource: 'original', relationsSource: null, confirmed: false }
let persisted = seed
const calls = []
const client = {
  save: async input => { calls.push(input); return persisted = { ...persisted, ...input, revision: persisted.revision + 1 } },
  read: async () => persisted,
  validate: async input => ({ revision: input.expectedRevision, valid: persisted.mindsetSource !== 'invalid', diagnostics: persisted.mindsetSource === 'invalid' ? [{ code: 'invalid', message: 'invalid source' }] : [] }),
  confirm: async input => ({ ...await client.validate(input), draft: persisted = { ...persisted, revision: persisted.revision + 1, confirmed: true } }),
  fork: async () => ({ ...persisted, id: 'two', revision: 0, confirmed: false }),
  preview: async input => ({ preview: { revision: input.expectedRevision, bundle: input.bundle, kit: seed.baseKit, sample: JSON.parse(input.sampleSource), panelYaml: '[]' }, diagnostics: [] }),
}
const editor = new StudioKitDraftController(seed, client)
editor.edit({ mindsetSource: 'invalid', relationsSource: '' })
await editor.perform('validate'); assert.equal(editor.getSnapshot().validation, undefined)
await editor.perform('preview', { bundle: seed.mounts[0], sampleSource: '{}' }); assert.equal(editor.getSnapshot().preview, undefined)
await editor.perform('save'); assert.equal(calls[0].expectedRevision, 0); assert.equal(calls[0].relationsSource, '')
const reopened = new StudioKitDraftController(await client.read(), client)
await reopened.perform('validate'); assert.equal(reopened.getSnapshot().validation.valid, false)
reopened.edit({ mindsetSource: 'valid', relationsSource: null })
await reopened.perform('save'); await reopened.perform('validate'); assert.equal(reopened.getSnapshot().validation.valid, true)
await reopened.perform('preview', { bundle: seed.mounts[0], sampleSource: '{"value":42}' }); assert.equal(reopened.getSnapshot().preview.preview.sample.value, 42)
await reopened.perform('confirm'); reopened.edit({ mindsetSource: 'forbidden' }); assert.equal(reopened.getSnapshot().mindsetSource, 'valid'); assert.equal(reopened.getSnapshot().record.confirmed, true)
const fork = await reopened.perform('fork'); assert.equal(fork.confirmed, false); assert.equal(fork.id, 'two'); assert.deepEqual(fork.mounts, seed.mounts)
let release
const stale = new StudioKitDraftController(seed, { ...client, save: () => new Promise(resolve => { release = resolve }) })
stale.edit({ mindsetSource: 'new' }); const pending = stale.perform('save'); stale.dispose(); release({ ...seed, revision: 1, mindsetSource: 'new' }); await pending
assert.equal(stale.getSnapshot().record.revision, 0, 'disposed editor ignores an old save response')
const mismatch = new StudioKitDraftController(seed, { ...client, preview: async input => ({ ...await client.preview(input), preview: { ...(await client.preview(input)).preview, revision: 99 } }) })
await mismatch.perform('preview', { bundle: seed.mounts[0], sampleSource: '{}' }); assert.match(mismatch.getSnapshot().error, /identity/); assert.equal(mismatch.getSnapshot().preview, undefined)
console.log('Kit edit/save/reopen/invalid validation/confirm lock/fork/saved preview/disposal/identity PASS')

let finishConfirm
const busy = new StudioKitDraftController(seed, { ...client, confirm: () => new Promise(resolve => { finishConfirm = resolve }) })
const confirming = busy.perform('confirm')
busy.clearPreview()
assert.equal(busy.getSnapshot().busy, true, 'sample invalidation must not cancel a pending confirmation')
finishConfirm({ revision: seed.revision, valid: true, diagnostics: [], draft: { ...seed, confirmed: true, revision: 1 } })
await confirming
assert.equal(busy.getSnapshot().record.confirmed, true)
assert.equal(busy.getSnapshot().busy, false)
console.log('Busy sample invalidation preserves confirmation response PASS')
