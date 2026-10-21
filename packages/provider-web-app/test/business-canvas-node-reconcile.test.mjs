import test from 'node:test'
import assert from 'node:assert/strict'
import {
  businessLayoutPositions,
  reconcileBusinessNodes,
} from '../src/client/panels/business-relations.ts'

// React Flow keeps measurement and handle bounds on the node object it was handed.
// Losing that object is what blanked the canvas, so identity is the contract under test.
const relations = [{id: 'g1', kind: 'generalization', name: '是一种', source: 'child', target: 'parent'}]
const objectA = {id: 'parent', name: '父类型', description: '公共信息'}
const onDetail = () => {}
const node = (id, position, data, extra = {}) => ({id, type: 'businessObject', position, data, selected: false, ...extra})
const measuredNode = (object, position) => node(object.id, position, {object, disabled: false, onDetail}, {
  measured: {width: 210, height: 88},
  internals: {handleBounds: {source: [], target: []}, z: 0},
})

test('new nodes are placed by relation layering, not stacked at the origin', () => {
  assert.deepEqual(businessLayoutPositions(['parent', 'child'], relations), {parent: {x: 370, y: 0}, child: {x: 0, y: 0}})
  assert.deepEqual(businessLayoutPositions([], relations), {})
})

test('a re-render with identical presentation returns the very same node objects', () => {
  const previous = [measuredNode(objectA, {x: 120, y: 40})]
  const desired = [node('parent', {x: 0, y: 0}, {object: objectA, disabled: false, onDetail})]
  const next = reconcileBusinessNodes(previous, desired, relations)
  assert.equal(next, previous)
  assert.equal(next[0], previous[0])
  assert.deepEqual(next[0].position, {x: 120, y: 40})
})

test('a rebuilt data payload with unchanged content still reuses the node object', () => {
  const previous = [measuredNode(objectA, {x: 120, y: 40})]
  const desired = [node('parent', {x: 0, y: 0}, {object: {...objectA}, disabled: false, onDetail})]
  const next = reconcileBusinessNodes(previous, desired, relations)
  assert.notEqual(next[0].data.object, objectA)
  assert.notEqual(next[0], previous[0])
  assert.deepEqual(next[0].measured, {width: 210, height: 88})
  assert.deepEqual(next[0].internals.handleBounds, {source: [], target: []})
  assert.deepEqual(next[0].position, {x: 120, y: 40})
})

test('an edited name replaces the node object but inherits measurement and the dragged position', () => {
  const previous = [measuredNode(objectA, {x: 500, y: 260})]
  const renamed = {...objectA, name: '改名后的父类型'}
  const desired = [node('parent', {x: 0, y: 0}, {object: renamed, disabled: false, onDetail})]
  const next = reconcileBusinessNodes(previous, desired, relations)
  assert.equal(next[0].data.object, renamed)
  assert.deepEqual(next[0].measured, {width: 210, height: 88})
  assert.deepEqual(next[0].position, {x: 500, y: 260})
})

test('selection changes are presentation-only and keep measurement', () => {
  const previous = [measuredNode(objectA, {x: 12, y: 34})]
  const desired = [{...node('parent', {x: 0, y: 0}, {object: objectA, disabled: false, onDetail}), selected: true}]
  const next = reconcileBusinessNodes(previous, desired, relations)
  assert.equal(next[0].selected, true)
  assert.deepEqual(next[0].measured, {width: 210, height: 88})
})

test('added nodes get a layout position while existing nodes keep the position the user dragged to', () => {
  const previous = [measuredNode(objectA, {x: 900, y: 900})]
  const child = {id: 'child', name: '子类型', description: ''}
  const desired = [
    node('parent', {x: 0, y: 0}, {object: objectA, disabled: false, onDetail}),
    node('child', {x: 0, y: 0}, {object: child, disabled: false, onDetail}),
  ]
  const next = reconcileBusinessNodes(previous, desired, relations)
  assert.equal(next.length, 2)
  assert.equal(next[0], previous[0])
  assert.deepEqual(next[0].position, {x: 900, y: 900})
  assert.deepEqual(next[1].position, {x: 0, y: 0})
})

test('removed objects leave the canvas and survivors keep their identity', () => {
  const child = {id: 'child', name: '子类型', description: ''}
  const previous = [measuredNode(objectA, {x: 900, y: 900}), measuredNode(child, {x: 5, y: 5})]
  const next = reconcileBusinessNodes(previous, [node('child', {x: 0, y: 0}, {object: child, disabled: false, onDetail})], relations)
  assert.deepEqual(next.map(item => item.id), ['child'])
  assert.equal(next[0], previous[1])
})

test('reconciling twice in a row is a fixed point', () => {
  const previous = [measuredNode(objectA, {x: 120, y: 40})]
  const desired = [node('parent', {x: 0, y: 0}, {object: objectA, disabled: false, onDetail})]
  const once = reconcileBusinessNodes(previous, desired, relations)
  assert.equal(reconcileBusinessNodes(once, desired, relations), once)
})
