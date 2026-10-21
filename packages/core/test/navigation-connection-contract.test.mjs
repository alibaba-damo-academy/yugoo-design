import { webAppBundleUrl } from './web-app-content-fixture.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { parsePanelManifest, validatePanelManifest } from '../src/panel-dsl.ts'

test('navigation connection policy validates booleans and rejects unknown capabilities', async () => {
  const panel = parsePanelManifest(await readFile(webAppBundleUrl('page_design/panel.yaml'), 'utf8'))
  for (const policy of [undefined, {}, { allow_self: false }, { allow_parallel: true }, { allow_self: false, allow_parallel: false }]) {
    panel.ui.navigation_map.connection_policy = policy
    assert.deepEqual(validatePanelManifest(panel), [])
  }
  for (const policy of [null, [], true, 'false', { allow_self: 'false' }, { allow_parallel: 0 }, { unknown: true }]) {
    panel.ui.navigation_map.connection_policy = policy
    assert.ok(validatePanelManifest(panel).some(error => error.includes('connection policy')), JSON.stringify(policy))
  }
})

test('creation labels accept fixed endpoint placeholders and existing translation references only', async () => {
  const panel = parsePanelManifest(await readFile(webAppBundleUrl('page_design/panel.yaml'), 'utf8'))
  for (const value of [undefined, 'Connect', '{source} → {target}', '$t:newConnectionLabel']) {
    panel.ui.navigation_map.edges.new_label = value
    assert.deepEqual(validatePanelManifest(panel), [])
  }
  for (const value of ['', ' ', 2, null, {}, '{unknown}', '{target.name}', '{target', '$t:']) {
    panel.ui.navigation_map.edges.new_label = value
    assert.ok(validatePanelManifest(panel).some(error => error.includes('navigation binding')), JSON.stringify(value))
  }
})
