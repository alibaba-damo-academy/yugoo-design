import test from 'node:test'
import assert from 'node:assert/strict'
import { projectNavigationWorkspace, moveNavigationWorkspaceRecord } from '../src/navigation-workspace-projection.ts'
import { navigationFormUpdates, translateNavigationFrame } from '../src/navigation-map-edits.ts'
import { applyPanelUpdatesToDraft } from '../src/record-state.ts'

const binding = {
  grouping: { path: 'menu.rows', target: 'destination', label: 'category' },
  nodes: { path: 'views', order: 'sequence', label: 'title', position: 'point', parent: 'owner', artifact: 'file' },
  edges: { path: 'jumps', order: 'jump_order', label: 'title', source: 'from', target: 'to' },
  frames: { path: 'regions', label: 'title', members: 'members', position: 'point', size: 'extent' },
}
const labels = { primary: 'Primary', other: 'Other', generic: 'Records' }
const state = {
  views: { a: { title: 'A', file: 'a.html' }, b: { title: 'B', owner: 'a', file: 'b.html' }, c: { title: 'C', file: 'c.html' } },
  sequence: ['a', 'b', 'c'], jumps: {},
  menu: { rows: [{ destination: 'a', category: 'Work' }, { destination: 'c', category: 'Settings' }] },
}
const project = value => projectNavigationWorkspace(value, binding, 'identity', labels)

test('one immutable projection supplies inherited groups, frames and inspector records', () => {
  const before = structuredClone(state), result = project(state)
  assert.equal(result.automatic, true)
  assert.deepEqual(result.map.frames.map(frame => frame.members), [['a', 'b'], ['c']])
  for (const frame of result.map.frames) {
    assert.equal(result.displayData.regions[frame.id].identity, frame.id)
    for (const id of frame.members) {
      const p = result.positions.get(id)
      assert.ok(p.x >= frame.position.x && p.x + 206 <= frame.position.x + frame.size.width)
      assert.ok(p.y >= frame.position.y && p.y + 228 <= frame.position.y + frame.size.height)
    }
  }
  assert.deepEqual(state, before)
  assert.equal(Object.hasOwn(state, 'regions'), false)
})

test('manual empty and saved geometry remain authoritative on reopening', () => {
  const manual = { ...state, regions: {}, views: { ...state.views, b: { ...state.views.b, point: { x: -900, y: 200 } } } }
  const result = project(manual)
  assert.equal(result.automatic, false)
  assert.deepEqual(result.frames, {})
  assert.deepEqual(result.positions.get('b'), { x: -900, y: 200 })
  assert.equal(result.displayData, manual)
  const noConfig = { ...binding }; delete noConfig.grouping
  assert.equal(projectNavigationWorkspace(state, noConfig, 'identity', labels).automatic, false)
})

test('first node drag materializes all frames, reassigns membership and preserves artifacts', () => {
  const before = structuredClone(state), projection = project(state)
  const destination = projection.positions.get('c')
  const updates = moveNavigationWorkspaceRecord(state, binding, projection, 'b', destination, { width: 206, height: 228 })
  const next = applyPanelUpdatesToDraft(state, updates), reopened = project(next)
  assert.equal(reopened.automatic, false)
  assert.deepEqual(reopened.map.frames.map(frame => frame.members), [['a'], ['c', 'b']])
  assert.deepEqual(next.views.b.point, destination)
  for (const id of ['a', 'b', 'c']) assert.equal(next.views[id].file, state.views[id].file)
  assert.deepEqual(next.menu, state.menu)
  assert.deepEqual(state, before)
  const outside = moveNavigationWorkspaceRecord(next, binding, reopened, 'b', { x: 9999, y: 9999 }, { width: 206, height: 228 })
  assert.ok(Object.values(outside.regions).every(frame => !frame.members.includes('b')))
})

test('first frame drag moves its displayed members and persists the full frame set', () => {
  const projection = project(state), frame = projection.map.frames[0]
  const destination = { x: frame.position.x + 45, y: frame.position.y - 70 }
  const update = translateNavigationFrame(projection.displayData, binding, frame.id, destination,
    Object.fromEntries(projection.positions))
  const next = applyPanelUpdatesToDraft(state, navigationFormUpdates(state, binding, update))
  assert.equal(Object.keys(next.regions).length, 2)
  assert.deepEqual(next.regions[frame.id].point, destination)
  for (const id of ['a', 'b']) assert.deepEqual(next.views[id].point,
    { x: projection.positions.get(id).x + 45, y: projection.positions.get(id).y - 70 })
  assert.deepEqual(next.views.c, state.views.c)
  assert.equal(next.views.a.file, 'a.html')
})

test('rename, resize and delete use the complete displayed frame set without affecting product groups', () => {
  const projection = project(state), [first, second] = projection.map.frames
  const frames = { ...projection.frames, [first.id]: { ...projection.frames[first.id], title: 'Custom', extent: { width: 900, height: 600 } } }
  const update = navigationFormUpdates(state, binding, { regions: frames })
  const next = applyPanelUpdatesToDraft(state, update)
  assert.equal(project(next).frames[first.id].title, 'Custom')
  assert.deepEqual(next.views, state.views)
  assert.deepEqual(next.menu, state.menu)
  const removed = { ...projection.frames }; delete removed[first.id]
  assert.deepEqual(Object.keys(project(applyPanelUpdatesToDraft(state,
    navigationFormUpdates(state, binding, { regions: removed }))).frames), [second.id])
  assert.deepEqual(project(applyPanelUpdatesToDraft(state, { regions: {} })).map.frames, [])
})
