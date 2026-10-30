import assert from 'node:assert/strict'
import test from 'node:test'
import {
  PANEL_COMPONENT_CATALOG, COMPONENT_KINDS, SOURCE_BOUND_COMPONENTS,
  GENERATED_COMPONENT_KINDS, WORKSPACE_COMPONENT_KINDS, describePanelComponents,
} from '../src/panel-component-catalog.ts'
import { validatePanelManifest } from '../src/panel-dsl.ts'

test('catalog provides unique names and nonempty AI guidance', () => {
  assert.equal(new Set(COMPONENT_KINDS).size, COMPONENT_KINDS.length)
  assert.equal(COMPONENT_KINDS.length, 39)
  for (const name of COMPONENT_KINDS) {
    assert.match(name, /^[a-z][a-z_]*$/)
    assert.ok(PANEL_COMPONENT_CATALOG[name].description.trim())
    assert.ok(describePanelComponents().includes(`${name}: `))
  }
  assert.ok(Object.isFrozen(COMPONENT_KINDS))
})

test('generated vocabulary retains the existing restricted subset and order', () => {
  assert.deepEqual(GENERATED_COMPONENT_KINDS, [
    'stack', 'tabs', 'text_block', 'record_form', 'grouped_records',
    'nested_collection', 'question_workspace', 'schema_field', 'structured_data',
    'artifact_gallery', 'related_artifacts',
  ])
  assert.equal(describePanelComponents(true).split('\n').length, 11)
  assert.ok(!GENERATED_COMPONENT_KINDS.includes('relation_graph'))
})

test('source binding remains a component capability, not a Bundle rule', () => {
  assert.deepEqual([...SOURCE_BOUND_COMPONENTS], [
    'record_form', 'related_records',
    'question_list', 'question_rounds', 'question_workspace', 'relation_matrix',
    'mind_map', 'bpmn_canvas', 'lifecycle_canvas', 'record_board', 'diagram_workspace', 'canvas_workspace', 'math_document',
  ])
})

test('full-height workspace capability is derived from the same catalog used by the renderer and authoring tools', () => {
  assert.deepEqual(WORKSPACE_COMPONENT_KINDS, Object.entries(PANEL_COMPONENT_CATALOG).filter(([, entry]) => entry.ownsWorkspace).map(([name]) => name))
  assert.ok(Object.isFrozen(WORKSPACE_COMPONENT_KINDS))
  assert.ok(WORKSPACE_COMPONENT_KINDS.includes('preview_workspace'))
  assert.ok(WORKSPACE_COMPONENT_KINDS.includes('navigation_workspace'))
  assert.ok(!GENERATED_COMPONENT_KINDS.includes('navigation_workspace'), 'new authored components do not implicitly expand model capabilities')
  assert.ok(!WORKSPACE_COMPONENT_KINDS.includes('record_form'))
})


test('removed navigation and split stubs are unavailable to authors and generated panels', () => {
  for (const component of ['record_nav', 'record_tree', 'split']) {
    assert.equal(COMPONENT_KINDS.includes(component), false)
    assert.equal(GENERATED_COMPONENT_KINDS.includes(component), false)
    assert.equal(describePanelComponents().includes(`${component}:`), false)
    const errors = validatePanelManifest({ version: 1, panel_kind: 'document',
      sections: [{ id: 'records', title: 'Records' }], fields: [],
      ui: { component, id: 'removed', source: 'records' } })
    assert.ok(errors.some(error => error.includes('component')), errors.join('\n'))
  }
})
