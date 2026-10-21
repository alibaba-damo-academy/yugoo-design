import assert from 'node:assert/strict'
import { test } from 'node:test'
import { boardDetailScope } from '../src/board-detail-scope.ts'

const manifest = { sections: [{ id: 'nodes' }, { id: 'edges' }] }
const bindings = [{ section: 'nodes', reference: 'owner' }, { section: 'edges', reference: 'owner' }]
const data = {
  capabilities: { a: { name: 'A' }, b: { name: 'B' } },
  nodes: { n1: { id: 'n1', owner: 'a', name: 'One' }, n2: { id: 'n2', owner: 'b', name: 'Foreign' } },
  edges: { e1: { id: 'e1', owner: 'a', source: 'n1' }, e2: { id: 'e2', owner: 'b', source: 'n2' } },
}

test('selected board detail is a projection, not a second source of truth', () => {
  const before = structuredClone(data)
  const scope = boardDetailScope(manifest, data, bindings, 'a')
  assert.deepEqual(Object.keys(scope.data.nodes), ['n1'])
  assert.deepEqual(Object.keys(scope.data.edges), ['e1'])
  assert.equal(scope.data.capabilities, data.capabilities)
  assert.equal(scope.allowsEdit('nodes', 'n1', 'name'), true)
  assert.equal(scope.allowsEdit('nodes', 'n2', 'name'), false)
  assert.equal(scope.allowsEdit('nodes', 'n1', 'owner'), false)
  assert.equal(scope.allowsEdit('capabilities', 'a', 'name'), false)
  assert.deepEqual(data, before)
})

test('edit, create and delete preserve hidden sibling records and bind new parent', () => {
  const scope = boardDetailScope(manifest, data, bindings, 'a')
  const edited = scope.merge({ nodes: { n1: { ...data.nodes.n1, name: 'Edited' }, n3: { id: 'n3', name: 'New' } } })
  assert.equal(edited.nodes.n1.name, 'Edited')
  assert.equal(edited.nodes.n3.owner, 'a')
  assert.deepEqual(edited.nodes.n2, data.nodes.n2)
  const deleted = scope.merge({ nodes: {}, edges: {} })
  assert.deepEqual(deleted, { nodes: { n2: data.nodes.n2 }, edges: { e2: data.edges.e2 } })
})

test('foreign writes, sibling id reuse and reparenting are rejected', () => {
  const scope = boardDetailScope(manifest, data, bindings, 'a')
  for (const updates of [
    { capabilities: {} }, { nodes: null }, { nodes: [] },
    { nodes: { n2: { owner: 'a' } } },
    { nodes: { n1: { ...data.nodes.n1, owner: 'b' } } },
  ]) assert.throws(() => scope.merge(updates))
})

test('own prototype-like ids remain data without changing map prototypes', () => {
  const scope = boardDetailScope(manifest, data, bindings, 'a')
  const updated = scope.merge({ nodes: JSON.parse('{"__proto__":{"name":"Literal id"}}') })
  assert.equal(Object.getPrototypeOf(updated.nodes), Object.prototype)
  assert.equal(Object.hasOwn(updated.nodes, '__proto__'), true)
  assert.equal(updated.nodes.__proto__.owner, 'a')
})
