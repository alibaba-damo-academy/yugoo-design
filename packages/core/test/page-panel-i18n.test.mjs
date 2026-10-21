import { webAppBundleUrl } from './web-app-content-fixture.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { parsePanelManifest } from '../src/panel-dsl.ts'
import { localizePanelManifest, panelTranslationKeys, validatePanelTranslations } from '../src/panel-i18n.ts'

test('Page panel locales cover all tokens without changing navigation or canonical bindings', async () => {
  const base = webAppBundleUrl('page_design/')
  const manifest = parsePanelManifest(await readFile(new URL('panel.yaml', base), 'utf8'))
  manifest.i18n.messages = {}
  for (const [locale, path] of Object.entries(manifest.i18n.locales)) {
    const messages = JSON.parse(await readFile(new URL(path, base), 'utf8'))
    for (const key of panelTranslationKeys(manifest)) assert.ok(messages[key], `${locale}: ${key}`)
    manifest.i18n.messages[locale] = messages
  }
  assert.deepEqual(validatePanelTranslations(manifest, true), [])
  const en = localizePanelManifest(manifest, 'en-US'), zh = localizePanelManifest(manifest, 'zh-CN')
  assert.equal(en.ui.title, 'Page map')
  assert.equal(zh.ui.title, '页面地图')
  assert.equal(en.ui.children[0].title, 'Shared specification')
  assert.equal(en.ui.navigation_map.edges.new_label, 'Go to {target}')
  assert.equal(zh.ui.navigation_map.edges.new_label, '前往{target}')
  for (const localized of [en, zh]) {
    const bindings = structuredClone(localized.ui.navigation_map)
    // Only this display template is localized; every canonical binding remains exact.
    bindings.edges.new_label = manifest.ui.navigation_map.edges.new_label
    assert.deepEqual(bindings, manifest.ui.navigation_map)
    assert.deepEqual(localized.initial_values, manifest.initial_values)
    assert.deepEqual(localized.fields.map(field => field.key), manifest.fields.map(field => field.key))
    assert.deepEqual(localized.fields.find(field => field.key === 'page_type').options.map(option => option.value),
      manifest.fields.find(field => field.key === 'page_type').options.map(option => option.value))
  }
})
