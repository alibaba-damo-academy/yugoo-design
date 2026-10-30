import assert from 'node:assert/strict'
import test from 'node:test'
import { localizePanelManifest, panelTranslationKeys, validatePanelTranslations } from '../src/panel-i18n.ts'
import { validatePanelManifest } from '../src/panel-dsl.ts'

const fixture = () => ({
  version: 1, panel_kind: 'evidence_workbook',
  i18n: {
    default_locale: 'zh-CN', locales: { 'zh-CN': 'locales/zh-CN.json', 'en-US': 'locales/en-US.json' },
    messages: { 'zh-CN': { title: '规则', help: '说明', custom: '自定义' }, 'en-US': { title: 'Rules', help: ' ', custom: 'Custom' } },
  },
  initial_values: { title: '$t:title' },
  sections: [{ id: 'rules', title: '$t:title', create: { defaults: { title: '$t:title' } } }],
  fields: [{ key: 'title', label: '$t:title', control: 'text', placeholder: '$t:help', custom_description: '$t:custom' }],
  ui: { component: 'record_workspace', id: 'workspace', title: '$t:title', sources: ['rules'] },
})

test('independent guidance translates without mutating bindings and rejects explicit invalid values', () => {
  const panel = fixture()
  panel.ui.guidance = '$t:help'
  panel.ui.description = 'Empty-state description stays separate'
  const before = structuredClone(panel)
  assert.deepEqual(validatePanelManifest(panel), [])
  assert.equal(localizePanelManifest(panel, 'en-US').ui.guidance, '说明', 'blank optional locale falls back')
  assert.equal(localizePanelManifest(panel, 'en-US').ui.description, panel.ui.description)
  assert.deepEqual(panel, before)
  for (const value of ['', ' ', null, 7, { text: 'invalid' }]) {
    panel.ui.guidance = value
    assert.ok(validatePanelManifest(panel).some(error => error.includes('guidance must be nonempty text')))
  }
  delete panel.ui.guidance
  assert.deepEqual(validatePanelManifest(panel), [], 'guidance remains optional')
})

test('endpoint creation label translates only its explicit text slot and validates every resolved locale', () => {
  const panel = fixture()
  panel.ui.navigation_map = { edges: { label: '$t:title', source: 'from', new_label: '$t:newEdge' }, nodes: { label: 'caption' } }
  panel.i18n.messages['zh-CN'].newEdge = '前往{target}'
  panel.i18n.messages['en-US'].newEdge = '{source} to {target}'
  assert.ok(panelTranslationKeys(panel).includes('newEdge'))
  assert.deepEqual(validatePanelTranslations(panel, true), [])
  const localized = localizePanelManifest(panel, 'en-US')
  assert.equal(localized.ui.navigation_map.edges.new_label, '{source} to {target}')
  assert.equal(localized.ui.navigation_map.edges.label, '$t:title', 'bound field names do not translate')
  for (const value of ['', ' ', '{unknown}', 7]) {
    panel.i18n.messages['en-US'].newEdge = value
    assert.ok(validatePanelTranslations(panel, true).some(error => error.includes('new_label')))
  }
  const nested = { ...panel, ui: { component: 'panel_workspace', slots: { main: panel.ui } } }
  assert.ok(validatePanelTranslations(nested, true).some(error => error.includes('new_label')), 'slot composition must validate resolved labels too')
})

test('translation touches only display text, not ids, bindings, defaults or original declaration', () => {
  const manifest = fixture(), before = structuredClone(manifest)
  const translated = localizePanelManifest(manifest, 'en_GB')
  assert.equal(translated.ui.title, 'Rules')
  assert.equal(translated.fields[0].placeholder, '说明')
  assert.equal(translated.fields[0].custom_description, 'Custom')
  assert.equal(translated.sections[0].id, 'rules')
  assert.equal(translated.fields[0].key, 'title')
  assert.deepEqual(translated.initial_values, before.initial_values)
  assert.deepEqual(translated.sections[0].create, before.sections[0].create)
  assert.deepEqual(manifest, before)
  assert.deepEqual(panelTranslationKeys(manifest), ['title', 'help', 'custom'])
})

