import test from 'node:test'
import assert from 'node:assert/strict'
import { validatePanelManifest } from '../src/panel-dsl.ts'
import { loadDesignBundle } from '../src/kit-loader.ts'
import { basename, dirname, resolve } from 'node:path'

const panel = () => ({ version: 1, panel_kind: 'document', sections: [
  { id: 'groups', title: 'Groups', records_path: 'groups.records' },
  { id: 'group_facts', title: 'Groups', records_path: 'groups.records', fields_path: 'details' },
  { id: 'items', title: 'Items', records_path: 'items.records' },
  { id: 'item_facts', title: 'Items', records_path: 'items.records', fields_path: 'details' },
], fields: [
  { key: 'title', control: 'text', applies_to: ['groups', 'items'] },
  { key: 'parent', control: 'record_select', applies_to: ['item_facts'], options_from_sections: ['group_facts', 'item_facts'] },
], ui: { component: 'record_workspace', id: 'workspace', sources: ['group_facts', 'item_facts'], children: [
  { component: 'reference_graph', id: 'graph', references: {
    nodes: ['group_facts', 'item_facts'].map(source => ({ source, label_field: 'title', label_scope: 'record' })),
    links: [{ source: 'item_facts', field: 'parent', targets: ['group_facts', 'item_facts'], reverse: true }],
  } }, { component: 'record_inspector', id: 'details' },
] } })
test('root labels and finite reference targets preserve declared nested ownership', () => {
  assert.deepEqual(validatePanelManifest(panel()), [])
  const legacy = panel()
  legacy.ui.children[0].references.nodes.forEach(node => { delete node.label_scope; node.label_field = 'name' })
  legacy.fields.push({key:'name', control:'text', applies_to:['group_facts','item_facts']})
  delete legacy.fields[1].options_from_sections; legacy.fields[1].options_from_section='group_facts'
  delete legacy.ui.children[0].references.links[0].targets; legacy.ui.children[0].references.links[0].target='group_facts'
  assert.deepEqual(validatePanelManifest(legacy), [])
})
test('root labels cannot read undeclared, nested, unsafe or unrelated external fields', () => {
  for (const change of [
    p => p.ui.children[0].references.nodes[0].label_scope='external',
    p => p.ui.children[0].references.nodes[0].label_field='details.title',
    p => p.ui.children[0].references.nodes[0].label_field='__proto__',
    p => p.ui.children[0].references.nodes[0].label_field='unclaimed',
    p => p.sections[0].records_path='other.records',
    p => p.fields[0].applies_to=['items'],
    p => { delete p.ui.children[0].references.nodes[0].label_scope },
  ]) { const p=panel();change(p);assert.ok(validatePanelManifest(p).length, String(change)) }
})
test('multi-target declarations reject ambiguous contracts and unsupported hub layout', () => {
  for (const change of [
    p => p.fields[1].options_from_section='groups',
    p => p.fields[1].options_from_panel={panel_type:'other',section_id:'items'},
    p => p.fields[1].options=[{value:'x',label:'X'}],
    p => p.fields[1].options_from_sections=['group_facts','group_facts'],
    p => p.fields[1].options_from_sections=['group_facts','missing'],
    p => p.fields[1].control='text',
    p => p.ui.children[0].references.links[0].target='group_facts',
    p => p.ui.children[0].references.links[0].targets=['group_facts'],
    p => p.ui.children[0].references.links[0].targets=['group_facts','missing'],
    p => p.ui.children[0].references.links[0].targets=null,
    p => p.ui.children[0].references.layout={kind:'hub',center:'item_facts',top:'group_facts'},
  ]) { const p=panel();change(p);assert.ok(validatePanelManifest(p).length, String(change)) }
})


// In-memory public fixture: no customer content or filesystem mutation.
async function load(view, stateSchema) {
  const root = resolve('.reference-graph-fixture-not-written/example')
  const files = new Map(Object.entries({
    'SKILL.md': '---\nname: example\ndescription: Synthetic nested reference graph fixture.\n---\n# Example\n',
    'skill.yaml': JSON.stringify({ name: 'example', version: '1.0', title: { zh: '示例', en: 'Example' },
      label: { zh: '示例', en: 'Example' }, execution: { mode: 'main', handoff: 'none' }, presentation: { mode: 'declarative' } }),
    'schema.yaml': JSON.stringify(stateSchema),
    'panel.yaml': JSON.stringify(view),
    'validation.yaml': JSON.stringify({ skill: 'example', rules: [
      { id: 'content', scope: ['completion'], code: 'example.empty', check: { non_empty_map: 'items.records' } },
    ] }),
  }).map(([path, value]) => [resolve(root, path), value]))
  return loadDesignBundle({ readText: async path => files.get(path),
    listDir: async path => [...files.keys()].filter(file => dirname(file) === path).map(file => basename(file)),
    isDirectory: async path => [...files.keys()].some(file => file.startsWith(path + '/')),
  }, { rootDir: root, sourceId: 'fixture:reference-graph' })
}
const schema = () => ({ type: 'object', properties: Object.fromEntries(['groups', 'items'].map(name => [name,
  { type: 'object', properties: { records: { type: 'map', value: { type: 'object', properties: {
    title: { type: 'string' }, details: { type: 'object', properties: { parent: { type: 'string' } } },
  } } } } },
])) })
test('actual Bundle loader verifies root-label schema through its declared canonical owner', async () => {
  const result = await load(panel(), schema())
  assert.equal(result.skill.metadata.panelManifest.ui.children[0].references.nodes[0].label_scope, 'record')
  for (const spec of [{ type: 'number' }, undefined]) {
    const invalid = schema()
    if (spec) invalid.properties.groups.properties.records.value.properties.title = spec
    else delete invalid.properties.groups.properties.records.value.properties.title
    await assert.rejects(load(panel(), invalid), /field "title".*absent|incompatible.*field "title"/)
  }
  const invalid = schema()
  invalid.properties.items.properties.records.value.properties.details.properties.parent = { type: 'number' }
  await assert.rejects(load(panel(), invalid), /control "record_select" is incompatible/)
})
