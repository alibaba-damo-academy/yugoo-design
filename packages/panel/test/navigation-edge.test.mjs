import test from 'node:test'
import assert from 'node:assert/strict'
import { navigationEdge, NAVIGATION_HANDLE_POSITIONS, navigationHandleId } from '../src/navigation-edge.ts'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ReactFlowProvider } from '@xyflow/react'
import { NavigationRecordNode } from '../src/navigation-record-node.tsx'
globalThis.React = React

const edge = { id: 'jump', source: 'a', target: 'b', label: 'Open item' }
test('real record node renders four non-overlapping bidirectional handle identities', () => {
  const html = renderToStaticMarkup(React.createElement(ReactFlowProvider, null,
    React.createElement(NavigationRecordNode, { data: { label: 'A' } })))
  for (const position of NAVIGATION_HANDLE_POSITIONS) for (const type of ['source', 'target']) {
    assert.ok(html.includes(`data-handleid="${navigationHandleId(type, position)}"`))
  }
  assert.equal((html.match(/data-handleid=/g) ?? []).length, 4)
  assert.match(html, /connectablestart/)
  const readonly = renderToStaticMarkup(React.createElement(ReactFlowProvider, null,
    React.createElement(NavigationRecordNode, { data: { label: 'A' }, isConnectable: false })))
  assert.equal((readonly.match(/data-handleid=/g) ?? []).length, 4, 'readonly still measures four routing endpoints')
  assert.doesNotMatch(readonly, /connectablestart|connectableend|connectionindicator/,
    'readonly handles cannot start or accept a temporary connection gesture')
})
test('dominant-axis routing selects opposite registered handles in every direction', () => {
  for (const [x, y, source, target] of [
    [400, 20, 'right', 'left'], [-400, 20, 'left', 'right'],
    [20, 400, 'bottom', 'top'], [20, -400, 'top', 'bottom'],
    [400, 400, 'right', 'left'], [0, 0, 'right', 'left'],
  ]) {
    const result = navigationEdge(edge, { x: 0, y: 0 }, { x, y })
    assert.equal(result.sourceHandle, source)
    assert.equal(result.targetHandle, target)
    assert.ok(NAVIGATION_HANDLE_POSITIONS.some(position => navigationHandleId('source', position) === result.sourceHandle))
    assert.ok(NAVIGATION_HANDLE_POSITIONS.some(position => navigationHandleId('target', position) === result.targetHandle))
    assert.equal(result.type, 'smoothstep')
  }
})
test('live drag positions change routing without changing edge identity, label or canonical state', () => {
  const before = structuredClone(edge), source = { x: -100, y: 50 }
  const first = navigationEdge(edge, source, { x: 500, y: 50 })
  const after = navigationEdge(edge, source, { x: -100, y: -500 }, true)
  assert.notEqual(first.sourceHandle, after.sourceHandle)
  assert.equal(after.source, 'node:a'); assert.equal(after.target, 'node:b')
  assert.equal(after.id, edge.id); assert.equal(after.label, edge.label)
  assert.equal(after.selected, true)
  assert.ok(after.style.strokeWidth > first.style.strokeWidth)
  assert.ok(after.markerEnd)
  assert.equal(after.labelShowBg, true)
  assert.ok(after.labelBgStyle.fillOpacity > 0.9)
  assert.deepEqual(edge, before)
})
