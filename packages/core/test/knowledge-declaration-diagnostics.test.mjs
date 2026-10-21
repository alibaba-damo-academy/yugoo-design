import test from 'node:test'
import assert from 'node:assert/strict'
import { diagnoseKnowledgeDeclarations } from '../src/knowledge-declaration-diagnostics.ts'

const records = properties => ({ type: 'map', value: { type: 'object', properties } })
function fixture(knowledge) {
  return { name: 'runtime', catalogName: 'catalog_fork', metadata: {
    schemaDocument: { type: 'object', properties: {
      sections: { type: 'object', properties: { rows: records({ details: { type: 'object', properties: {
        link: { type: 'string', ...(knowledge ? { knowledge } : {}) },
      } } }) } }, roles: records({ title: { type: 'string' } }), other: records({ title: { type: 'string' } }),
    } },
    panelManifest: { sections: [
      { id: 'rows', records_path: 'sections.rows', fields_path: 'details' },
      { id: 'roles' }, { id: 'other' },
    ], fields: [{ key: 'link', control: 'record_select', options_from_section: 'roles', applies_to: ['rows'] }] },
  } }
}
const leaf = f => f.metadata.schemaDocument.properties.sections.properties.rows.value.properties.details.properties.link

test('direct single-target declarations report stable locations without mutating sources', () => {
  for (const [knowledge, code] of [[undefined, 'knowledge.reference_role'], [{ role: 'reference' }, 'knowledge.reference_target'],
    [{ role: 'reference', target: '#/other' }, 'knowledge.reference_target']]) {
    const f = fixture(knowledge), before = structuredClone(f)
    const result = diagnoseKnowledgeDeclarations([f])
    assert.equal(result.length, 1)
    assert.equal(result[0].code, code)
    assert.equal(result[0].subject, 'runtime')
    assert.equal(result[0].schemaPointer, '/properties/sections/properties/rows/value/properties/details/properties/link')
    assert.equal(result[0].panelSection, 'rows')
    assert.equal(result[0].expectedTarget, 'runtime/runtime.json#/roles', 'canonical runtime name, not catalog fork identity')
    assert.match(result[0].message, /schema.yaml#.*panel.yaml section rows field link/)
    assert.deepEqual(f, before)
    assert.deepEqual(diagnoseKnowledgeDeclarations([f]), result)
  }
})

test('matching local/full references and cross-Bundle runtime bindings are accepted', () => {
  for (const target of ['#/roles', 'runtime/runtime.json#/roles']) assert.deepEqual(diagnoseKnowledgeDeclarations([fixture({ role: 'reference', target })]), [])
  const f = fixture({ role: 'reference', target: 'target_runtime/target_runtime.json#/roles' })
  f.metadata.panelManifest.fields[0].options_from_panel = { panel_type: 'target_runtime', section_id: 'roles' }
  delete f.metadata.panelManifest.fields[0].options_from_section
  const target = { ...fixture(), name: 'target_runtime', catalogName: 'independent_target_fork' }
  target.metadata.panelManifest.fields = []
  assert.deepEqual(diagnoseKnowledgeDeclarations([f, target]), [])
  f.metadata.panelManifest.fields[0].options_from_panel.panel_type = 'independent_target_fork'
  assert.deepEqual(diagnoseKnowledgeDeclarations([f, target]), [], 'unresolved identity is not guessed')
})

test('multi-select items are checked once across aliases of the same canonical field', () => {
  const f = fixture(), original = leaf(f)
  Object.assign(original, { type: 'array', items: { type: 'string' } })
  const panel = f.metadata.panelManifest
  panel.sections.push({ ...panel.sections[0], id: 'alias' })
  Object.assign(panel.fields[0], { control: 'record_multi_select', applies_to: ['rows', 'alias'] })
  const result = diagnoseKnowledgeDeclarations([f])
  assert.equal(result.length, 1)
  assert.ok(result[0].schemaPointer.endsWith('/link/items'))
  original.items.knowledge = { role: 'reference', target: '#/roles' }
  assert.deepEqual(diagnoseKnowledgeDeclarations([f]), [])
})

test('metadata at every ownership level, derived scopes, multi-target and free/external values are not guessed', () => {
  for (const locate of [f => f.metadata.schemaDocument,
    f => f.metadata.schemaDocument.properties.sections,
    f => f.metadata.schemaDocument.properties.sections.properties.rows,
    f => f.metadata.schemaDocument.properties.sections.properties.rows.value,
    f => f.metadata.schemaDocument.properties.sections.properties.rows.value.properties.details, leaf]) {
    const f = fixture(); locate(f).knowledge = { role: 'metadata' }
    assert.deepEqual(diagnoseKnowledgeDeclarations([f]), [])
  }
  const derived = fixture(); derived.metadata.schemaDocument.knowledge = { role: 'content', source_kind: 'derived' }
  assert.deepEqual(diagnoseKnowledgeDeclarations([derived]), [])
  for (const change of [
    field => { field.options_from_sections = ['roles', 'other']; delete field.options_from_section },
    field => { delete field.options_from_section },
    field => { field.control = 'text' },
    field => { field.options_from_section = 'not_loaded' },
  ]) {
    const f = fixture(); change(f.metadata.panelManifest.fields[0]); assert.deepEqual(diagnoseKnowledgeDeclarations([f]), [])
  }
  const ambiguous = fixture()
  ambiguous.metadata.panelManifest.fields.push({ ...ambiguous.metadata.panelManifest.fields[0], options_from_section: 'other' })
  assert.deepEqual(diagnoseKnowledgeDeclarations([ambiguous]), [], 'one schema leaf with competing declared sources is not a provable single-target binding')
  assert.deepEqual(diagnoseKnowledgeDeclarations([{ name: 'native' }]), [])
})
