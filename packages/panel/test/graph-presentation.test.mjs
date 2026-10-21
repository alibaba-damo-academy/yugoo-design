import { test } from 'node:test'
import assert from 'node:assert/strict'
const { register } = await import('tsx/esm/api'); register()
const { placeLabels, intersects } = await import('../src/client/graph-labels.ts')
const { recordReach, nodeRadius } = await import('../src/client/graph-model.ts')
test('production labels avoid each other, node obstacles and viewport boundaries', () => {
  const items = [{ id: 'a', x: 100, y: 100, w: 90, h: 24 }, { id: 'b', x: 110, y: 100, w: 90, h: 24 }]
  const obstacles = [{ x: 95, y: 95, w: 10, h: 10 }]
  const before = structuredClone(items), placed = placeLabels(items, obstacles, 350, 250)
  assert.equal(placed.length, 2)
  assert.equal(intersects(placed[0].box, placed[1].box), false)
  assert.ok(placed.every(p => !obstacles.some(o => intersects(o, p.box))))
  assert.ok(placed.every(({ box: b }) => b.x >= 8 && b.y >= 8 && b.x + b.w <= 342 && b.y + b.h <= 242))
  assert.deepEqual(placeLabels([{ id: 'too-wide', x: 5, y: 5, w: 500, h: 24 }], [], 100, 100), [])
  assert.deepEqual(items, before)
})
test('reach counts other records, never contains or duplicate evidence or self edges', () => {
  const graph = { nodes: [{ id: 'a', record: true }, { id: 'child', record: false, recordId: 'a' }, { id: 'b', record: true }], edges: [
    { from: 'a', to: 'child', kind: 'contains' }, { from: 'child', to: 'a', kind: 'semantic' },
    { from: 'child', to: 'b', kind: 'semantic' }, { from: 'a', to: 'b', kind: 'knowledge' }, { from: 'b', to: 'a', kind: 'semantic' },
  ] }
  const before = structuredClone(graph), reach = recordReach(graph)
  assert.deepEqual([...reach], [['a', 1], ['b', 1]])
  assert.equal(nodeRadius(graph.nodes[1], reach), 2)
  assert.equal(nodeRadius(graph.nodes[0], reach), Math.sqrt(15.25))
  assert.deepEqual(graph, before)
})
