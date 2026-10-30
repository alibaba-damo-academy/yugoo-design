import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
const { register } = await import('tsx/esm/api'); register()
const { projectExplorationRecords, bundleDisplay, bundleCoordinates, edgeMembers, graphColor } = await import('../src/client/graph-bundle-model.ts')
const { storedKnowledgeGraph } = await import('../../core/src/design-knowledge-semantic.ts')
const envelope = JSON.parse(await readFile(new URL('../../../examples/design-team-delivery/design_records/knowledge/archive.json', import.meta.url)))
const graph = storedKnowledgeGraph({ ...envelope.archive, page: { nextOffset: null } }, envelope.publication.checkpoint)
const originalIds = graph.edges.map(edge => edge.id).sort()
const ids = edges => edges.flatMap(edge => edgeMembers(edge).map(member => member.id)).sort()
test('real published archive preserves every original edge identity through record and Bundle folds', () => {
  const before = JSON.stringify(graph)
  assert.equal(graph.nodes.length, 177); assert.equal(graph.edges.length, 232)
  for (const expanded of [new Set(), new Set(graph.nodes.filter(n => n.record).map(n => n.id))]) {
    const projected = projectExplorationRecords(graph, expanded)
    assert.deepEqual(ids(projected.edges), originalIds)
    for (const collapsed of [new Set(), new Set(['flow_design']), new Set(graph.nodes.map(n => n.owner))]) {
      const display = bundleDisplay(projected, collapsed)
      assert.deepEqual(ids(display.edges), originalIds)
      const source = new Map(graph.edges.map(edge => [edge.id, edge]))
      for (const group of display.edges) for (const member of group.members) {
        const original = source.get(member.id)
        assert.equal(member.from, original.from); assert.equal(member.to, original.to)
        assert.equal(member.evidence, original.evidence); assert.deepEqual(member.reading, original.reading)
      }
      const coordinates = bundleCoordinates(display)
      assert.equal(coordinates.size, display.nodes.length)
      assert.ok([...coordinates.values()].every(p => Number.isFinite(p.x) && Number.isFinite(p.y)))
    }
  }
  assert.equal(JSON.stringify(graph), before)
})
test('record and artifact endpoints remain addressable, including non-leaf records', () => {
  const projected = projectExplorationRecords(graph, new Set())
  for (const node of graph.nodes.filter(n => n.record || n.recordKind === 'design-artifact')) assert.ok(projected.nodes.some(p => p.id === node.id), node.id)
  const full = projectExplorationRecords(graph, new Set(graph.nodes.filter(n => n.record).map(n => n.id)))
  assert.equal(full.nodes.length, graph.nodes.length)
  assert.ok(bundleDisplay(projected, new Set(graph.nodes.map(n => n.owner))).edges.some(e => e.from === e.to), 'folded internal relations stay inspectable')
})
test('meaning, origin, direction, lifecycle and exact duplicate evidence IDs never mix or disappear', () => {
  const reading = { relationType: 'supports', meaning: 'supports', origin: 'agent', direction: 'forward', lifecycle: 'proposed' }
  const node = (id, owner) => ({ id, owner, label: id, file: owner, pointer: '', context: '', record: true })
  const edge = (id, patch = {}) => ({ id, from: 'a', to: 'b', kind: 'knowledge', reading: { ...reading, ...patch }, evidence: 'same', label: id })
  const edges = [edge('one'), edge('duplicate-evidence'), edge('accepted', { lifecycle: 'accepted' }), edge('file', { origin: 'file' }), edge('similar', { meaning: 'similar' }), edge('unknown-direction', { direction: 'unknown' }), edge('custom-type', { relationType: 'custom' })]
  const display = bundleDisplay({ nodes: [node('a', 'A'), node('b', 'B')], edges, total: 2 }, new Set(['A', 'B']))
  assert.equal(display.edges.length, 6)
  assert.deepEqual(ids(display.edges), edges.map(e => e.id).sort())
  const combined = display.edges.find(e => e.members.some(m => m.id === 'one'))
  assert.equal(combined.members.length, 2)
  assert.equal(combined.label, '支持 · 2 条原始关系')
})
test('layout order and Bundle colors are stable under reordering and scope changes', () => {
  const projected = projectExplorationRecords(graph, new Set())
  const normal = bundleDisplay(projected, new Set())
  const reversed = bundleDisplay({ ...projected, nodes: [...projected.nodes].reverse(), edges: [...projected.edges].reverse() }, new Set())
  assert.deepEqual(bundleCoordinates(normal), bundleCoordinates(reversed))
  assert.equal(new Set([...new Set(graph.nodes.map(n => n.owner))].map(graphColor)).size, 7)
})
test('unknown record roots and synthetic-ID collisions preserve original nodes', () => {
  const node = { id: 'view-bundle:X', owner: 'X', label: 'orphan', file: 'x', pointer: '', context: '', record: false }
  const scope = projectExplorationRecords({ checkpoint: 'c', nodes: [node], edges: [], warnings: [] }, new Set())
  assert.equal(scope.nodes.length, 1)
  const display = bundleDisplay(scope, new Set(['X']))
  assert.notEqual(display.nodes[0].id, node.id)
  assert.deepEqual(display.nodes[0].sources, [node.id])
})
