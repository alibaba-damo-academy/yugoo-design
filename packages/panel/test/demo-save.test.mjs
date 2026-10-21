import test from 'node:test'
import assert from 'node:assert/strict'
import { createPanelDemoSave } from '../src/client/demo-save.ts'
import { resetPanelStore, syncProjection, editDraft, isDirty, panelStore, revertAll } from '../src/client/store.ts'

test('demonstration baseline clears dirty, supports undo and survives unchanged polling without mutating source', () => {
  const registry = { get: () => undefined }
  const source = { synthetic: { state: { text: 'generated' }, skillManifest: { presentation: { mode: 'declarative' } } } }
  const demo = createPanelDemoSave()
  resetPanelStore('demo-test')
  syncProjection(source, true, registry)
  editDraft('synthetic', { text: 'edited' })
  assert.equal(isDirty('synthetic', registry), true)
  demo.accept(source, panelStore.getSnapshot().drafts, ['synthetic'])
  syncProjection(demo.project(source), true, registry)
  assert.equal(isDirty('synthetic', registry), false)
  assert.equal(source.synthetic.state.text, 'generated')
  syncProjection(demo.project(structuredClone(source)), true, registry)
  assert.equal(panelStore.getSnapshot().originals.synthetic.text, 'edited')
  editDraft('synthetic', { text: 'another edit' })
  revertAll()
  assert.equal(panelStore.getSnapshot().drafts.synthetic.text, 'edited')
  assert.equal(createPanelDemoSave().project(source), source, 'new page has no demo baseline')
  resetPanelStore()
})

test('new generated source replaces and invalidates demonstration overlay', () => {
  const source = { synthetic: { state: { text: 'generated' } } }
  const demo = createPanelDemoSave()
  demo.accept(source, { synthetic: { text: 'demo' } }, ['synthetic'])
  const next = { synthetic: { state: { text: 'new generation' } } }
  assert.equal(demo.project(next).synthetic.state.text, 'new generation')
  assert.equal(demo.project(source).synthetic.state.text, 'generated', 'discarded overlay cannot resurface')
})
