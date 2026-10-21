import { webAppBundleUrl } from './web-app-content-fixture.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { parsePanelManifest, validatePanelManifest } from '../src/panel-dsl.ts'
import { localizePanelManifest, panelTranslationKeys } from '../src/panel-i18n.ts'

const fixture = async () => parsePanelManifest(await readFile(webAppBundleUrl('page_design/panel.yaml'), 'utf8'))
test('explicit navigation grouping has safe read-only paths and distinct record fields', async () => {
  const panel = await fixture()
  assert.deepEqual(validatePanelManifest(panel), [])
  for (const grouping of [null, [], {}, { path: 'menu', target: 'a', label: 'a' },
    { path: '__proto__.menu', target: 'id', label: 'name' },
    { path: 'menu', target: 'x.y', label: 'name' }, { path: 'menu', target: 'id', label: 4 }]) {
    const invalid = structuredClone(panel); invalid.ui.navigation_map.grouping = grouping
    assert.ok(validatePanelManifest(invalid).some(error => error.includes('grouping')), JSON.stringify(grouping))
  }
})
test('navigation binding labels are never interpreted as display translations', async () => {
  const panel = await fixture()
  panel.ui.navigation_map.grouping.label = '$t:binding-is-not-copy'
  panel.i18n.messages = { 'zh-CN': { 'binding-is-not-copy': 'Wrong' }, 'en-US': { 'binding-is-not-copy': 'Wrong' } }
  assert.ok(!panelTranslationKeys(panel).includes('binding-is-not-copy'))
  assert.deepEqual(localizePanelManifest(panel, 'en-US').ui.navigation_map, panel.ui.navigation_map)
})
