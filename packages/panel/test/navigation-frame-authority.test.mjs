import test from 'node:test'
import assert from 'node:assert/strict'
import { navigationFormUpdates } from '../src/navigation-map-edits.ts'

const binding = {
  nodes: { path: 'items', order: 'order', label: 'name', position: 'position' },
  edges: { path: 'links', order: 'links_order', source: 'from', target: 'to', label: 'text' },
  frames: { path: 'groups', label: 'name', members: 'items', position: 'position', size: 'size' },
}
const state = { items: { a: { name: 'A' }, b: { name: 'B' } }, order: ['a', 'b'], links: {} }
const deletion = { items: { b: state.items.b } }

test('deletion does not materialize absent automatic frame state', () => {
  const before = structuredClone(state)
  const result = navigationFormUpdates(state, binding, deletion)
  assert.equal(Object.hasOwn(result, 'groups'), false)
  assert.deepEqual(state, before)
  assert.deepEqual(deletion, { items: { b: state.items.b } })
})

test('explicit empty frame state remains authoritative', () => {
  for (const [input, update] of [
    [{ ...state, groups: {} }, deletion],
    [state, { ...deletion, groups: {} }],
  ]) assert.deepEqual(navigationFormUpdates(input, binding, update).groups, {})
})

test('deletion cleans members of the current transaction without losing frame metadata', () => {
  const frame = { name: 'Manual', items: ['a', 'b'], position: { x: 30, y: 40 }, extra: 'keep' }
  const update = { ...deletion, groups: { new: frame } }
  const result = navigationFormUpdates({ ...state, groups: { old: frame } }, binding, update)
  assert.deepEqual(result.groups, { new: { ...frame, items: ['b'] } })
  assert.deepEqual(frame.items, ['a', 'b'])
})
