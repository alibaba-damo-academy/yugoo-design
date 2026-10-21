import test from 'node:test'
import assert from 'node:assert/strict'
import { validatePanelManifest } from '../src/panel-dsl.ts'
const fixture = () => ({ version: 1, panel_kind: 'document', sections: [{ id: 'nodes', title: 'Nodes' }, { id: 'edges', title: 'Edges' }, { id: 'facts', title: 'Facts', navigation: 'contextual' }],
  fields: [{ key: 'name', control: 'text', applies_to: ['nodes', 'edges', 'facts'] },
    { key: 'kind', control: 'select', applies_to: ['edges'], options: [{ value: 'extends', label: 'Extends' }] },
    { key: 'from', control: 'record_select', options_from_section: 'nodes', applies_to: ['edges'] },
    { key: 'to', control: 'record_select', options_from_section: 'nodes', applies_to: ['edges'] },
    { key: 'owner', control: 'record_select', options_from_section: 'nodes', applies_to: ['facts'] }],
  ui: { id: 'workspace', component: 'record_workspace', sources: ['nodes', 'edges', 'facts'], workspace_view: 'switch', children: [
    { id: 'graph', component: 'relation_graph', graph: { nodes: 'nodes', edges: 'edges', label_field: 'name', source_field: 'from', target_field: 'to', edge_kind_field: 'kind', hierarchy: { values: ['extends'], label: 'Parent', max_parents: 1 } } },
    { id: 'inspector', component: 'record_inspector', children: [{ id: 'form', component: 'record_form', source: 'nodes' },
      { id: 'facts', component: 'record_related_editor', source: 'facts', bindings: { reference: 'owner' }, inherit_from_graph: true }] },
  ] } })
test('author inheritance policy resolves only through its actual workspace graph and associated reference', () => {
  assert.deepEqual(validatePanelManifest(fixture()), [])
  for (const mutate of [
    f => { f.ui.children[1].children[1].inherit_from_graph = false },
    f => { f.ui.children[1].children[0].inherit_from_graph = true },
    f => { delete f.ui.children[0].graph.hierarchy },
    f => { f.ui.children[0].graph.hierarchy.max_parents = 2 },
    f => { f.ui.children[0].graph.hierarchy.values.push('other') },
    f => { f.ui.children = {} },
    f => { f.ui = f.ui.children[1].children[1] },
  ]) { const candidate = fixture(); mutate(candidate); assert.ok(validatePanelManifest(candidate).length, String(mutate)) }
})