test('creation hints translate only text, preserve numbering and fall back without changing facts', () => {
  const panel = fixture()
  panel.sections[0].create.initial_label = { field: 'title', text: '$t:newRecord', numbered_text: '$t:newRecordNumbered' }
  Object.assign(panel.i18n.messages['zh-CN'], { newRecord: '新规则', newRecordNumbered: '新规则 {index}' })
  Object.assign(panel.i18n.messages['en-US'], { newRecord: 'New rule', newRecordNumbered: 'New rule {index}' })
  const before = structuredClone(panel)
  assert.ok(panelTranslationKeys(panel).includes('newRecordNumbered'))
  assert.deepEqual(validatePanelTranslations(panel, true), [])
  const translated = localizePanelManifest(panel, 'en-US')
  assert.deepEqual(translated.sections[0].create.initial_label, { field: 'title', text: 'New rule', numbered_text: 'New rule {index}' })
  assert.deepEqual(translated.sections[0].create.defaults, before.sections[0].create.defaults)
  assert.deepEqual(translated.initial_values, before.initial_values)
  assert.deepEqual(panel, before)
  panel.i18n.messages['en-US'].newRecord = ' '
  delete panel.i18n.messages['en-US'].newRecordNumbered
  assert.deepEqual(validatePanelTranslations(panel, true), [])
  assert.equal(localizePanelManifest(panel, 'en-US').sections[0].create.initial_label.text, '新规则')
  assert.equal(localizePanelManifest(panel, 'fr-FR').sections[0].create.initial_label.numbered_text, '新规则 {index}')
})

test('resolved creation hints reject unresolved tokens and unsupported placeholders', () => {
  const panel = fixture()
  panel.sections[0].create.initial_label = { field: 'title', text: '$t:newRecord', numbered_text: '$t:newRecordNumbered' }
  Object.assign(panel.i18n.messages['zh-CN'], { newRecord: '新规则', newRecordNumbered: '新规则 {index}' })
  for (const value of ['{index}', 'New $t:title', '$t:missing']) {
    panel.i18n.messages['en-US'].newRecord = value
    assert.ok(validatePanelTranslations(panel, true).some(error => error.includes('initial_label.text')))
  }
  panel.i18n.messages['en-US'].newRecord = 'New rule'
  for (const value of ['New rule', '{unknown}', '{index} {unknown}', '$t:missing']) {
    panel.i18n.messages['en-US'].newRecordNumbered = value
    assert.ok(validatePanelTranslations(panel, true).some(error => error.includes('initial_label.numbered_text')))
  }
  panel.i18n.messages['en-US'].newRecord = 7
  assert.ok(validatePanelTranslations(panel, true).some(error => error.includes('invalid message: en-US.newRecord')))
  delete panel.i18n.messages['zh-CN'].newRecord
  assert.ok(validatePanelTranslations(panel, true).some(error => error.includes('missing default translation: newRecord')))
})

test('unknown locale falls back; missing optional keys fall back; literal labels remain supported', () => {
  const manifest = fixture()
  assert.equal(localizePanelManifest(manifest, 'fr-FR').ui.title, '规则')
  delete manifest.i18n.messages['en-US'].title
  assert.deepEqual(validatePanelTranslations(manifest, true), [])
  assert.equal(localizePanelManifest(manifest, 'en-US').ui.title, '规则')
  manifest.fields[0].label = 'Custom literal'
  assert.equal(localizePanelManifest(manifest, 'en-US').fields[0].label, 'Custom literal')
})

test('missing default translations and unsafe resource declarations fail early', () => {
  const manifest = fixture()
  delete manifest.i18n.messages['zh-CN'].title
  assert.ok(validatePanelTranslations(manifest, true).some(error => error.includes('missing default translation: title')))
  manifest.i18n.locales['en-US'] = '../secret.json'
  assert.ok(validatePanelTranslations(manifest).some(error => error.includes('invalid locale resource')))
  delete manifest.i18n
  assert.deepEqual(validatePanelTranslations(manifest), ['translation tokens require i18n configuration'])
})

test('shared dictionaries have matching keys and interpolation placeholders', async () => {
  const { readFile } = await import('node:fs/promises')
  const dictionaries = await Promise.all(['zh-CN', 'en-US'].map(locale => readFile(new URL(`../../panel/src/locales/${locale}.json`, import.meta.url), 'utf8').then(JSON.parse)))
  const [zh, en] = dictionaries
  assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort())
  for (const key of Object.keys(zh)) {
    assert.ok(en[key].trim(), key)
    assert.deepEqual([...zh[key].matchAll(/\{([^}]+)\}/g)].map(match => match[1]).sort(), [...en[key].matchAll(/\{([^}]+)\}/g)].map(match => match[1]).sort(), key)
  }
})
