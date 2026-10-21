import test from 'node:test'
import assert from 'node:assert/strict'
import { navigationFrameDragPositions, previewNavigationFrameMembers } from '../src/navigation-frame-drag.ts'
import { translateNavigationFrame } from '../src/navigation-map-edits.ts'

test('live member preview and final transaction use the same immutable gesture origin', () => {
  const origin = { x: -20, y: -40 }
  const starts = { a: { x: 5, y: 10 }, b: { x: 300, y: 10 } }
  const before = structuredClone(starts)
  assert.deepEqual(navigationFrameDragPositions(origin, { x: 0, y: 0 }, starts), {
    a: { x: 25, y: 50 }, b: { x: 320, y: 50 },
  })
  const end = { x: 50, y: 25 }
  const preview = navigationFrameDragPositions(origin, end, starts)
  assert.deepEqual(preview, { a: { x: 75, y: 75 }, b: { x: 370, y: 75 } })
  assert.deepEqual(navigationFrameDragPositions(origin, origin, starts), starts, 'returning to start cancels visual displacement')
  const data = { items: { a: { file: 'a.html' }, b: { file: 'b.html' }, other: { point: { x: 900, y: 900 } } },
    groups: { g: { name: 'Shared', members: ['a', 'b'], point: origin }, untouched: { name: 'Other', members: [] } } }
  const binding = { nodes: { path: 'items', position: 'point' }, frames: { path: 'groups', members: 'members', position: 'point' } }
  const changes = translateNavigationFrame(data, binding, 'g', end, starts, origin)
  assert.deepEqual(changes.items.a.point, preview.a)
  assert.deepEqual(changes.items.b.point, preview.b)
  assert.equal(changes.items.a.file, 'a.html')
  assert.deepEqual(changes.items.other, data.items.other)
  assert.deepEqual(changes.groups.untouched, data.groups.untouched)
  assert.deepEqual(starts, before)
  assert.equal(data.items.a.point, undefined, 'preview/transaction construction never mutates canonical input')
})

test('invalid pointer and member coordinates cannot leak into saved geometry', () => {
  assert.throws(() => navigationFrameDragPositions({ x: 0, y: 0 }, { x: NaN, y: 0 }, {}))
  assert.throws(() => navigationFrameDragPositions({ x: 0, y: 0 }, { x: 0, y: 0 }, { a: { x: Infinity, y: 1 } }))
})

test('live animation retains node measurements and ignores same identity in other collections', () => {
  const measured = { width: 206, height: 228 }
  const nodes = [
    { id: 'node:a', data: { section: 'items', record: 'a' }, position: { x: 0, y: 0 }, measured, selected: true },
    { id: 'frame:a', data: { section: 'groups', record: 'a' }, position: { x: 0, y: 0 } },
    { id: 'node:b', data: { section: 'items', record: 'b' }, position: { x: 50, y: 0 } },
  ]
  const result = previewNavigationFrameMembers(nodes, 'items', { a: { x: 15, y: 30 } })
  assert.deepEqual(result[0].position, { x: 15, y: 30 })
  assert.equal(result[0].measured, measured)
  assert.equal(result[0].data, nodes[0].data)
  assert.equal(result[0].selected, true)
  assert.equal(result[1], nodes[1])
  assert.equal(result[2], nodes[2])
  assert.deepEqual(nodes[0].position, { x: 0, y: 0 })
})
