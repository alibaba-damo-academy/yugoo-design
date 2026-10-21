import assert from 'node:assert/strict'
import test from 'node:test'
import { COMPONENT_KINDS, validatePanelManifest } from '../src/panel-dsl.ts'
import { COMPONENT_KINDS as catalogKinds } from '../src/panel-component-catalog.ts'
import { localizePanelManifest, validatePanelTranslations } from '../src/panel-i18n.ts'
import { isSafeDottedPath, validateScalarDefaults } from '../src/panel-contract-primitives.ts'

const base = () => ({
  version: 1, panel_kind: 'document',
  sections: [{ id: 'items', title: 'Items' }],
  fields: [{ key: 'title', control: 'text', applies_to: ['items'] }],
  ui: { id: 'form', component: 'record_form', source: 'items' },
})

test('DSL and authoring catalog share the same component vocabulary', () => {
  assert.equal(COMPONENT_KINDS, catalogKinds)
  assert.ok(COMPONENT_KINDS.includes('navigation_workspace'))
  assert.ok(COMPONENT_KINDS.includes('canvas_workspace'))
  assert.deepEqual(validatePanelManifest(base()), [])
})

test('navigation declarations accept typed endpoints and reject unsafe or conflicting bindings', () => {
  const panel = {
    version: 1, panel_kind: 'document',
    sections: ['nodes', 'edges', 'frames'].map(id => ({ id, title: id })),
    fields: [{ key: 'label', control: 'text', applies_to: ['nodes', 'edges', 'frames'] }],
    ui: { id: 'navigation', component: 'navigation_workspace', navigation_map: {
      nodes: { path: 'nodes', order: 'node_order', label: 'label', position: 'position' },
      edges: { path: 'edges', order: 'edge_order', source: 'from', target: 'to', label: 'label', new_label: '{source} → {target}' },
      frames: { path: 'frames', label: 'label', members: 'members', position: 'position', size: 'size' },
      connection_policy: { allow_self: false, allow_parallel: true },
    } },
  }
  for (const key of ['from', 'to']) panel.fields.push({ key, control: 'record_select', applies_to: ['edges'], options_from_section: 'nodes' })
  assert.deepEqual(validatePanelManifest(panel), [])
  for (const mutate of [
    value => { value.ui.navigation_map.edges.target = 'from' },
    value => { value.ui.navigation_map.nodes.position = '__proto__.position' },
    value => { value.ui.navigation_map.connection_policy.allow_self = 'yes' },
    value => { value.ui.navigation_map.edges.new_label = '{execute}' },
  ]) {
    const invalid = structuredClone(panel)
    mutate(invalid)
    assert.ok(validatePanelManifest(invalid).length > 0)
  }
})

test('nested record controls remain local and non-recursive', () => {
  const panel = base()
  panel.fields.push({ key: 'children', control: 'record_map', applies_to: ['items'],
    item_fields: [{ key: 'title', control: 'text' }], item_label_field: 'title', item_defaults: { title: 'New' } })
  assert.deepEqual(validatePanelManifest(panel), [])
  const invalid = structuredClone(panel)
  invalid.fields[1].item_fields[0].options_from_section = 'other'
  assert.ok(validatePanelManifest(invalid).some(error => error.includes('non-recursive')))
})

test('board ID display binds only a visible readonly text field in its own section', () => {
  const panel = base()
  panel.fields.push(...['description', 'group'].map(key => ({ key, control: 'text', applies_to: ['items'] })),
    { key: 'stable_id', control: 'text', readonly: true, applies_to: ['items'] })
  panel.ui = { id: 'board', component: 'record_board', source: 'items',
    board: { label: 'title', description: 'description', group: 'group', id_field: 'stable_id' } }
  assert.deepEqual(validatePanelManifest(panel), [])
  const omitted = structuredClone(panel)
  delete omitted.ui.board.id_field
  assert.deepEqual(validatePanelManifest(omitted), [])
  for (const mutate of [
    value => { value.ui.board.id_field = 'missing' },
    value => { value.ui.board.id_field = '' },
    value => { value.ui.board.id_field = '__proto__' },
    value => { value.fields.at(-1).readonly = false },
    value => { value.fields.at(-1).hidden = true },
    value => { value.fields.at(-1).control = 'textarea' },
    value => { value.fields.at(-1).applies_to = ['elsewhere'] },
  ]) {
    const invalid = structuredClone(panel)
    mutate(invalid)
    assert.ok(validatePanelManifest(invalid).some(error => error.includes('board id_field')))
  }
})

test('localization changes display labels without altering identities or saved-value defaults', () => {
  const panel = base()
  panel.i18n = { default_locale: 'zh-CN', locales: { 'zh-CN': 'locales/zh-CN.json', 'en-US': 'locales/en-US.json' },
    messages: { 'zh-CN': { title: '标题' }, 'en-US': { title: 'Title' } } }
  panel.fields[0].label = '$t:title'
  panel.initial_values = { title: '$t:title' }
  const before = structuredClone(panel)
  assert.deepEqual(validatePanelTranslations(panel, true), [])
  const translated = localizePanelManifest(panel, 'en-US')
  assert.equal(translated.fields[0].label, 'Title')
  assert.deepEqual(translated.initial_values, before.initial_values)
  assert.deepEqual(panel, before)
  panel.i18n.locales['en-US'] = '../private.json'
  assert.ok(validatePanelTranslations(panel).length > 0)
})

test('shared path and scalar primitives reject prototype segments and non-finite values', () => {
  for (const path of ['__proto__.x', 'items.constructor', 'items..title', ' items.title']) assert.equal(isSafeDottedPath(path), false)
  assert.equal(isSafeDottedPath('items.title'), true)
  assert.deepEqual(validateScalarDefaults({ title: 'New', enabled: true, count: 1 }, 'defaults'), [])
  assert.ok(validateScalarDefaults({ count: Infinity }, 'defaults').length > 0)
})
