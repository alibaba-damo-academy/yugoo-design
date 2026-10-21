import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir, stat, realpath } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import { validatePanelManifest, localizePanelManifest } from '../src/panel-dsl.ts'
import { loadDesignKit } from '../src/kit-loader.ts'
import { autoPanelSnapshot, exportAutoPanelDsl } from '../src/auto-panel-spec.ts'

const base = () => ({ version: 1, panel_kind: 'document', sections: [{ id: 'entries', title: 'Entries', order: 'entry_order',
  form: { reorder: false, header: { variant: 'detail', title: { field: 'caption', editable: true } } } }],
  fields: [{ key: 'caption', control: 'text', applies_to: ['entries'] }],
  ui: { id: 'form', component: 'record_form', source: 'entries' } })

test('headers are explicit closed bindings, and omitted form keeps default declarations valid', () => {
  assert.deepEqual(validatePanelManifest(base()), [])
  const legacy = base(); delete legacy.sections[0].form
  assert.deepEqual(validatePanelManifest(legacy), [])
  const card = base(); card.sections[0].form.header = { variant: 'card', title: { text: 'Note', numbered: true } }
  assert.deepEqual(validatePanelManifest(card), [])
  for (const change of [
    p => { p.sections[0].form.reorder = 'false' },
    p => { p.sections[0].form.script = 'not allowed' },
    p => { p.sections[0].form.header.variant = 'invented' },
    p => { p.sections[0].form.header.title = { field: 'caption', text: 'Duplicate' } },
    p => { p.sections[0].form.header.title.field = 'other.caption' },
    p => { p.sections[0].form.header.title.field = 'id' },
    p => { p.sections[0].form.header.title.field = 'missing' },
    p => { p.fields[0].applies_to = [] },
    p => { p.fields[0].readonly = true },
    p => { p.fields[0].hidden = true },
    p => { p.fields[0].visible_when = { field: 'caption', in: ['show'] } },
    p => { p.fields[0].control = 'textarea' },
    p => { p.sections[0].derived_fields = { caption: { parts: [{ field: 'caption' }] } } },
    p => { p.sections[0].form.header.title.editable = 'true' },
    p => { p.sections[0].form.header.title = { text: '', numbered: true } },
  ]) {
    const panel = base(); change(panel)
    assert.ok(validatePanelManifest(panel).some(error => error.includes('.form')), JSON.stringify(panel))
  }
})

const root = fileURLToPath(new URL('../../skills-web-app', import.meta.url))
const fs = { readText: async path => { try { return await readFile(path, 'utf8') } catch (e) { if (e.code !== 'ENOENT') throw e } },
  listDir: readdir, isDirectory: async path => (await stat(path)).isDirectory(), realPath: realpath }
const load = titleSpec => loadDesignKit({ ...fs, readText: async path => {
  const text = await fs.readText(path)
  if (!titleSpec || !path.endsWith('/role_access/schema.yaml')) return text
  const schema = parse(text)
  schema.properties.roles.value.properties.title = titleSpec
  return JSON.stringify(schema)
} }, root, { sourceId: 'fixture:record-header' })

test('actual Kit loader resolves role header text in both locales and enforces title schema safety', async () => {
  const kit = await load()
  const role = kit.skills.find(skill => skill.name === 'role_access').metadata.panelManifest
  const rules = kit.skills.find(skill => skill.name === 'business_rules').metadata.panelManifest
  for (const [locale, text] of [['zh-CN', '权限'], ['en-US', 'Permission']]) {
    const panel = localizePanelManifest(role, locale)
    assert.deepEqual(validatePanelManifest(panel), [])
    assert.deepEqual(panel.sections[0].form.header.title, { field: 'title', editable: true })
    assert.equal(panel.sections[1].form.header.title.text, text)
    assert.equal(panel.sections[0].form.reorder, false)
    assert.equal(panel.sections[1].form.reorder, false)
    assert.equal(panel.sections[0].order, 'role_order')
    assert.equal(panel.sections[1].order, 'policy_order')
    const localizedRules = localizePanelManifest(rules, locale)
    assert.deepEqual(validatePanelManifest(localizedRules), [])
    assert.equal(localizedRules.sections[0].form.reorder, false)
    assert.deepEqual(localizedRules.sections[0].form.header, { variant: 'detail', title: { field: 'title', editable: true } })
    assert.equal(localizedRules.sections[0].form.body[0].title, locale === 'zh-CN' ? '规则内容' : 'Rule content')
    assert.deepEqual(localizedRules.sections[0].form.body[0].items.map(item => item.field), ['condition', 'outcome'])
    assert.deepEqual(localizedRules.sections[0].form.body[1].items, [{kind: 'field', field: 'notes', label: 'visually_hidden'}])
    assert.equal(localizedRules.sections[0].order, 'rule_order', 'hiding moves preserves durable rule order')
    assert.deepEqual(localizedRules.fields.map(field => field.key), ['title', 'condition', 'outcome', 'notes'])
  }
  for (const spec of [{ type: 'number' }, { type: 'string', knowledge: { role: 'metadata' } },
    { type: 'string', knowledge: { role: 'reference', target: '#/roles' } }]) {
    await assert.rejects(load(spec), /editable header title/)
  }
})

test('unsupported static form extension is rejected in A2UI export rather than silently discarded', () => {
  const context = { kit: 'neutral', kitVersion: '1.0', bundle: 'entries', bundleVersion: '1.0',
    schema: { type: 'object', properties: { entries: { type: 'map', value: { type: 'object', properties: { caption: { type: 'string' } } } } } },
    state: { entries: { a: { caption: 'Existing fact' } } } }
  const panel = base(); delete panel.sections[0].order
  const messages = manifest => [
    { version: 'v0.9', createSurface: { surfaceId: 'auto-panel', catalogId: 'urn:dsh:panel-catalog:design-files:v1', sendDataModel: false } },
    { version: 'v0.9', updateComponents: { surfaceId: 'auto-panel', components: [{ id: 'root', component: 'DesignPanel', manifest }] } },
  ]
  assert.throws(() => autoPanelSnapshot(context, messages(panel)), /unsupported generated section binding/)
  const legacy = structuredClone(panel); delete legacy.sections[0].form
  const snapshot = autoPanelSnapshot(context, messages(legacy))
  assert.deepEqual(JSON.parse(exportAutoPanelDsl(snapshot, context)), legacy)
  snapshot.messages[1].updateComponents.components[0].manifest.sections[0].form = panel.sections[0].form
  assert.throws(() => exportAutoPanelDsl(snapshot, context), /unsupported generated section binding/)
})
