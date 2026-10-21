import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

test('supported generated and retained panels emit identical real input edits after rebinding and enforce readonly', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' })
  globalThis.window = dom.window; globalThis.document = dom.window.document
  globalThis.HTMLElement = dom.window.HTMLElement; globalThis.Element = dom.window.Element
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const { default: React, act } = await import('react'); globalThis.React = React
  const { createRoot } = await import('react-dom/client')
  const { renderManifest } = await import('../src/interpreter.ts')
  const { basicGenericManifest } = await import('../../core/src/auto-panel-generation.ts')
  const { autoPanelSnapshot, preserveAutoPanelDefinition, readSavedAutoPanelDefinition } = await import('../../core/src/auto-panel-spec.ts')
  const context = { kit: 'equipment', kitVersion: '1.0', bundle: 'inventory', bundleVersion: '1.0',
    schema: { type: 'object', properties: { items: { type: 'map', value: { type: 'object',
      properties: { title: { type: 'string' } } } } } }, state: { items: { a: { title: 'Original' } } } }
  const original = basicGenericManifest(context)
  const snapshot = autoPanelSnapshot(context, [
    { version: 'v0.9', createSurface: { surfaceId: 'auto-panel', catalogId: 'urn:dsh:panel-catalog:design-files:v1', sendDataModel: false } },
    { version: 'v0.9', updateComponents: { surfaceId: 'auto-panel', components: [{ id: 'root', component: 'DesignPanel', manifest: original }] } },
  ])
  const saved = JSON.parse(JSON.stringify(preserveAutoPanelDefinition(snapshot, context)))
  const rebound = { ...context, state: { items: { b: { title: 'Current' } } } }
  const retained = readSavedAutoPanelDefinition(saved, rebound).manifest
  const transcripts = []
  try {
    for (const manifest of [original, retained]) {
      const root = createRoot(document.getElementById('root'))
      const edits = []
      try {
        for (const locale of ['en-US', 'zh-CN']) {
          await act(async () => root.render(renderManifest(manifest, rebound.state, { locale, editable: true, onEdit: edit => edits.push(edit) })))
          const input = document.querySelector('input')
          assert.ok(input, 'real editable field must be present')
          assert.equal(input.value, 'Current', 'retained panel must bind current records, not the generation snapshot')
          Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, `Edited ${locale}`)
          await act(async () => input.dispatchEvent(new dom.window.Event('input', { bubbles: true })))
          assert.deepEqual(edits.at(-1), { section: 'items', record: 'b', field: 'title', value: `Edited ${locale}` })
          const count = edits.length
          await act(async () => root.render(renderManifest(manifest, rebound.state, { locale, editable: false, onEdit: edit => edits.push(edit) })))
          for (const control of document.querySelectorAll('input')) {
            assert.ok(control.disabled || control.readOnly, 'readonly must not retain an enabled input')
          }
          assert.equal(edits.length, count)
        }
        transcripts.push(edits)
      } finally { await act(async () => root.unmount()) }
    }
    assert.deepEqual(transcripts[1], transcripts[0])
    assert.equal(transcripts[0].length, 2, 'equivalence must include actual edits')
    assert.deepEqual(rebound.state, { items: { b: { title: 'Current' } } })
  } finally { dom.window.close() }
})
