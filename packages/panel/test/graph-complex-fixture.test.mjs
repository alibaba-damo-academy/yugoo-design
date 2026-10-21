import test from 'node:test'
import assert from 'node:assert/strict'
import { complexGraph } from './graph-complex-fixture.mjs'

test('complex visual fixture covers relationship meaning, origin and lifecycle without broken endpoints', () => {
  const graph = complexGraph()
  const ids = graph.nodes.map(node => node.id)
  assert.equal(new Set(ids).size, ids.length)
  const present = new Set(ids)
  for (const edge of graph.edges) {
    assert.ok(present.has(edge.from), `missing from endpoint: ${edge.id}`)
    assert.ok(present.has(edge.to), `missing to endpoint: ${edge.id}`)
    assert.notEqual(edge.from, edge.to)
    assert.ok(edge.evidence)
    assert.ok(edge.reading)
  }
  assert.deepEqual(new Set(graph.edges.map(edge => edge.reading.meaning)), new Set([
    'contains', 'references', 'similar', 'supports', 'realizes', 'constrains', 'precedes', 'contradicts',
  ]))
  assert.deepEqual(new Set(graph.edges.map(edge => edge.reading.origin)), new Set(['file', 'embedding', 'agent', 'human']))
  assert.deepEqual(new Set(graph.edges.map(edge => edge.reading.lifecycle)), new Set(['observed', 'proposed', 'accepted']))
  assert.equal(new Set(graph.nodes.filter(node => node.record).map(node => node.file)).size, 5)
  assert.ok(graph.warnings.some(warning => warning.includes('合成演示数据')))
})
