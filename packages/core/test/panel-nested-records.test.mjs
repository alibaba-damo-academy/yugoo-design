import test from 'node:test'
import assert from 'node:assert/strict'
import { validatePanelManifest } from '../src/panel-dsl.ts'
import { localizePanelManifest } from '../src/panel-i18n.ts'

const fixture = () => ({ version: 1, panel_kind: 'document', sections: [{ id: 'parents', title: 'Parents' }],
  fields: [{ key: 'fields', control: 'record_map', applies_to: ['parents'], id_field: 'id', order_field: 'order', item_label_field: 'name',
    item_defaults: { name: '', requirement: 'optional', options: [] }, item_fields: [
      { key: 'name', control: 'text', label: 'Name' },
      { key: 'requirement', control: 'select', label: 'Requirement', options: [{ value: 'optional', label: 'Optional' }, { value: 'conditional', label: 'Conditional' }] },
      { key: 'required_when', control: 'textarea', label: 'Required when', visible_when: { field: 'requirement', in: ['conditional'] }, clear_when_hidden: true },
      { key: 'options', control: 'token_list', label: 'Choices' },
    ] }], ui: { id: 'form', component: 'record_form', source: 'parents' } })

test('typed nested forms use bounded local field contracts and reject malformed candidates', () => {
  assert.deepEqual(validatePanelManifest(fixture()), [])
  for (const update of [
    f => { f.item_fields = [null] }, f => { f.item_fields = {} }, f => { f.item_fields = [] },
    f => { f.item_fields[0].key = '__proto__' }, f => { f.item_fields[0].key = 'id' },
    f => { f.item_fields[0].key = 'name.nested' }, f => { f.item_fields[0].control = 'record_map'; f.item_fields[0].item_fields = [{ key: 'deep', control: 'text' }] },
    f => { f.item_fields[0].applies_to = ['parents'] }, f => { f.item_fields[0].options_from_panel = { panel_type: 'other', section_id: 'foreign' } },
    f => { f.item_fields[0].required_in = ['items'] }, f => { f.item_fields[0].required = 'yes' },
    f => { f.item_fields[2].visible_when.field = 'parentOnlyField' }, f => { f.item_fields.push({ ...f.item_fields[0] }) },
    f => { f.item_defaults = { unknown: true } }, f => { f.item_defaults = { id: 'collision' } },
    f => { f.item_defaults = { name: {} } }, f => { f.item_label_field = 'unknown' }, f => { f.item_label_field = 'requirement' },
    f => { f.columns = [{ key: 'name', control: 'text', label: 'Name' }] }, f => { f.control = 'text' },
  ]) {
    const candidate = fixture(); update(candidate.fields[0])
    assert.ok(validatePanelManifest(candidate).length, String(update))
  }
})

test('nested labels localize without translating item defaults', () => {
  const panel = fixture()
  panel.i18n = { default_locale: 'zh-CN', locales: { 'zh-CN': 'locales/zh-CN.json', 'en-US': 'locales/en-US.json' }, messages: { 'zh-CN': { name: '名称' }, 'en-US': { name: 'Name' } } }
  panel.fields[0].item_fields[0].label = '$t:name'
  panel.fields[0].item_defaults = { name: '$t:name' }
  assert.deepEqual(validatePanelManifest(panel), [])
  const localized = localizePanelManifest(panel, 'en-US')
  assert.equal(localized.fields[0].item_fields[0].label, 'Name')
  assert.equal(localized.fields[0].item_defaults.name, '$t:name')
})

test('conditional labels are bounded sibling copy, localize recursively and reject malformed declarations', () => {
  const panel = fixture()
  const field = panel.fields[0].item_fields[0]
  field.label_when = [{ field: 'requirement', in: ['conditional'], label: '$t:conditionalName' }]
  panel.i18n = { default_locale: 'en-US', locales: { 'en-US': 'locales/en-US.json' }, messages: { 'en-US': { conditionalName: 'Conditional name' } } }
  assert.deepEqual(validatePanelManifest(panel), [])
  assert.equal(localizePanelManifest(panel, 'en-US').fields[0].item_fields[0].label_when[0].label, 'Conditional name')
  for (const value of [null, {}, [], [null], [{ field: 'outside', in: ['conditional'], label: 'Label' }],
    [{ field: 'requirement', in: [], label: 'Label' }], [{ field: 'requirement', in: [1], label: 'Label' }],
    [{ field: 'requirement', in: ['conditional'], label: '' }],
    [{ field: 'requirement', in: ['conditional'], label: 'Label', expression: 'execute()' }]]) {
    const invalid = structuredClone(panel); invalid.fields[0].item_fields[0].label_when = value
    assert.ok(validatePanelManifest(invalid).some(error => error.includes('label_when')), JSON.stringify(value))
  }
  const isolated = { version: 1, panel_kind: 'document', sections: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }],
    fields: [{ key: 'name', control: 'text', applies_to: ['a'], label_when: [{ field: 'mode', in: ['x'], label: 'X' }] },
      { key: 'mode', control: 'text', applies_to: ['b'] }], ui: { id: 'form', component: 'record_form', source: 'a' } }
  assert.ok(validatePanelManifest(isolated).some(error => error.includes('label_when')))
})

test('typed local references read only declared parent sections without cross-record write scope', () => {
  const panel=fixture()
  panel.fields[0].item_fields.push({key:'target',control:'record_select',label:'Target',options_from_section:'parents'})
  assert.deepEqual(validatePanelManifest(panel),[])
  for(const mutate of [
    f=>{f.options_from_section='missing'},f=>{f.options_from_section='nested-items'},
    f=>{f.options_from_section='__proto__'},f=>{f.control='record_multi_select'},
    f=>{f.options_from_panel={panel_type:'other',section_id:'parents'}},
  ]){const candidate=structuredClone(panel);mutate(candidate.fields[0].item_fields.at(-1));assert.ok(validatePanelManifest(candidate).length)}
})
