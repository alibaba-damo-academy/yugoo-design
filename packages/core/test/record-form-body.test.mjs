import { webAppBundleUrl } from './web-app-content-fixture.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { validatePanelManifest, parsePanelManifest, localizePanelManifest, panelTranslationKeys, validatePanelTranslations } from '../src/panel-dsl.ts'
import { autoPanelSnapshot, exportAutoPanelDsl } from '../src/auto-panel-spec.ts'

const base = () => ({ version: 1, panel_kind: 'document', sections: [{ id: 'items', title: 'Items',
  form: { header: { variant: 'detail', title: { field: 'caption', editable: true } }, body: [
    { kind: 'row', items: [{ kind: 'text', text: 'Decision' }, { kind: 'field', field: 'decision', label: 'visually_hidden', width: 'auto' }] },
    { kind: 'group', title: 'Details', separator: true, items: [{ kind: 'field', field: 'detail', label: 'inline' }] },
  ] } }], fields: [
    { key: 'caption', control: 'text', applies_to: ['items'] },
    { key: 'decision', control: 'select', allow_clear: false, options: [{ value: 'yes', label: 'Yes' }], applies_to: ['items'] },
    { key: 'detail', control: 'text', visible_when: { field: 'decision', in: ['yes'] }, clear_when_hidden: true, applies_to: ['items'] },
    { key: 'note', control: 'text', applies_to: ['items'] },
  ], ui: { component: 'record_form', id: 'form', source: 'items' } })

test('record tabs retain bounded same-record bindings and localized disclosure titles', () => {
  const panel = base()
  panel.sections[0].form.body = [{ kind: 'tabs', id: 'design', title: 'Design', tabs: [
    { id: 'overview', title: 'Overview', items: [{ kind: 'field', field: 'decision' }] },
    { id: 'detail', title: 'Detail', items: [{ kind: 'group', title: 'Optional detail', collapsible: true, items: [{ kind: 'field', field: 'detail' }] }] },
  ] }]
  assert.deepEqual(validatePanelManifest(panel), [])
  for (const change of [
    p => { p.sections[0].form.body[0].tabs = [] },
    p => { p.sections[0].form.body[0].tabs[1].id = 'overview' },
    p => { p.sections[0].form.body[0].tabs[1].items = [] },
    p => { p.sections[0].form.body[0].tabs[1].items[0].items[0].field = 'decision' },
    p => { p.sections[0].form.body[0].tabs[1].items[0].items[0].field = 'caption' },
    p => { p.sections[0].form.body[0].tabs[1].items[0].items[0].field = 'other.value' },
    p => { p.sections[0].form.body[0].tabs[1].items[0].collapsible = 'yes' },
    p => { delete p.sections[0].form.body[0].tabs[1].items[0].title },
    p => { p.sections[0].form.body[0].tabs[1].items = [structuredClone(p.sections[0].form.body[0])] },
  ]) { const invalid = structuredClone(panel); change(invalid); assert.ok(validatePanelManifest(invalid).length, JSON.stringify(invalid)) }
  panel.sections[0].form.body[0].tabs[0].title = '$t:overview'
  panel.i18n = { default_locale: 'en-US', locales: { 'en-US': 'locales/en-US.json' }, messages: { 'en-US': { overview: 'Experience' } } }
  assert.deepEqual(validatePanelTranslations(panel, true), [])
  assert.equal(localizePanelManifest(panel, 'en-US').sections[0].form.body[0].tabs[0].title, 'Experience')
  assert.equal(localizePanelManifest(panel, 'en-US').sections[0].form.body[0].tabs[0].id, 'overview')
})

