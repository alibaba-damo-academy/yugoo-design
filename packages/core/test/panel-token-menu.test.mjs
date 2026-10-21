import test from 'node:test'
import assert from 'node:assert/strict'
import { validatePanelManifest } from '../src/panel-dsl.ts'
import { localizePanelManifest, validatePanelTranslations } from '../src/panel-i18n.ts'

const fixture = () => ({ version: 1, panel_kind: 'document', sections: [{ id: 'entries', title: 'Entries' }],
  fields: [{ key: 'delivery', control: 'token_list', token_layout: 'cards', token_add_mode: 'menu', applies_to: ['entries'] }],
  ui: { component: 'record_form', id: 'form', source: 'entries' } })

test('token card metadata is explicit and bounded without a domain branch', () => {
  const panel = fixture()
  Object.assign(panel.fields[0], { token_add_description: 'Choose a delivery method', token_custom_icon: 'plug',
    options: [{ value: 'internal', label: 'Internal', icon: 'message-square' }] })
  assert.deepEqual(validatePanelManifest(panel), [])
  panel.fields[0].token_add_description = '$t:subtitle'
  panel.i18n = { default_locale: 'zh-CN', locales: { 'zh-CN': 'locales/zh-CN.json', 'en-US': 'locales/en-US.json' },
    messages: { 'zh-CN': { subtitle: '选择方式' }, 'en-US': { subtitle: 'Choose a method' } } }
  assert.deepEqual(validatePanelTranslations(panel, true), [])
  assert.equal(localizePanelManifest(panel, 'en-US').fields[0].token_add_description, 'Choose a method')
  assert.equal(localizePanelManifest(panel, 'zh-CN').fields[0].token_add_description, '选择方式')
  assert.equal(localizePanelManifest(panel, 'en-US').fields[0].options[0].value, 'internal')
  for (const [key, invalid] of [['token_add_description', {}], ['token_custom_icon', 'script']]) {
    const bad = structuredClone(panel); bad.fields[0][key] = invalid
    assert.ok(validatePanelManifest(bad).some(error => error.includes(key)))
  }
  const bad = structuredClone(panel); bad.fields[0].options[0].icon = '<svg>'
  assert.ok(validatePanelManifest(bad).some(error => error.includes('option icon')))
  for (const key of ['menu_description', 'selected_description']) {
    const bad = structuredClone(panel); bad.fields[0].options[0][key] = {}
    assert.ok(validatePanelManifest(bad).some(error => error.includes(key)))
  }
  const wrong = structuredClone(panel); wrong.fields[0].control = 'select'
  assert.ok(validatePanelManifest(wrong).some(error => error.includes('token_custom_icon')))
})

test('token addition mode is a bounded presentation option, never a generic event or write policy', () => {
  for (const mode of [undefined, 'inline', 'menu']) {
    const panel = fixture(); panel.fields[0].token_add_mode = mode
    assert.deepEqual(validatePanelManifest(panel), [])
  }
  for (const mode of ['dialog', {}, true, 1, null]) {
    const panel = fixture(); panel.fields[0].token_add_mode = mode
    assert.ok(validatePanelManifest(panel).some(error => error.includes('token_add_mode')))
  }
  const wrong = fixture(); wrong.fields[0].control = 'text'
  assert.ok(validatePanelManifest(wrong).some(error => error.includes('token_add_mode')))
})
