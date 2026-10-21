import test from 'node:test'
import assert from 'node:assert/strict'
import { navigationGroupedLayout, assignNavigationFrame } from '../src/navigation-layout.ts'
import { pageMapGroupedLayout } from '../../provider-web-app/src/client/ported/design/PageDesignPanel/pageMapLayout.ts'

test('generic grouping matches native inheritance and preserves saved geometry', () => {
  const pages = [
    { id: 'a', name: 'A', canvas_position: { x: 70, y: 90 } },
    { id: 'b', name: 'B', parent_id: 'a' },
    { id: 'c', name: 'C' },
    { id: 'd', name: 'D', parent_id: 'missing' },
    { id: 'e', name: 'E', parent_id: 'f' },
    { id: 'f', name: 'F', parent_id: 'e' },
  ]
  const navigation = [{ target_page_id: 'a', group: 'Study' }, { target_page_id: 'a', group: 'Ignored duplicate' }, { target_page_id: 'c', group: '' }]
  const labels = { primary: 'Primary', other: 'Other', generic: 'Records' }
  const before = structuredClone(pages)
  const native = pageMapGroupedLayout(pages, Object.fromEntries(pages.map(page => [page.id, page])), { navigation }, labels)
  const shared = navigationGroupedLayout(pages.map(page => ({ id: page.id, parent: page.parent_id, position: page.canvas_position })), navigation.map(row => ({ target: row.target_page_id, label: row.group })), labels)
  assert.deepEqual(shared.sections.map(group => [group.label, group.members]), native.sections.map(group => [group.label, group.pageIds]))
  assert.deepEqual([...shared.positions], [...native.positions])
  assert.deepEqual(pages, before)
  shared.positions.get('a').x = 999
  assert.equal(pages[0].canvas_position.x, 70, 'derived position is not a writable alias')
})

test('unnamed graphs and empty graphs are deterministic without page-specific labels', () => {
  const labels = { primary: 'Named', other: 'Other', generic: 'Tasks' }
  assert.deepEqual(navigationGroupedLayout([], [], labels).sections, [])
  const layout = navigationGroupedLayout([{ id: 'x' }, { id: 'y' }], [], labels, { column: 200, row: 120 })
  assert.equal(layout.sections[0].label, 'Tasks')
  assert.deepEqual(layout.positions.get('y'), { x: 200, y: 0 })
})

test('nearest explicit group overrides inherited membership and unknown targets add no groups', () => {
  const labels = { primary: 'Default', other: 'Unassigned', generic: 'All records' }
  const result = navigationGroupedLayout([
    { id: 'leaf', parent: 'child' }, { id: 'root' }, { id: 'child', parent: 'root' },
  ], [
    { target: 'missing', label: 'Never shown' },
    { target: 'root', label: 'Root group' }, { target: 'child', label: 'Child group' },
  ], labels)
  assert.deepEqual(result.sections.map(section => [section.label, section.members]), [
    ['Child group', ['leaf', 'child']], ['Root group', ['root']],
  ], 'group order follows record order, not membership declaration order')
})

test('deep hierarchies and prototype-like names remain ordinary data', () => {
  const labels = { primary: 'Primary', other: 'Other', generic: 'Records' }
  const records = Array.from({ length: 500 }, (_, index) => ({ id: String(index), ...(index ? { parent: String(index - 1) } : {}) }))
  const result = navigationGroupedLayout(records, [{ target: '0', label: '__proto__' }], labels)
  assert.equal(result.sections.length, 1)
  assert.equal(result.sections[0].label, '__proto__')
  assert.equal(result.sections[0].members.length, 500)
  assert.deepEqual(result.positions.get('499'), { x: 499 * 392, y: 0 })
  assert.deepEqual(navigationGroupedLayout(records, [{ target: '0', label: '__proto__' }], labels), result)
})

test('invalid saved coordinates use finite defaults without replacing valid negative positions', () => {
  const result = navigationGroupedLayout([
    { id: 'bad', position: { x: NaN, y: Infinity } },
    { id: 'moved', position: { x: -400, y: -70 } },
  ], [], { primary: 'Primary', other: 'Other', generic: 'Records' })
  assert.deepEqual(result.positions.get('bad'), { x: 0, y: 0 })
  assert.deepEqual(result.positions.get('moved'), { x: -400, y: -70 })
})

test('moving between overlapping frames uses the smallest containing frame and preserves other members', () => {
  const frames = [
    { id: 'large', label: 'Large', members: ['moved', 'keep'], position: { x: 0, y: 0 }, size: { width: 500, height: 500 } },
    { id: 'small', label: 'Small', members: ['other'], position: { x: 100, y: 100 }, size: { width: 100, height: 100 } },
  ]
  const before = structuredClone(frames)
  const next = assignNavigationFrame(frames, 'moved', { x: 100, y: 100 }, { width: 40, height: 40 })
  assert.deepEqual(next.map(frame => frame.members), [['keep'], ['other', 'moved']])
  assert.deepEqual(frames, before)
  next[0].position.x = -10
  assert.equal(frames[0].position.x, 0)
  const outside = assignNavigationFrame(frames, 'moved', { x: 900, y: 900 }, { width: 40, height: 40 })
  assert.deepEqual(outside.map(frame => frame.members), [['keep'], ['other']])
})
