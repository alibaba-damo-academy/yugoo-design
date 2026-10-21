import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { parsePanelManifest } from '../src/panel-dsl.ts'
import { autoPanelSnapshot, preserveAutoPanelDefinition, readSavedAutoPanelDefinition,
  validateSavedAutoPanelEdit } from '../src/auto-panel-spec.ts'

const docs = readFileSync(new URL('../../../docs/dsl-spec.md', import.meta.url), 'utf8')
const section = docs.split('### Schema binding for `select` and `radio`')[1]
  .split('### Field extensions')[0]
const fields = section.match(/```yaml\n([\s\S]*?)\n```/)[1]
const property = JSON.parse(section.match(/```json\n([\s\S]*?)\n```/)[1])
const manifestSource = `version: 1
panel_kind: evidence_workbook
sections:
  - {id: devices, title: Devices, add_mode: none}
${fields}
ui:
  component: record_form
  id: observations
  title: Observations
  source: devices
`
const state = { devices: { device_01: { status: 'normal' } } }
const context = spec => ({ kit: 'observations', kitVersion: '1.0',
  bundle: 'observations', bundleVersion: '1.0', state,
  schema: { type: 'object', properties: { devices: { type: 'map', value: {
    type: 'object', properties: { status: spec } } } } } })
const envelope = manifest => [
  { version: 'v0.9', createSurface: { surfaceId: 'auto-panel',
    catalogId: 'urn:dsh:panel-catalog:design-files:v1', sendDataModel: false } },
  { version: 'v0.9', updateComponents: { surfaceId: 'auto-panel',
    components: [{ id: 'root', component: 'DesignPanel', manifest }] } },
]

test('documented enum binding roundtrips and edits for select and radio', () => {
  for (const control of ['select', 'radio']) {
    const manifest = parsePanelManifest(manifestSource.replace('control: select', `control: ${control}`))
    const ctx = context(property)
    const retained = preserveAutoPanelDefinition(autoPanelSnapshot(ctx, envelope(manifest)), ctx)
    assert.deepEqual(readSavedAutoPanelDefinition(retained, ctx).manifest, manifest)
    const edited = structuredClone(state)
    edited.devices.device_01.status = 'anomaly'
    validateSavedAutoPanelEdit(retained, ctx, edited)
  }
})

test('incorrect enum vocabulary and mismatched options hit the documented schema error', () => {
  const manifest = parsePanelManifest(manifestSource)
  for (const spec of [
    { type: 'string', enum: ['normal', 'anomaly'] },
    { type: 'enum' }, { type: 'enum', values: [] },
    { type: 'enum', values: ['normal'] },
    { type: 'enum', values: ['normal', 'other'] },
  ]) assert.throws(() => autoPanelSnapshot(context(spec), envelope(manifest)),
    /auto panel: field "status" does not match schema/)
})

test('options on text fail parsing instead of being treated as an enum binding', () => {
  assert.throws(() => parsePanelManifest(manifestSource.replace('control: select', 'control: text')),
    /field "status" control "text" does not consume options/)
})
