import test from 'node:test'
import assert from 'node:assert/strict'
import {previewPositions} from './preview-perspective-layout.mjs'

for (const mode of ['natural', 'source']) test(`${mode}: deterministic coordinates, unchanged graph`, () => {
  const graph = {nodes: [{id:'a',file:'one'}, {id:'b',file:'one'}, {id:'c',file:'two'}], edges: [{from:'a',to:'b',evidence:'keep'}, {from:'b',to:'missing'}]}
  const before = JSON.stringify(graph)
  graph.nodes.forEach(Object.freeze); graph.edges.forEach(Object.freeze)
  Object.freeze(graph.nodes); Object.freeze(graph.edges); Object.freeze(graph)
  const result = previewPositions(graph, mode)
  assert.deepEqual(result, previewPositions(graph, mode))
  assert.deepEqual(result.map(([id]) => id), ['a','b','c'])
  assert.ok(result.every(([,p]) => Number.isFinite(p.x) && Number.isFinite(p.y)))
  assert.equal(JSON.stringify(graph), before)
  assert.deepEqual(previewPositions({nodes:[],edges:[]}, mode), [])
})