test('section-specific requirements are bounded presentation, never competing field bindings', () => {
  const base = { version: 1, panel_kind: 'document', sections: [{ id: 'items', title: 'Items' }, { id: 'links', title: 'Links' }],
    fields: [{ key: 'description', control: 'textarea', required_in: ['items'], applies_to: ['items', 'links'] }],
    ui: { id: 'form', component: 'record_form', source: 'items' } }
  assert.deepEqual(validatePanelManifest(base), [])
  for (const change of [
    p => { p.fields[0].required = true }, p => { p.fields[0].required = false },
    p => { p.fields[0].required_in = [] }, p => { p.fields[0].required_in = ['items', 'items'] },
    p => { p.fields[0].required_in = ['missing'] }, p => { p.fields[0].applies_to = ['links'] },
    p => { p.fields[0].required_in = 'items' }, p => { p.fields[0].applies_to = 5 },
  ]) { const panel = structuredClone(base); change(panel); assert.ok(validatePanelManifest(panel).some(error => error.includes('required')), JSON.stringify(panel)) }
  const ordinary = structuredClone(base); delete ordinary.fields[0].required_in; ordinary.fields[0].required = 'yes'
  assert.ok(validatePanelManifest(ordinary).some(error => error.includes('required must be boolean')))
})

test('finite body references validate without suppressing legacy or conditional fields', () => {
  assert.deepEqual(validatePanelManifest(base()), [])
  const legacy = base(); delete legacy.sections[0].form; delete legacy.fields[1].allow_clear
  assert.deepEqual(validatePanelManifest(legacy), [])
  for (const change of [
    p => { p.sections[0].form.body = {} },
    p => { p.sections[0].form.body[0].script = 'bad' },
    p => { p.sections[0].form.body[0].items = [] },
    p => { p.sections[0].form.body[0].items[0].text = '' },
    p => { p.sections[0].form.body[0].items[1].field = 'outside.decision' },
    p => { p.sections[0].form.body[0].items[1].field = 'absent' },
    p => { p.sections[0].form.body[0].items[1].label = 'none' },
    p => { p.sections[0].form.body[0].items[1].label = ['inline'] },
    p => { p.sections[0].form.body[0].items[1].label = { value: 'inline' } },
    p => { p.sections[0].form.body[0].items[1].width = '200px' },
    p => { p.sections[0].form.body[0].items[1].width = ['fill'] },
    p => { p.sections[0].form.body[0].items[1].width = { value: 'fill' } },
    p => { p.fields[1].hidden = true },
    p => { p.fields[1].applies_to = [] },
    p => { p.sections[0].form.body.push({ kind: 'field', field: 'decision' }) },
    p => { p.sections[0].form.body.push({ kind: 'field', field: 'caption' }) },
    p => { p.sections[0].form.body[1].items.push({ kind: 'group', items: [{ kind: 'field', field: 'note' }] }) },
    p => { p.sections[0].form.body[0].items.push({ kind: 'row', items: [{ kind: 'field', field: 'note' }] }) },
    p => { p.sections[0].form.body[1].separator = 'true' },
    p => { p.sections[0].form.body[1].description = 2 },
  ]) {
    const panel = base(); change(panel)
    assert.ok(validatePanelManifest(panel).some(error => error.includes('.form')), JSON.stringify(panel))
  }
  const malformed = base(); malformed.sections[0].form.header.title = 'invalid'
  assert.ok(validatePanelManifest(malformed).length, 'malformed header with body reports, does not throw')
  for (const config of [{ choice_layout: 'row_scroll' }, { custom_focus: true }, { allow_clear: true }]) {
    const panel = base(); Object.assign(panel.fields[0], config)
    assert.ok(validatePanelManifest(panel).length)
  }
  for (const layout of ['column', 'row_wrap', 'row_scroll']) {
    const panel = base(); Object.assign(panel.fields[1], { control: 'radio', choice_layout: layout }); delete panel.fields[1].allow_clear
    assert.deepEqual(validatePanelManifest(panel), [])
  }
  const custom = base(); Object.assign(custom.fields[1], { control: 'radio_custom', custom_focus: true, choice_layout: 'row_scroll' }); delete custom.fields[1].allow_clear
  assert.deepEqual(validatePanelManifest(custom), [])
})

