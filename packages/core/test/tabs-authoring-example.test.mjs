import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { parsePanelManifest } from '../src/panel-dsl.ts'
import { autoPanelSnapshot, preserveAutoPanelDefinition, readSavedAutoPanelDefinition,
  validateSavedAutoPanelEdit } from '../src/auto-panel-spec.ts'
import { inspectPanelComponent } from '../../../.agents/skills/design-bundle-creator/scripts/inspect-panel-component.mjs'

const repo = fileURLToPath(new URL('../../../', import.meta.url))
test('tabs on-demand docs return a dedicated validated non-Web composition, not broad fallback', async () => {
  const docs = await inspectPanelComponent(repo, 'tabs', undefined, { documentationOnly: true })
  assert.equal(docs.documentation.coverage, 'dedicated-component-section')
  assert.equal(docs.documentation.sections.length, 1)
  const section = docs.documentation.sections[0].content
  assert.match(section, /mounted views with stable identities/)
  assert.doesNotMatch(section, /question_policy|navigation_map/)
  const yaml = /```yaml\n([\s\S]*?)\n```/.exec(section)?.[1]
  assert.ok(yaml, 'the discoverable example is the one actually validated')
  const manifest = parsePanelManifest(yaml)
  const context = { kit: 'equipment_notes', kitVersion: '1.0', bundle: 'inspection_notes', bundleVersion: '1.0',
    schema: { type: 'object', required: ['equipment'], additional_properties: false, properties: {
      equipment: { type: 'map', value: { type: 'object', required: ['title', 'note'], additional_properties: false,
        properties: { title: { type: 'string' }, note: { type: 'string' } } } },
    } }, state: { equipment: { pump_a: { title: 'Synthetic pump', note: '' } } } }
  const snapshot = autoPanelSnapshot(context, [
    { version: 'v0.9', createSurface: { surfaceId: 'auto-panel', catalogId: 'urn:dsh:panel-catalog:design-files:v1', sendDataModel: false } },
    { version: 'v0.9', updateComponents: { surfaceId: 'auto-panel', components: [{ id: 'root', component: 'DesignPanel', manifest }] } },
  ])
  const retained = preserveAutoPanelDefinition(snapshot, context)
  assert.deepEqual(readSavedAutoPanelDefinition(retained, context).manifest, manifest)
  assert.doesNotThrow(() => validateSavedAutoPanelEdit(retained, context,
    { equipment: { pump_a: { title: 'Synthetic pump', note: 'Observation awaiting confirmation' } } }))
  assert.throws(() => validateSavedAutoPanelEdit(retained, context, { equipment: {} }), /identities/)
  const invalid = structuredClone(manifest)
  invalid.ui.children[1].id = 'guidance'
  assert.throws(() => parsePanelManifest(JSON.stringify(invalid)), /duplicate tabs child id/)
  assert.equal((await readFile(new URL('../../../docs/dsl-spec.md', import.meta.url), 'utf8')).includes(yaml), true)
})
