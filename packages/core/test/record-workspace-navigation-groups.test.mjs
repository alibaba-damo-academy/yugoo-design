import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve, dirname, basename } from 'node:path'
import { loadDesignKit } from '../src/kit-loader.ts'
import { validatePanelManifest } from '../src/panel-dsl.ts'
import { describePanelComponents } from '../src/panel-component-catalog.ts'

const panel = () => ({ version: 1, panel_kind: 'document',
  sections: [{ id: 'items', title: 'Items' }],
  fields: [{ key: 'title', control: 'text', applies_to: ['items'] }],
  ui: { id: 'workspace', component: 'record_workspace', sources: ['items'], navigation_group_by: 'category',
    children: [{ id: 'details', component: 'record_inspector' }] } })
const schema = () => ({ type: 'object', properties: {
  items: { type: 'map', value: { type: 'object', properties: { title: { type: 'string' }, category: { type: 'string' } } } },
} })

async function load(view = panel(), stateSchema = schema()) {
  const root = resolve('.navigation-groups-fixture-not-written')
  const bundle = resolve(root, 'skills/example_bundle')
  const files = new Map([
    [resolve(root, 'mindset.md'), '---\nname: group_fixture\nversion: "0.1"\n---\n<design_skills>\n## example_bundle\n</design_skills>\n'],
    [resolve(bundle, 'skill.yaml'), JSON.stringify({ name: 'example_bundle', version: '0.1',
      title: { zh: '示例', en: 'Example' }, label: { zh: '示例', en: 'Example' },
      execution: { mode: 'main', handoff: 'must_edit' }, presentation: { mode: 'declarative' } })],
    [resolve(bundle, 'SKILL.md'), '---\nname: example_bundle\ndescription: Navigation grouping fixture, not user facts.\n---\n# Example\n'],
    [resolve(bundle, 'schema.yaml'), JSON.stringify(stateSchema)],
    [resolve(bundle, 'panel.yaml'), JSON.stringify(view)],
    [resolve(bundle, 'validation.yaml'), JSON.stringify({ skill: 'example_bundle', rules: [
      { id: 'content', scope: ['completion'], code: 'example.empty', check: { non_empty_map: 'items' } },
    ] })],
  ])
  return loadDesignKit({ readText: async path => files.get(path),
    listDir: async path => [...new Set([...files.keys()].filter(file => dirname(file) === path).map(file => basename(file))
      .concat(path === resolve(root, 'skills') ? ['example_bundle'] : []))],
    isDirectory: async path => [...files.keys()].some(file => file.startsWith(path + '/')),
  }, root, { sourceId: 'fixture:navigation-groups' })
}

test('navigation grouping is an optional workspace-only direct-field contract', () => {
  const view = panel()
  assert.deepEqual(validatePanelManifest(view), [])
  for (const value of ['', false, 5, [], {}, 'nested.category', '__proto__', 'constructor']) {
    const invalid = panel(); invalid.ui.navigation_group_by = value
    assert.ok(validatePanelManifest(invalid).some(error => error.includes('navigation_group_by')), JSON.stringify(value))
  }
  view.ui.children[0].navigation_group_by = 'category'
  assert.ok(validatePanelManifest(view).some(error => error.includes('navigation_group_by')))
  delete view.ui.navigation_group_by; delete view.ui.children[0].navigation_group_by
  assert.deepEqual(validatePanelManifest(view), [])
  assert.match(describePanelComponents(), /navigation_group_by projects/)
})

test('actual loader checks the bound schema, without requiring an editable classification control', async () => {
  await load()
  const nestedView = panel(); nestedView.sections[0].fields_path = 'details'
  const nestedSchema = schema()
  nestedSchema.properties.items.value.properties = { category: { type: 'number' }, details: {
    type: 'object', properties: { title: { type: 'string' }, category: { type: 'enum', values: ['A', 'B'] } },
  } }
  await load(nestedView, nestedSchema)
  delete nestedSchema.properties.items.value.properties.details.properties.category
  await assert.rejects(load(nestedView, nestedSchema), /ui.navigation_group_by: section items/)
  for (const spec of [{ type: 'number' }, { type: 'boolean' }, { type: 'array', items: { type: 'string' } },
    { type: 'object', properties: {} }, { type: 'enum', values: [1, 2] },
    { type: 'string', knowledge: { role: 'metadata' } },
    { type: 'string', knowledge: { role: 'reference' } }, undefined]) {
    const invalid = schema()
    if (spec) invalid.properties.items.value.properties.category = spec
    else delete invalid.properties.items.value.properties.category
    await assert.rejects(load(panel(), invalid), /ui.navigation_group_by: section items/)
  }
})

test('grouping validates every primary source, not contextual children, and follows authored slots', async () => {
  const view = panel(), stateSchema = schema()
  view.sections.push({ id: 'children', title: 'Children', navigation: 'contextual' })
  view.ui.sources.push('children')
  view.fields.push({ key: 'parent', control: 'record_select', options_from_section: 'items', applies_to: ['children'] })
  stateSchema.properties.children = { type: 'map', value: { type: 'object', properties: { parent: { type: 'string' } } } }
  await load(view, stateSchema)
  view.sections.push({ id: 'others', title: 'Others' }); view.ui.sources.push('others')
  stateSchema.properties.others = { type: 'map', value: { type: 'object', properties: {} } }
  const workspace = view.ui
  view.ui = { id: 'shell', component: 'stack', slots: { main: workspace } }
  await assert.rejects(load(view, stateSchema), /ui.slots.main.navigation_group_by: section others/)
  stateSchema.properties.others.value.properties.category = { type: 'string' }
  await load(view, stateSchema)
})
