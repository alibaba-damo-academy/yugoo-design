import test from 'node:test'
import assert from 'node:assert/strict'
import { validatePanelManifest, localizePanelManifest, panelTranslationKeys } from '../src/panel-dsl.ts'
import { autoPanelSnapshot, exportAutoPanelDsl } from '../src/auto-panel-spec.ts'

export const fixture = () => ({ version: 1, panel_kind: 'document', sections: [{ id: 'entries', title: 'Entries',
  form: { body: [{ kind: 'group', items: [{ kind: 'field', field: 'description' }],
    sidecar: { component: 'record_preview', title: '$t:preview', preview: { title: 'caption', body: 'description', action: 'destination', empty: '$t:empty' } } }] } }],
  fields: ['caption', 'description', 'destination'].map(key => ({ key, label: key, control: key === 'description' ? 'textarea' : 'text', applies_to: ['entries'] })),
  i18n: { default_locale: 'zh-CN', locales: { 'zh-CN': 'locales/zh-CN.json', 'en-US': 'locales/en-US.json' },
    messages: { 'zh-CN': { preview: '预览', empty: '空内容' }, 'en-US': { preview: 'Preview', empty: 'Empty' } } },
  ui: { component: 'record_form', id: 'entry-form', source: 'entries' } })

test('closed group sidecar binds only unconditional same-section text and preserves localization bindings', () => {
  const panel = fixture()
  assert.deepEqual(validatePanelManifest(panel), [])
  assert.deepEqual(panelTranslationKeys(panel).sort(), ['empty', 'preview'])
  const localized = localizePanelManifest(panel, 'en-US').sections[0].form.body[0].sidecar
  assert.equal(localized.title, 'Preview'); assert.equal(localized.preview.empty, 'Empty')
  assert.equal(localized.preview.title, 'caption'); assert.equal(localized.preview.body, 'description')
  for (const mutate of [
    s => { s.source = 'other' }, s => { s.script = 'execute' }, s => { s.component = 'text' },
    s => { s.title = [] }, s => { s.preview = null }, s => { s.preview.title = 'other.caption' },
    s => { s.preview.body = 'missing' }, s => { s.preview.action = {} },
    s => { s.preview.empty = '' }, s => { s.preview.execute = true },
  ]) {
    const bad = fixture(); mutate(bad.sections[0].form.body[0].sidecar)
    assert.ok(validatePanelManifest(bad).some(message => message.includes('sidecar')), JSON.stringify(bad))
  }
  for (const spec of [{ hidden: true }, { visible_when: { field: 'caption', in: ['show'] } }, { control: 'toggle' }, { applies_to: [] }]) {
    const bad = fixture(); Object.assign(bad.fields[1], spec)
    assert.ok(validatePanelManifest(bad).some(message => message.includes('sidecar')))
  }
})

test('generated A2UI rejects sidecar on creation and retained export without dropping static capabilities', () => {
  const panel = fixture(); delete panel.i18n
  const group = panel.sections[0].form.body[0]; group.sidecar.title = 'Preview'; group.sidecar.preview.empty = 'Empty'
  const context = { kit: 'neutral', kitVersion: '1.0', bundle: 'entries', bundleVersion: '1.0',
    schema: { type: 'object', properties: { entries: { type: 'map', value: { type: 'object', properties: Object.fromEntries(panel.fields.map(field => [field.key, { type: 'string' }])) } } } },
    state: { entries: { a: { caption: 'A', description: 'Body', destination: 'Target' } } } }
  const messages = manifest => [
    { version: 'v0.9', createSurface: { surfaceId: 'auto-panel', catalogId: 'urn:dsh:panel-catalog:design-files:v1', sendDataModel: false } },
    { version: 'v0.9', updateComponents: { surfaceId: 'auto-panel', components: [{ id: 'root', component: 'DesignPanel', manifest }] } },
  ]
  assert.throws(() => autoPanelSnapshot(context, messages(panel)), /unsupported generated section binding/)
  const legacy = structuredClone(panel); delete legacy.sections[0].form
  const retained = autoPanelSnapshot(context, messages(legacy))
  retained.messages[1].updateComponents.components[0].manifest.sections[0].form = panel.sections[0].form
  assert.throws(() => exportAutoPanelDsl(retained, context), /unsupported generated section binding/)
})