test('real role body uses the shared display-text projection in both languages without translating canonical bindings', () => {
  const panel = parsePanelManifest(readFileSync(webAppBundleUrl('role_access/panel.yaml'), 'utf8'))
  panel.i18n.messages = Object.fromEntries(['zh-CN', 'en-US'].map(locale => [locale,
    JSON.parse(readFileSync(webAppBundleUrl(`role_access/locales/${locale}.json`), 'utf8'))]))
  assert.deepEqual(validatePanelTranslations(panel, true), [])
  for (const key of ['assignment', 'assignmentHelp', 'effect']) assert.ok(panelTranslationKeys(panel).includes(key))
  for (const locale of ['zh-CN', 'en-US']) {
    const localized = localizePanelManifest(panel, locale)
    assert.deepEqual(validatePanelManifest(localized), [])
    assert.equal(localized.sections[0].form.body[0].title, panel.i18n.messages[locale].assignment)
    assert.equal(localized.sections[0].form.body[0].description, panel.i18n.messages[locale].assignmentHelp)
    assert.equal(localized.sections[1].form.body[0].items[0].text, panel.i18n.messages[locale].effect)
    assert.equal(localized.sections[1].form.body[0].items[1].field, 'effect')
    assert.deepEqual(localized.sections[1].derived_fields, panel.sections[1].derived_fields)
    assert.deepEqual(localized.fields.find(f => f.key === 'assignment_rule').options.map(o => o.value), ['注册后自动拥有', '由管理员授予'])
  }
  // Isolate new body tokens from other labels to prove recursive collection/fallback.
  const translated = base(); translated.sections[0].form.body[1].title = '$t:bodyTitle'; translated.sections[0].form.body[1].description = '$t:bodyHelp'
  translated.sections[0].form.body[0].items[0].text = '$t:prefix'
  translated.i18n = { default_locale: 'zh-CN', locales: { 'zh-CN': 'locales/zh-CN.json', 'en-US': 'locales/en-US.json' },
    messages: { 'zh-CN': { bodyTitle: '详情', bodyHelp: '帮助', prefix: '决定' }, 'en-US': { bodyTitle: 'Details', prefix: 'Decision' } } }
  assert.deepEqual(panelTranslationKeys(translated).sort(), ['bodyHelp', 'bodyTitle', 'prefix'])
  assert.equal(localizePanelManifest(translated, 'en-US').sections[0].form.body[1].description, '帮助')
  delete translated.i18n.messages['zh-CN'].bodyHelp
  assert.ok(validatePanelTranslations(translated, true).some(error => error.includes('bodyHelp')))
})

test('generated-origin export explicitly rejects static body and field presentation rather than silently losing them', () => {
  const manifest = { version: 1, panel_kind: 'document', sections: [{ id: 'entries', title: 'Entries' }],
    fields: [{ key: 'decision', control: 'select', options: [{ value: 'yes', label: 'Yes' }], applies_to: ['entries'] }],
    ui: { id: 'form', component: 'record_form', source: 'entries' } }
  const context = { kit: 'neutral', kitVersion: '1.0', bundle: 'entries', bundleVersion: '1.0',
    schema: { type: 'object', properties: { entries: { type: 'map', value: { type: 'object', properties: { decision: { type: 'enum', values: ['yes'] } } } } } },
    state: { entries: { a: { decision: 'yes' } } } }
  const messages = view => [
    { version: 'v0.9', createSurface: { surfaceId: 'auto-panel', catalogId: 'urn:dsh:panel-catalog:design-files:v1', sendDataModel: false } },
    { version: 'v0.9', updateComponents: { surfaceId: 'auto-panel', components: [{ id: 'root', component: 'DesignPanel', manifest: view }] } },
  ]
  const snapshot = autoPanelSnapshot(context, messages(manifest))
  assert.deepEqual(JSON.parse(exportAutoPanelDsl(snapshot, context)), manifest)
  for (const change of [
    p => { p.sections[0].form = { body: [{ kind: 'field', field: 'decision' }] } },
    p => { p.fields[0].allow_clear = false },
    p => { p.fields[0].required_in = ['entries'] },
    p => { p.fields[0].control = 'radio'; p.fields[0].choice_layout = 'row_wrap' },
  ]) {
    const view = structuredClone(manifest); change(view)
    assert.deepEqual(validatePanelManifest(view), [])
    assert.throws(() => autoPanelSnapshot(context, messages(view)), /unsupported generated/)
    const retained = structuredClone(snapshot); retained.messages[1].updateComponents.components[0].manifest = view
    assert.throws(() => exportAutoPanelDsl(retained, context), /unsupported generated/)
  }
})
