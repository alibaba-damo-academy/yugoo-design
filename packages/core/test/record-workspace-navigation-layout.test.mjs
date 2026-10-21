import { webAppBundleUrl } from './web-app-content-fixture.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { parsePanelManifest, validatePanelManifest } from '../src/panel-dsl.ts'
import { describePanelComponents } from '../src/panel-component-catalog.ts'

const base = () => ({ version: 1, panel_kind: 'document',
  sections: [{ id: 'items', title: 'Items' }],
  fields: [{ key: 'title', control: 'text', applies_to: ['items'] }],
  ui: { id: 'workspace', component: 'record_workspace', sources: ['items'],
    children: [{ id: 'inspector', component: 'record_inspector' }] } })

test('navigation layout is an explicit record-workspace-only contract with compatible default', () => {
  for (const layout of [undefined, 'list', 'tree']) {
    const panel = base()
    if (layout !== undefined) panel.ui.navigation_layout = layout
    assert.deepEqual(validatePanelManifest(panel), [])
  }
  for (const layout of ['flat', '', false, {}, []]) {
    const panel = base()
    panel.ui.navigation_layout = layout
    assert.ok(validatePanelManifest(panel).some(error => error.includes('navigation_layout')))
  }
  const panel = base()
  panel.ui.children[0].navigation_layout = 'list'
  assert.ok(validatePanelManifest(panel).some(error => error.includes('navigation_layout')))
  assert.match(describePanelComponents(), /navigation_layout defaults to tree; list shows primary records/)
})

test('role panel opts into flat navigation without altering canonical fields or related editor binding', () => {
  const manifest = parsePanelManifest(readFileSync(webAppBundleUrl('role_access/panel.yaml'), 'utf8'))
  assert.deepEqual(validatePanelManifest(manifest), [])
  assert.equal(manifest.ui.navigation_layout, 'list')
  assert.deepEqual(manifest.ui.children[0].children[0].bindings, { reference: 'role_ref' })
  assert.equal(manifest.fields.find(field => field.key === 'assignment_rule').control, 'radio_custom')
  const effect = manifest.fields.find(field => field.key === 'effect')
  assert.equal(effect.control, 'select')
  assert.equal(effect.allow_clear, false)
  assert.deepEqual(effect.options, [{ value: 'allow', label: '$t:allow' }, { value: 'deny', label: '$t:deny' }])
})
