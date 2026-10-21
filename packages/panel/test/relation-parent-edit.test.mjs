import test from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'tsx/esm/api'
register()
const { planRelationParentEdit, relationHasParentConflict } = await import('../src/relation-parent-edit.ts')
const { applyPanelUpdatesToDraft } = await import('../src/record-state.ts')
const { reverseRelation } = await import('../src/relation-records.ts')
const graph = { nodes: 'things', edges: 'links', label_field: 'name', source_field: 'from', target_field: 'to', edge_kind_field: 'kind',
  hierarchy: { values: ['extends'], label: 'Parent', max_parents: 1 } }
const manifest = { sections: [{ id: 'things', title: 'Things' }, { id: 'links', title: 'Links', order: 'link_order', create: { id_field: 'id', defaults: { comment: '' } } }],
  fields: [{ key: 'kind', applies_to: ['links'], control: 'select', options: [{ value: 'extends', label: 'Extends' }] }] }
const fixture = () => ({ things: { base: { name: 'Base' }, child: { name: 'Child' }, leaf: { name: 'Leaf' }, other: { name: 'Other' } },
  links: { own: { id: 'own', name: 'User label', from: 'child', to: 'base', kind: 'extends', comment: 'Keep' },
    next: { id: 'next', name: 'Leaf parent', from: 'leaf', to: 'child', kind: 'extends' }, broken: null }, link_order: ['own', 'next', 'broken'],
  facts: { original: { owner: 'base', restriction: 'Needs confirmation' } } })

test('parent update changes only the canonical edge target and retains identity, metadata, order and associated facts', () => {
  const data = fixture(), before = structuredClone(data)
  const updates = planRelationParentEdit(manifest, data, graph, 'child', 'other')
  assert.deepEqual(Object.keys(updates), ['links'])
  const next = applyPanelUpdatesToDraft(data, updates)
  assert.deepEqual(next.links.own, { ...before.links.own, to: 'other' })
  assert.deepEqual(next.link_order, before.link_order)
  assert.deepEqual(next.facts, before.facts)
  assert.equal(next.links.broken, null)
  assert.deepEqual(data, before)
  assert.deepEqual(planRelationParentEdit(manifest, data, graph, 'child', 'base'), {})
})

test('detach removes one edge and its order entry; reattach creates only one edge', () => {
  const data = fixture()
  const detached = applyPanelUpdatesToDraft(data, planRelationParentEdit(manifest, data, graph, 'child', ''))
  assert.deepEqual(detached.link_order, ['next', 'broken'])
  assert.deepEqual(detached.links, { next: data.links.next, broken: null })
  const updates = planRelationParentEdit(manifest, detached, graph, 'child', 'base')
  const next = applyPanelUpdatesToDraft(detached, updates)
  const [id, edge] = Object.entries(next.links).find(([id]) => !Object.hasOwn(detached.links, id))
  assert.equal(edge.id, id); assert.equal(edge.name, 'Extends'); assert.equal(edge.from, 'child'); assert.equal(edge.to, 'base')
  assert.equal(next.link_order.at(-1), id)
  assert.deepEqual(next.things, data.things); assert.deepEqual(next.facts, data.facts)
})

test('reject cycles, multiple parents, missing nodes, disabled policy and malformed raw collection/order', () => {
  const data = fixture()
  for (const [child, parent] of [['child', 'leaf'], ['base', 'base'], ['missing', 'base'], ['child', 'missing']])
    assert.equal(planRelationParentEdit(manifest, data, graph, child, parent), undefined)
  const invalid = { ...data, links: { ...data.links, duplicate: { ...data.links.own, to: 'other' } } }
  assert.equal(planRelationParentEdit(manifest, invalid, graph, 'child', 'base'), undefined)
  assert.equal(planRelationParentEdit(manifest, { ...data, links: ['do not replace'] }, graph, 'child', 'base'), undefined)
  assert.equal(planRelationParentEdit(manifest, { ...data, link_order: {} }, graph, 'child', 'other'), undefined)
  assert.equal(planRelationParentEdit(manifest, data, { ...graph, hierarchy: { values: ['extends'], label: 'Parent' } }, 'child', 'other'), undefined)
  assert.equal(relationHasParentConflict('new', data.links.own, data.links, graph), true)
  assert.equal(relationHasParentConflict('own', data.links.own, data.links, graph), false)
})

test('nested edge bindings preserve outer metadata and malformed records', () => {
  const nested = { ...manifest, sections: [manifest.sections[0], { ...manifest.sections[1], records_path: 'state.links', fields_path: 'value', order: 'state.order' }] }
  const data = fixture(), state = { things: data.things, state: { links: { own: { value: data.links.own, metadata: 'Keep' }, broken: null }, order: ['own', 'broken'] } }
  const next = applyPanelUpdatesToDraft(state, planRelationParentEdit(nested, state, graph, 'child', 'other'))
  assert.equal(next.state.links.own.metadata, 'Keep'); assert.equal(next.state.links.own.value.to, 'other')
  assert.equal(next.state.links.broken, null)
  assert.deepEqual(next.state.order, state.state.order)
})

test('a reversal that creates a second parent is rejected even without a cycle', () => {
  const edges = { one: { from: 'child', to: 'base', kind: 'extends' }, two: { from: 'base', to: 'other', kind: 'extends' } }
  assert.equal(relationHasParentConflict('one', reverseRelation(edges.one, graph), edges, graph), true)
  assert.equal(relationHasParentConflict('one', reverseRelation(edges.one, { ...graph, hierarchy: { values: ['extends'], label: 'Parent' } }), edges,
    { ...graph, hierarchy: { values: ['extends'], label: 'Parent' } }), false, 'existing unrestricted graphs remain unchanged')
})
