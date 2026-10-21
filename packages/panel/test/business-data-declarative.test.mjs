import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
const { register } = await import('tsx/esm/api'); register()
const { parsePanelManifest, validatePanelManifest } = await import('../../core/src/panel-dsl.ts')
const { applyDesignEditToDraft, applyPanelUpdatesToDraft, recordDeletionUpdates } = await import('../src/record-state.ts')
const { relationParents, relationAncestors, relationRoots, relationHasCycle, reverseRelation } = await import('../src/relation-records.ts')
const { displayValue } = await import('../src/visual-records.ts')

test('endpoint display uses scoped choice labels without inventing absent values', () => {
  for (const control of ['select', 'radio']) {
    const manifest = { fields: [{ key: 'count', control, applies_to: ['links'], options: [{ value: 'one', label: '一个' }] }] }
    assert.equal(displayValue(manifest, 'links', 'count', 'one'), '一个')
    for (const value of [undefined, null, '']) assert.equal(displayValue(manifest, 'links', 'count', value), '')
    assert.equal(displayValue(manifest, 'links', undefined, 'one'), '')
    assert.equal(displayValue(manifest, 'links', 'count', 'unknown'), 'unknown')
    assert.equal(displayValue(manifest, 'other', 'count', 'one'), 'one')
  }
  for (const control of ['text', 'number']) {
    const manifest = { fields: [{ key: 'value', control, applies_to: ['links'] }] }
    assert.equal(displayValue(manifest, 'links', 'value', 0), '0')
    assert.equal(displayValue(manifest, 'links', 'value', 'arbitrary'), 'arbitrary')
  }
})

const panel = parsePanelManifest(await readFile(new URL('../../skills-web-app/bundles/business_data/panel.yaml', import.meta.url), 'utf8'))
const graph = panel.ui.children[0].graph
const nodes = Object.fromEntries(['root', 'left', 'right', 'leaf'].map(id => [id, { id, name: id, fields: {}, field_order: [], states: {}, state_order: [] }]))
const edge = (id, source, target, extra = {}) => ({ id, source, target, kind: 'generalization', name: 'is a kind of', ...extra })
const edges = { a: edge('a', 'left', 'root'), b: edge('b', 'right', 'root'), c: edge('c', 'leaf', 'left'), d: edge('d', 'leaf', 'right') }

test('real business panel binds existing canonical v3 and keeps multi-parent hierarchy without copied fields', () => {
  assert.deepEqual(validatePanelManifest(panel), [])
  const before = structuredClone({ nodes, edges })
  assert.deepEqual(relationParents('leaf', nodes, edges, graph), ['left', 'right'])
  assert.deepEqual(relationAncestors('leaf', nodes, edges, graph), ['left', 'right', 'root'])
  assert.deepEqual(relationRoots(nodes, edges, graph), ['root'])
  for (const [id, value] of Object.entries(edges)) assert.equal(relationHasCycle(id, value, edges, graph), false)
  assert.equal(relationHasCycle('new', edge('new', 'root', 'leaf'), edges, graph), true)
  assert.equal(relationHasCycle('new', edge('new', 'leaf', 'leaf'), edges, graph), true)
  assert.equal(relationHasCycle('new', edge('new', 'leaf', 'leaf', { kind: 'association' }), edges, graph), false)
  assert.deepEqual({ nodes, edges }, before)
  assert.equal(relationRoots(nodes, { ...edges, back: edge('back', 'root', 'leaf') }, graph).length > 0, true)
})

test('endpoint reversal preserves unknown quantities, record identity and unrelated facts', () => {
  const original = edge('link', 'root', 'leaf', { kind: 'association', source_count: '0..*', description: 'Keep meaning' })
  const reversed = reverseRelation(original, graph)
  assert.equal(reversed.source, 'leaf'); assert.equal(reversed.target, 'root')
  assert.equal(reversed.target_count, '0..*'); assert.equal(Object.hasOwn(reversed, 'source_count'), false)
  assert.equal(reversed.id, original.id); assert.equal(reversed.description, original.description)
  assert.deepEqual(reverseRelation(reversed, graph), original)
  const bothUnknown = reverseRelation(edge('unknown', 'root', 'leaf', { kind: 'association' }), graph)
  assert.equal(Object.hasOwn(bothUnknown, 'source_count'), false)
  assert.equal(Object.hasOwn(bothUnknown, 'target_count'), false)
})

test('edits and save-wire roundtrip preserve local fields, omit inherited quantities and delete only incident links', () => {
  const state = { schema_version: 3, object_order: Object.keys(nodes), objects: structuredClone(nodes), relations: { ...edges,
    link: edge('link', 'leaf', 'root', { kind: 'association', source_count: '1', target_count: '0..*' }) } }
  state.objects.leaf.fields = { stable: { id: 'stable', name: 'Local only', meaning: 'Keep local' } }
  state.objects.leaf.field_order = ['stable']
  const edited = applyDesignEditToDraft(state, panel, { section: 'relations', record: 'link', field: 'kind', value: 'generalization' })
  assert.equal(Object.hasOwn(edited.relations.link, 'source_count'), false)
  assert.equal(Object.hasOwn(edited.relations.link, 'target_count'), false)
  assert.deepEqual(edited.objects, state.objects)
  const reopened = JSON.parse(JSON.stringify(edited))
  assert.deepEqual(reopened.objects.leaf.fields, state.objects.leaf.fields)
  const deletion = recordDeletionUpdates(panel, reopened, 'objects', 'left')
  const result = applyPanelUpdatesToDraft(reopened, deletion.updates)
  assert.equal(Object.hasOwn(result.objects, 'left'), false)
  assert.equal(Object.hasOwn(result.objects, 'leaf'), true)
  assert.equal(Object.hasOwn(result.relations, 'a'), false)
  assert.equal(Object.hasOwn(result.relations, 'c'), false)
  assert.ok(result.relations.d); assert.ok(result.relations.link)
  assert.deepEqual(result.object_order, ['root', 'right', 'leaf'])
})

test('graph extension rejects guessed kinds, unsafe pairs and incompatible workspace composition', () => {
  for (const mutate of [
    graph => { graph.hierarchy.values = ['unrecognized'] },
    graph => { graph.hierarchy = null },
    graph => { graph.reverse.pairs = [['id', 'name']] },
    graph => { graph.reverse.pairs = [['source_count', 'source_count']] },
    graph => { graph.reverse.pairs = [['source', 'target_count']] },
    graph => { graph.reverse.pairs = [['source_count', 'description']] },
    graph => { graph.reverse.pairs = [null] },
    graph => { graph.source_annotation_field = 'missing' },
    graph => { graph.target_annotation_field = 'source' },
  ]) {
    const bad = structuredClone(panel); mutate(bad.ui.children[0].graph)
    assert.ok(validatePanelManifest(bad).length)
  }
  const bad = structuredClone(panel); bad.ui.children.pop()
  assert.ok(validatePanelManifest(bad).length)
})
