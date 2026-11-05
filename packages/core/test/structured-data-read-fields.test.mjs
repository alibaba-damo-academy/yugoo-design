import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { validatePanelManifest, parsePanelManifest } from '../src/panel-dsl.ts'
import { localizePanelManifest, validatePanelTranslations, panelTranslationKeys } from '../src/panel-i18n.ts'

const base = () => ({ version: 1, panel_kind: 'document', sections: [{ id: 'pages', title: 'Pages' }], fields: [],
  ui: { component: 'structured_data', id: 'facts', source: 'shared', read_fields: [
    { key: 'navigation', label: 'Navigation', item_label_field: 'label', fields: [
      { key: 'target_page_id', label: 'Destination', options_from_section: 'pages' },
      { key: 'icon_ref', label: 'Icon', collapsed: true },
    ] },
  ] } })

test('read_fields validates reading declarations without requiring or altering saved facts', () => {
  const manifest = base(), before = structuredClone(manifest)
  assert.deepEqual(validatePanelManifest(manifest), [])
  assert.deepEqual(manifest, before)
  delete manifest.ui.read_fields
  assert.deepEqual(validatePanelManifest(manifest), [], 'existing generic reader stays valid')
})

test('malformed, duplicate, unsafe and unresolved read declarations fail at their own boundary', () => {
  const cases = [
    [m => { m.ui.component = 'stack' }, /read_fields requires structured_data/],
    [m => { m.ui.read_fields = {} }, /read_fields must be a list/],
    [m => { m.ui.read_fields = [null] }, /invalid read field/],
    [m => { m.ui.read_fields.push(m.ui.read_fields[0]) }, /duplicate read field/],
    [m => { m.ui.read_fields[0].key = '__proto__' }, /safe direct property/],
    [m => { m.ui.read_fields[0].item_label_field = 'nested.label' }, /safe direct property/],
    [m => { m.ui.read_fields[0].label = '' }, /nonempty text/],
    [m => { m.ui.read_fields[0].fields[0].options_from_section = 'unknown' }, /unknown section/],
    [m => { m.ui.read_fields[0].collapsed = 'yes' }, /collapsed must be boolean/],
    [m => { m.ui.read_fields[0].editable = true }, /unknown read field option/],
    [m => { m.ui.read_fields = Array.from({ length: 101 }, (_, i) => ({ key: `k${i}`, label: 'Value' })) }, /at most 100/],
    [m => { let rows=m.ui.read_fields; for (let i=0;i<8;i++) { rows[0].fields=[{ key: 'child', label: 'Child' }]; rows=rows[0].fields } }, /eight levels/],
  ]
  for (const [mutate, expected] of cases) {
    const manifest = base(); mutate(manifest)
    assert.match(validatePanelManifest(manifest).join('\n'), expected)
  }
})

test('Page labels localize recursively while keys, IDs and section bindings stay exact', async () => {
  const directory = new URL('../../skills-web-app/bundles/page_design/', import.meta.url)
  const manifest = parsePanelManifest(await readFile(new URL('panel.yaml', directory), 'utf8'))
  manifest.i18n.messages = {}
  for (const [locale, path] of Object.entries(manifest.i18n.locales)) {
    manifest.i18n.messages[locale] = JSON.parse(await readFile(new URL(path, directory), 'utf8'))
    for (const key of panelTranslationKeys(manifest)) assert.ok(manifest.i18n.messages[locale][key], `${locale}.${key}`)
  }
  assert.deepEqual(validatePanelTranslations(manifest, true), [])
  const normalize = fields => fields.map(({ label, ...field }) => ({ ...field, ...(field.fields ? { fields: normalize(field.fields) } : {}) }))
  for (const locale of ['zh-CN', 'en-US']) {
    const localized = localizePanelManifest(manifest, locale), fields = localized.ui.children[0].read_fields
    assert.equal(fields[0].label, locale === 'zh-CN' ? '布局' : 'Layout')
    assert.equal(fields[2].fields[0].label, locale === 'zh-CN' ? '目标页面' : 'Target page')
    assert.deepEqual(normalize(fields), normalize(manifest.ui.children[0].read_fields))
    assert.deepEqual(localized.ui.navigation_map, manifest.ui.navigation_map.edges.new_label.startsWith('$t:')
      ? { ...manifest.ui.navigation_map, edges: { ...manifest.ui.navigation_map.edges, new_label: manifest.i18n.messages[locale].newConnectionLabel } }
      : manifest.ui.navigation_map)
    assert.deepEqual(localized.initial_values, manifest.initial_values)
  }
})
